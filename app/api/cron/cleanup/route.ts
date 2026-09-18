import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { inArray, sql, eq, and, isNull, or } from 'drizzle-orm';
import { isNonNCEvent, getNonNCReason } from '@/lib/utils/geo';
import { findDuplicates, getIdsToRemove } from '@/lib/utils/deduplication';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { formatDuration } from '@/lib/utils/cron';
import { DEFAULT_FETCH_TIMEOUT_MS } from '@/lib/utils/retry';
import { createChromeDispatcher, probeAsChrome } from '@/lib/scrapers/fetchAsChrome';

export const maxDuration = 300; // 5 minutes max

/**
 * Determine which date window to check based on time of day.
 * - Daytime runs (6x): Check events happening in days 0-7 (imminent events)
 * - Nighttime runs (2x): Check events happening in days 8-14 (upcoming events)
 *
 * This ensures events happening soon get checked 6x/day while events
 * further out still get checked 2x/day.
 */
function getDateWindowForRun(): { startDays: number; endDays: number; label: string } {
  const hour = new Date().getUTCHours();
  // Daytime (7-22 UTC): Next 7 days (imminent events, checked 6x/day)
  // Nighttime (outside 7-22 UTC): Days 8-14 (upcoming events, checked 2x/day)
  if (hour >= 7 && hour < 23) {
    return { startDays: 0, endDays: 7, label: 'days 0-7 (imminent)' };
  } else {
    return { startDays: 8, endDays: 14, label: 'days 8-14 (upcoming)' };
  }
}

interface DeadEvent {
  id: string;
  title: string;
  url: string;
  source: string;
  status: number;
}

/** Only these mean "gone". A block is a 403/429/5xx and must never delete. */
const DEAD_STATUSES = new Set([404, 410]);

/**
 * Events the scrapers confirmed this recently are alive by definition - the
 * scraper just fetched them - so checking them is wasted requests. Scrapes run
 * every 6h, so this is "missed by the last four runs".
 */
const DEAD_CHECK_STALE_HOURS = 24;

/**
 * If this share of a source's checked events look dead at once, that is a site
 * redesign or an outage, not individual removals. Skip the source entirely.
 */
const DEAD_SOURCE_MAX_SHARE = 0.2;
const DEAD_SOURCE_MIN_CHECKED = 5;

