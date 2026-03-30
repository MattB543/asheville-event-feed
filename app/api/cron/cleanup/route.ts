import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { inArray, sql, eq } from 'drizzle-orm';
import { isNonNCEvent, getNonNCReason } from '@/lib/utils/geo';
import { findDuplicates, getIdsToRemove, getDescriptionUpdates } from '@/lib/utils/deduplication';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';

export const maxDuration = 300; // 5 minutes max

/** Format milliseconds as human-readable duration (e.g., "12.3s") */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

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
  status: number;
}

async function checkUrl(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
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
  const runId = await startCronJob('cleanup');

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

    // Gap #12: Log DB query timing
    const queryStart = Date.now();
    const eventbriteEvents = await db
      .select({
        id: events.id,
        title: events.title,
        url: events.url,
      })
      .from(events).where(sql`
        ${events.source} = 'EVENTBRITE'
        AND ${events.startDate} >= ${windowStart.toISOString()}
        AND ${events.startDate} <= ${windowEnd.toISOString()}
      `);
    console.log(
      `[Cleanup] Queried ${eventbriteEvents.length} Eventbrite events in ${formatDuration(Date.now() - queryStart)} (${label})`
    );

    const deadEvents: DeadEvent[] = [];
    const batchSize = 10;
    // Gap #2: Track non-404/410 status codes for aggregate logging
    const statusCodeCounts = new Map<number, number>();
    let networkErrorCount = 0;

    // Check URLs in batches with progress logging
    const totalBatches = Math.ceil(eventbriteEvents.length / batchSize);
    for (let i = 0; i < eventbriteEvents.length; i += batchSize) {
      const batch = eventbriteEvents.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      const results = await Promise.all(
        batch.map(async (event) => {
          const status = await checkUrl(event.url);
          return { event, status };
        })
      );

      for (const { event, status } of results) {
        if (status === 404 || status === 410) {
          console.log(`[Cleanup] Dead: ${event.title.substring(0, 50)}...`);
          deadEvents.push({
            id: event.id,
            title: event.title,
            url: event.url,
            status,
          });
        } else if (status === 0) {
          networkErrorCount++;
        } else if (status !== 200) {
          // Gap #2: Accumulate non-200/404/410 status codes
          statusCodeCounts.set(status, (statusCodeCounts.get(status) || 0) + 1);
        }
      }

      // Log progress every 5 batches
      if (batchNum % 5 === 0 || batchNum === totalBatches) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `[Cleanup] URL check progress: ${Math.min(i + batchSize, eventbriteEvents.length)}/${eventbriteEvents.length} (${elapsed}s elapsed)`
        );
      }

      // Small delay between batches to be polite to Eventbrite
      if (i + batchSize < eventbriteEvents.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Gap #2: Log aggregated non-standard status codes
    if (statusCodeCounts.size > 0 || networkErrorCount > 0) {
      const parts: string[] = [];
      for (const [code, count] of [...statusCodeCounts.entries()].sort((a, b) => a[0] - b[0])) {
        parts.push(`${count} returned ${code}`);
      }
      if (networkErrorCount > 0) {
        parts.push(`${networkErrorCount} network errors`);
      }
      console.log(`[Cleanup] Non-standard URL responses: ${parts.join(', ')}`);
    }

    console.log(`[Cleanup] Found ${deadEvents.length} dead events.`);

    // Delete dead events in batch (instead of one at a time)
    if (deadEvents.length > 0) {
      const deadIds = deadEvents.map((e) => e.id);
      await db.delete(events).where(inArray(events.id, deadIds));
      for (const deadEvent of deadEvents) {
        console.log(`[Cleanup] Deleted: ${deadEvent.title.substring(0, 40)}...`);
      }
    }

    // Gap #3: Log phase 1 duration
    console.log(
      `[Cleanup] Phase 1 (dead URLs) complete in ${formatDuration(Date.now() - phase1Start)}. Deleted ${deadEvents.length} dead events.`
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
      })
      .from(events);
    console.log(
      `[Cleanup] Queried ${allEventsForDedup.length} events for dedup in ${formatDuration(Date.now() - dedupQueryStart)} (fresh dataset after non-NC/cancelled deletions)`
    );

    const duplicateGroups = findDuplicates(allEventsForDedup);
    const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);
    const descriptionUpdates = getDescriptionUpdates(duplicateGroups);

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

    // Apply description merges before deleting duplicates
    // (keep the longer description from removed events)
    if (descriptionUpdates.length > 0) {
      let mergeSuccesses = 0;
      let mergeFailures = 0;
      for (const update of descriptionUpdates) {
        // Gap #8: Wrap description merge in try/catch
        try {
          await db
            .update(events)
            .set({ description: update.description })
            .where(eq(events.id, update.id));
          mergeSuccesses++;
        } catch (error) {
          mergeFailures++;
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error(
            `[Cleanup] Description merge failed for event ${update.id.substring(0, 8)}: ${errMsg}`
          );
        }
      }
      console.log(
        `[Cleanup] Merged ${mergeSuccesses} longer descriptions${mergeFailures > 0 ? ` (${mergeFailures} failed)` : ''}.`
      );
    }

    if (duplicateIdsToRemove.length > 0) {
      const deleteBatchSize = 50;
      for (let i = 0; i < duplicateIdsToRemove.length; i += deleteBatchSize) {
        const batch = duplicateIdsToRemove.slice(i, i + deleteBatchSize);
        await db.delete(events).where(inArray(events.id, batch));
      }
      console.log(`[Cleanup] Deleted ${duplicateIdsToRemove.length} duplicate events.`);
    }

    // Gap #3: Log phase 4 duration
    console.log(
      `[Cleanup] Phase 4 (dedup) complete in ${formatDuration(Date.now() - phase4Start)}. Removed ${duplicateIdsToRemove.length} duplicates from ${duplicateGroups.length} groups.`
    );

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalDeleted =
      deadEvents.length +
      nonNCEventIds.length +
      cancelledEventIds.length +
      duplicateIdsToRemove.length;
    console.log(
      `[Cleanup] Complete in ${totalDuration}s. Deleted ${totalDeleted} events (${deadEvents.length} dead, ${nonNCEventIds.length} non-NC, ${cancelledEventIds.length} cancelled, ${duplicateIdsToRemove.length} duplicates)`
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
      checked: eventbriteEvents.length,
      deletedDead: deadEvents.length,
      deletedNonNC: nonNCEventIds.length,
      deletedCancelled: cancelledEventIds.length,
      deletedDuplicates: duplicateIdsToRemove.length,
      duplicateGroups: duplicateGroups.length,
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