async function checkUrl(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });
    return response.status;
  } catch (error) {
    // Gap #1: Log specific network error type and URL
    const errMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[Cleanup] URL check network error for ${url}: ${errMsg}`);
    return 0; // Network error
  }
}

export async function GET(request: Request) {
  // Verify cron secret (timing-safe comparison)
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    // Gap #10: Log auth failure
    console.warn(
      `[Cleanup] Auth failed: missing or invalid CRON_SECRET (header present: ${!!authHeader})`
    );
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startTime = Date.now();
  let runId: string | null = null;
  try {
    runId = await startCronJob('cleanup');
  } catch (trackerErr) {
    console.error(
      '[Cleanup] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
  }

  try {
    const { startDays, endDays, label } = getDateWindowForRun();

    console.log(`[Cleanup] Starting cleanup job (window: ${label})...`);

    // === Phase 1: Dead URL check ===
    const phase1Start = Date.now();

    // Calculate date window based on time of day
    // Daytime: check events happening in next 7 days (imminent, 6x/day coverage)
    // Nighttime: check events happening in days 8-14 (upcoming, 2x/day coverage)
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() + startDays);
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + endDays);
    windowEnd.setHours(23, 59, 59, 999);

    // Only events the scrapers have STOPPED confirming are at risk. Anything
    // seen in the last day was just fetched successfully by a scraper, so its
    // URL is alive and checking it again only burns requests. This is what
    // makes checking every source affordable: ~56 candidates instead of ~844.
    const queryStart = Date.now();
    const staleCutoff = new Date(Date.now() - DEAD_CHECK_STALE_HOURS * 60 * 60 * 1000);
    const candidates = await db
      .select({
        id: events.id,
        title: events.title,
        url: events.url,
        source: events.source,
      })
      .from(events).where(sql`
        ${events.startDate} >= ${windowStart.toISOString()}
        AND ${events.startDate} <= ${windowEnd.toISOString()}
        AND ${events.lastSeenAt} < ${staleCutoff.toISOString()}
        AND ${events.deadAt} IS NULL
        AND ${events.dedupedAt} IS NULL
      `);
    console.log(
      `[Cleanup] Queried ${candidates.length} unconfirmed events (not seen in ${DEAD_CHECK_STALE_HOURS}h) in ${formatDuration(Date.now() - queryStart)} (${label})`
    );

    const deadEvents: DeadEvent[] = [];
    const batchSize = 10;
    const statusCodeCounts = new Map<number, number>();
    const checkedBySource = new Map<string, number>();
    const deadBySource = new Map<string, DeadEvent[]>();
    let networkErrorCount = 0;
    let falsePositiveCount = 0;

    // A 404 from Node's default TLS handshake can be a bot block rather than a
    // removal, so every candidate is re-checked over a Chrome fingerprint
    // before we act on it. Cheap because only actual 404s reach it.
    const dispatcher = await createChromeDispatcher();

    try {
      const totalBatches = Math.ceil(candidates.length / batchSize);
      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;

        const results = await Promise.all(
          batch.map(async (event) => ({ event, status: await checkUrl(event.url) }))
        );

        for (const { event, status } of results) {
          checkedBySource.set(event.source, (checkedBySource.get(event.source) || 0) + 1);

          if (!DEAD_STATUSES.has(status)) {
            if (status === 0) {
              networkErrorCount++;
            } else if (status !== 200) {
              statusCodeCounts.set(status, (statusCodeCounts.get(status) || 0) + 1);
            }
            continue;
          }

          const confirmed = await probeAsChrome(event.url, dispatcher);
          if (!DEAD_STATUSES.has(confirmed)) {
            falsePositiveCount++;
            console.log(
              `[Cleanup] Not dead after all (HEAD ${status}, Chrome ${confirmed}): ${event.url}`
            );
            continue;
          }

          const dead: DeadEvent = {
            id: event.id,
            title: event.title,
            url: event.url,
            source: event.source,
            status: confirmed,
          };
          deadEvents.push(dead);
          const forSource = deadBySource.get(event.source) || [];
          forSource.push(dead);
          deadBySource.set(event.source, forSource);
        }

        if (batchNum % 5 === 0 || batchNum === totalBatches) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `[Cleanup] URL check progress: ${Math.min(i + batchSize, candidates.length)}/${candidates.length} (${elapsed}s elapsed)`
          );
        }

        if (i + batchSize < candidates.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } finally {
      await dispatcher.close();
    }

    if (statusCodeCounts.size > 0 || networkErrorCount > 0) {
      const parts: string[] = [];
      for (const [code, count] of [...statusCodeCounts.entries()].sort((a, b) => a[0] - b[0])) {
        parts.push(`${count} returned ${code}`);
      }
      if (networkErrorCount > 0) {
        parts.push(`${networkErrorCount} network errors`);
      }
      console.log(
        `[Cleanup] Non-standard URL responses (none removed - only 404/410 counts as dead): ${parts.join(', ')}`
      );
    }
    if (falsePositiveCount > 0) {
      console.log(
        `[Cleanup] ${falsePositiveCount} URL(s) 404'd on the plain check but not over a Chrome fingerprint - kept.`
      );
    }

    // A source losing a big share of its events at once is a redesign or an
    // outage, not real removals. Drop the whole source rather than cascade.
    const skippedSources: string[] = [];
    for (const [source, dead] of deadBySource) {
      const checked = checkedBySource.get(source) || 0;
      const share = checked > 0 ? dead.length / checked : 0;
      if (checked >= DEAD_SOURCE_MIN_CHECKED && share > DEAD_SOURCE_MAX_SHARE) {
        console.warn(
          `[Cleanup] SKIPPING ${source}: ${dead.length}/${checked} (${Math.round(share * 100)}%) look dead, over the ${Math.round(DEAD_SOURCE_MAX_SHARE * 100)}% cap. Likely a site change, not removals - nothing removed for this source.`
        );
        skippedSources.push(source);
        for (const event of dead) {
          const idx = deadEvents.indexOf(event);
          if (idx !== -1) deadEvents.splice(idx, 1);
        }
      }
    }

    // Soft-delete: set dead_at rather than DELETE, so a bad call is one UPDATE
    // to undo and the row survives for auditing.
    if (deadEvents.length > 0) {
      const deadAt = new Date();
      await db
        .update(events)
        .set({ deadAt })
        .where(
          inArray(
            events.id,
            deadEvents.map((e) => e.id)
          )
        );
      console.log(`[Cleanup] Soft-deleted ${deadEvents.length} dead event(s) (set dead_at):`);
      for (const dead of deadEvents) {
        console.log(
          `[Cleanup]   ${dead.status} ${dead.source} | ${dead.title.substring(0, 50)} | ${dead.url}`
        );
      }
      console.log(
        `[Cleanup] To restore: UPDATE events SET dead_at = NULL WHERE id IN (${deadEvents
          .map((e) => `'${e.id}'`)
          .join(', ')});`
      );
    } else {
      console.log('[Cleanup] No dead events found.');
    }

    console.log(
      `[Cleanup] Phase 1 (dead URLs) complete in ${formatDuration(Date.now() - phase1Start)}. Checked ${candidates.length}, soft-deleted ${deadEvents.length}${skippedSources.length > 0 ? `, skipped sources: ${skippedSources.join(', ')}` : ''}.`
    );

    // === Phase 2: Non-NC events ===
    const phase2Start = Date.now();
    console.log('[Cleanup] Phase 2: Checking for non-NC events...');

    // Gap #4 & #12: Log fresh query after dead event deletions
    const allEventsQueryStart = Date.now();
    const allEvents = await db
      .select({
        id: events.id,
        title: events.title,
        location: events.location,
      })
      .from(events);
    console.log(
      `[Cleanup] Queried ${allEvents.length} events for non-NC/cancelled check in ${formatDuration(Date.now() - allEventsQueryStart)} (fresh dataset after dead URL deletions)`
    );

    const nonNCEventIds: string[] = [];
    const nonNCEventTitles: string[] = [];
    // Gap #5: Track example non-NC events with locations and reasons
    const nonNCExamples: { title: string; location: string | null; reason: string | null }[] = [];

    for (const event of allEvents) {
      if (isNonNCEvent(event.title, event.location)) {
        nonNCEventIds.push(event.id);
        nonNCEventTitles.push(event.title);
        if (nonNCExamples.length < 3) {
          nonNCExamples.push({
            title: event.title,
            location: event.location,
            reason: getNonNCReason(event.title, event.location),
          });
        }
      }
    }

    console.log(`[Cleanup] Found ${nonNCEventIds.length} non-NC events.`);
    // Gap #5: Log example non-NC events for operator verification
    if (nonNCExamples.length > 0) {
      for (const ex of nonNCExamples) {
        console.log(
          `[Cleanup]   Example: "${ex.title.substring(0, 60)}" | location: "${ex.location || 'null'}" | reason: ${ex.reason}`
        );
      }
    }

    // Delete non-NC events in batches
    if (nonNCEventIds.length > 0) {
      const deleteBatchSize = 50;
      const totalDeleteBatches = Math.ceil(nonNCEventIds.length / deleteBatchSize);
      for (let i = 0; i < nonNCEventIds.length; i += deleteBatchSize) {
        const batch = nonNCEventIds.slice(i, i + deleteBatchSize);
        await db.delete(events).where(inArray(events.id, batch));
        // Gap #11: Log batch progress for large sets
        if (totalDeleteBatches > 1) {
          const batchNum = Math.floor(i / deleteBatchSize) + 1;
          console.log(`[Cleanup] Deleted non-NC batch ${batchNum}/${totalDeleteBatches}`);
        }
      }
      console.log(`[Cleanup] Deleted ${nonNCEventIds.length} non-NC events.`);
    }

    // Gap #3: Log phase 2 duration
    console.log(
      `[Cleanup] Phase 2 (non-NC) complete in ${formatDuration(Date.now() - phase2Start)}. Deleted ${nonNCEventIds.length} non-NC events.`
    );

    // === Phase 3: Cancelled events ===
    const phase3Start = Date.now();
    console.log('[Cleanup] Phase 3: Checking for cancelled events...');
    const cancelledEventIds: string[] = [];
    const cancelledEventTitles: string[] = [];

    for (const event of allEvents) {
      if (event.title.trim().toUpperCase().startsWith('CANCELLED')) {
        cancelledEventIds.push(event.id);
        cancelledEventTitles.push(event.title);
      }
    }

    console.log(`[Cleanup] Found ${cancelledEventIds.length} cancelled events.`);
    // Gap #6: Log actual titles of cancelled events (should be few)
    if (cancelledEventTitles.length > 0) {
      for (const title of cancelledEventTitles) {
        console.log(`[Cleanup]   Cancelled: "${title.substring(0, 80)}"`);
      }
    }

    // Delete cancelled events in batches
    if (cancelledEventIds.length > 0) {
      const deleteBatchSize = 50;
      const totalDeleteBatches = Math.ceil(cancelledEventIds.length / deleteBatchSize);
      for (let i = 0; i < cancelledEventIds.length; i += deleteBatchSize) {
        const batch = cancelledEventIds.slice(i, i + deleteBatchSize);
        await db.delete(events).where(inArray(events.id, batch));
        // Gap #11: Log batch progress for large sets
        if (totalDeleteBatches > 1) {
          const batchNum = Math.floor(i / deleteBatchSize) + 1;
          console.log(`[Cleanup] Deleted cancelled batch ${batchNum}/${totalDeleteBatches}`);
        }
      }
      console.log(`[Cleanup] Deleted ${cancelledEventIds.length} cancelled events.`);
    }

    // Gap #3: Log phase 3 duration
    console.log(
      `[Cleanup] Phase 3 (cancelled) complete in ${formatDuration(Date.now() - phase3Start)}. Deleted ${cancelledEventIds.length} cancelled events.`
    );

    // === Phase 4: Deduplication ===
    const phase4Start = Date.now();
    console.log('[Cleanup] Phase 4: Checking for duplicate events...');

    // Gap #4 & #12: Log fresh query for dedup
    const dedupQueryStart = Date.now();
    const allEventsForDedup = await db
      .select({
        id: events.id,
        title: events.title,
        organizer: events.organizer,
        location: events.location,
        startDate: events.startDate,
        price: events.price,
        description: events.description,
        createdAt: events.createdAt,
        source: events.source,
        // Read by mergeFields to salvage what the losing rows have and the
        // winner doesn't - most often an image the winner's source never had.
        zip: events.zip,
        imageUrl: events.imageUrl,
        interestedCount: events.interestedCount,
        goingCount: events.goingCount,
      })
      .from(events)
      .where(
        and(
          // Ignore rows already soft-deleted as duplicates...
          isNull(events.dedupedAt),
          isNull(events.deadAt),
          // ...and rows an admin flagged to never auto-dedup (so a restore sticks)
          or(isNull(events.dedupSkip), eq(events.dedupSkip, false)),
          // ...and moderated-away rows, which must never merge into a live one
          or(isNull(events.hidden), eq(events.hidden, false))
        )
      );
    console.log(
      `[Cleanup] Queried ${allEventsForDedup.length} events for dedup in ${formatDuration(Date.now() - dedupQueryStart)} (fresh dataset after non-NC/cancelled deletions)`
    );

    const duplicateGroups = findDuplicates(allEventsForDedup);
    const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);

    // Log duplicate groups for visibility
    for (const group of duplicateGroups) {
      console.log(`[Cleanup] Dedup: Keep "${group.keep.title}" (${group.keep.id.substring(0, 6)})`);
      for (const removed of group.remove) {
        console.log(
          `[Cleanup]   Remove: "${removed.title}" (${removed.id.substring(0, 6)}) via Method ${group.method}`
        );
      }
    }

    // Gap #7: Log deduplication method breakdown
    const methodCounts: Record<string, number> = {};
    for (const group of duplicateGroups) {
      for (const method of group.method.split(',')) {
        methodCounts[method] = (methodCounts[method] || 0) + 1;
      }
    }
    if (Object.keys(methodCounts).length > 0) {
      const breakdown = Object.entries(methodCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([method, count]) => `${method}=${count}`)
        .join(', ');
      console.log(
        `[Cleanup] Dedup method breakdown: ${breakdown} (total groups: ${duplicateGroups.length})`
      );
    }

    console.log(`[Cleanup] Found ${duplicateIdsToRemove.length} duplicate events to remove.`);

    // Merge the losers' salvageable data into the winner and soft-delete them,
    // one transaction per group: a mid-run failure must not leave a merged
    // winner whose losers are still live. Soft-delete (deduped_at) rather than
    // DELETE so a bad merge stays recoverable, matching the scrape cron.
    const dedupedAt = new Date();
    let mergeSuccesses = 0;
    let mergeFailures = 0;
    let softDeletedCount = 0;
    let groupFailures = 0;
    const mergedFieldCounts: Record<string, number> = {};

    for (const group of duplicateGroups) {
      const removeIds = group.remove.map((e) => e.id);
      if (removeIds.length === 0) continue;

      // Gap #8: a failed group is logged and skipped, not fatal to the run
      try {
        await db.transaction(async (tx) => {
          if (group.fieldUpdates) {
            await tx.update(events).set(group.fieldUpdates).where(eq(events.id, group.keep.id));
          }
          await tx.update(events).set({ dedupedAt }).where(inArray(events.id, removeIds));
        });
        if (group.fieldUpdates) {
          mergeSuccesses++;
          for (const field of Object.keys(group.fieldUpdates)) {
            mergedFieldCounts[field] = (mergedFieldCounts[field] || 0) + 1;
          }
        }
        softDeletedCount += removeIds.length;
      } catch (error) {
        groupFailures++;
        if (group.fieldUpdates) mergeFailures++;
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `[Cleanup] Dedup group failed for keep ${group.keep.id.substring(0, 8)}: ${errMsg}`
        );
      }
    }

    if (mergeSuccesses > 0 || mergeFailures > 0) {
      const fieldSummary = Object.entries(mergedFieldCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([field, count]) => `${field}=${count}`)
        .join(', ');
      console.log(
        `[Cleanup] Merged data into ${mergeSuccesses} kept events (${fieldSummary})${mergeFailures > 0 ? ` (${mergeFailures} failed)` : ''}.`
      );
    }
    if (softDeletedCount > 0) {
      console.log(`[Cleanup] Soft-deleted ${softDeletedCount} duplicate events.`);
    }

    // Gap #3: Log phase 4 duration
    console.log(
      `[Cleanup] Phase 4 (dedup) complete in ${formatDuration(Date.now() - phase4Start)}. Removed ${softDeletedCount} duplicates from ${duplicateGroups.length} groups${groupFailures > 0 ? ` (${groupFailures} groups failed)` : ''}.`
    );

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalDeleted =
      deadEvents.length + nonNCEventIds.length + cancelledEventIds.length + softDeletedCount;
    console.log(
      `[Cleanup] Complete in ${totalDuration}s. Removed ${totalDeleted} events (${deadEvents.length} dead, ${nonNCEventIds.length} non-NC, ${cancelledEventIds.length} cancelled, ${softDeletedCount} duplicates soft-deleted)`
    );

    // Gap #9: Log cache invalidation outcome
    try {
      invalidateEventsCache();
      console.log('[Cleanup] Cache invalidation succeeded.');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Cleanup] Cache invalidation failed: ${errMsg}`);
    }

    const result = {
      window: label,
      checked: candidates.length,
      deadSoftDeleted: deadEvents.length,
      deletedNonNC: nonNCEventIds.length,
      deletedCancelled: cancelledEventIds.length,
      deletedDuplicates: softDeletedCount,
      duplicateGroups: duplicateGroups.length,
      failedDedupGroups: groupFailures,
    };

    await completeCronJob(runId, result);

    return NextResponse.json({
      success: true,
      durationSeconds: parseFloat(totalDuration),
      ...result,
      deadEvents: deadEvents.map((e) => ({
        title: e.title,
        status: e.status,
      })),
      nonNCEvents: nonNCEventTitles.slice(0, 20),
      cancelledEvents: cancelledEventTitles.slice(0, 20),
    });
  } catch (error) {
    const totalDuration = formatDuration(Date.now() - startTime);
    console.error(`[Cleanup] Fatal error after ${totalDuration}:`, error);

    await failCronJob(runId, error);

    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
