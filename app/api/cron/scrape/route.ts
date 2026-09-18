import { NextResponse } from 'next/server';
import { scrapeAvlToday } from '@/lib/scrapers/avltoday';
import { scrapeEventbrite } from '@/lib/scrapers/eventbrite';
import { scrapeMeetup } from '@/lib/scrapers/meetup';
import { scrapeFacebookEvents } from '@/lib/scrapers/facebook';
import { scrapeHarrahs } from '@/lib/scrapers/harrahs';
import { scrapeOrangePeel } from '@/lib/scrapers/orangepeel';
import { scrapeGreyEagle } from '@/lib/scrapers/greyeagle';
import { scrapeLiveMusicAvl } from '@/lib/scrapers/livemusicavl';
import { scrapeMountainX } from '@/lib/scrapers/mountainx';
import { scrapeUncaEvents } from '@/lib/scrapers/unca';
import { scrapeStaticAge } from '@/lib/scrapers/staticage';
import { scrapeRevolve } from '@/lib/scrapers/revolve';
import { scrapeBMCMuseum } from '@/lib/scrapers/bmcmuseum';
import { scrapeAshevilleOnBikes } from '@/lib/scrapers/ashevilleonbikes';
import { scrapeExploreAsheville } from '@/lib/scrapers/exploreasheville';
import { scrapeMisfitImprov } from '@/lib/scrapers/misfitimprov';
import { scrapeUDharma } from '@/lib/scrapers/udharma';
import { scrapeNCStage } from '@/lib/scrapers/ncstage';
import { scrapeStoryParlor } from '@/lib/scrapers/storyparlor';
import { scrapeTheaterAlliance } from '@/lib/scrapers/theateralliance';
import { scrapePechaKucha } from '@/lib/scrapers/pechakucha';
import { scrapeLittleAnimals } from '@/lib/scrapers/littleanimals';
import { scrapeAshevilleMusicHall } from '@/lib/scrapers/ashevillemusichall';
import { scrapePisgahBrewing } from '@/lib/scrapers/pisgahbrewing';
import { scrapeKingStreet } from '@/lib/scrapers/kingstreet';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { inArray, eq, sql, and, isNull, or } from 'drizzle-orm';
import type { ScrapedEvent } from '@/lib/scrapers/types';
import { env, isFacebookEnabled, isLocalScrapeRuntime } from '@/lib/config/env';
import { findDuplicates, getIdsToRemove, getFieldUpdates } from '@/lib/utils/deduplication';
import { verifyAuthToken } from '@/lib/utils/auth';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { formatDuration, chunk } from '@/lib/utils/cron';

export const maxDuration = 800; // 13+ minutes (requires Fluid Compute)

// Extract error details for better diagnostics
function formatErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  // Check for common HTTP/network error properties
  const err = error as Error & { status?: number; code?: string };
  if (err.status) parts.push(`status=${err.status}`);
  if (err.code) parts.push(`code=${err.code}`);
  if (err.cause instanceof Error) parts.push(`cause=${err.cause.message}`);
  return parts.join(', ');
}

// Scraper definition for data-driven processing
interface ScraperDef {
  name: string;
  fn: () => Promise<ScrapedEvent[]>;
  stripTags?: boolean; // If true, remove tags from results (AI job adds them later)
  // If true, only run outside Vercel (see isLocalScrapeRuntime). For sources that
  // need a real browser or an IP the origin doesn't block, so the Vercel cron
  // skips them and a local pipeline run keeps them fresh.
  localOnly?: boolean;
}

const SCRAPERS: ScraperDef[] = [
  { name: 'AVL Today', fn: scrapeAvlToday, stripTags: true },
  { name: 'Eventbrite', fn: () => scrapeEventbrite(25), stripTags: true },
  { name: 'Meetup', fn: () => scrapeMeetup(30), stripTags: true },
  { name: "Harrah's", fn: scrapeHarrahs },
  { name: 'Orange Peel', fn: scrapeOrangePeel },
  { name: 'Grey Eagle', fn: scrapeGreyEagle },
  { name: 'Live Music AVL', fn: scrapeLiveMusicAvl },
  // Cloudflare challenges Node's TLS fingerprint, so the scraper goes through a
  // Chrome-like undici dispatcher (lib/scrapers/fetchAsChrome.ts). That was enough
  // from Vercel until 2026-09-15, when Cloudflare began challenging every request
  // from Vercel's egress while the same code kept working locally. So both
  // fetchAsChrome consumers (this and NC Stage) are local-only again and refresh
  // via scripts/run-full-cron-local.ts. If you retry Vercel, watch result.scrapers.
  { name: 'Mountain Xpress', fn: scrapeMountainX, localOnly: true },
  { name: 'UNCA', fn: scrapeUncaEvents },
  { name: 'Static Age', fn: scrapeStaticAge },
  { name: 'Revolve', fn: scrapeRevolve },
  { name: 'BMC Museum', fn: scrapeBMCMuseum },
  { name: 'Asheville on Bikes', fn: scrapeAshevilleOnBikes },
  { name: 'Explore Asheville', fn: scrapeExploreAsheville },
  { name: 'Misfit Improv', fn: scrapeMisfitImprov },
  { name: 'UDharma', fn: scrapeUDharma },
  // Same Cloudflare-vs-Vercel block as Mountain Xpress (see the comment above).
  { name: 'NC Stage', fn: scrapeNCStage, localOnly: true },
  { name: 'Story Parlor', fn: scrapeStoryParlor },
  { name: 'Theater Alliance', fn: scrapeTheaterAlliance },
  { name: 'PechaKucha', fn: scrapePechaKucha },
  { name: 'Little Animals', fn: scrapeLittleAnimals },
  { name: 'Asheville Music Hall', fn: scrapeAshevilleMusicHall },
  { name: 'Pisgah Brewing', fn: scrapePisgahBrewing },
  { name: '185 King Street', fn: scrapeKingStreet },
];

// Scrape-only cron job
//
// This route handles ONLY scraping and database upserts.
// AI tagging and image generation are handled by /api/cron/ai
//
// Schedule: Every 6 hours at :00 (cron: "0 0/6 * * *")
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    console.warn('[Scrape] Auth failed: invalid or missing CRON_SECRET');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const jobStartTime = Date.now();
  let runId: string | null = null;
  try {
    runId = await startCronJob('scrape');
  } catch (trackerErr) {
    console.error(
      '[Scrape] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
  }

  // Stats tracking
  const stats = {
    scraping: { duration: 0, total: 0 },
    upsert: {
      duration: 0,
      success: 0,
      failed: 0,
      // Split out so a run records how many events were genuinely NEW vs re-confirmed.
      // The upsert touches every scraped row each time, so `success` alone says nothing
      // about growth.
      inserted: 0,
      updated: 0,
      bySource: {} as Record<string, { inserted: number; updated: number; failed: number }>,
    },
    dedup: { removed: 0, byMethod: {} as Record<string, number> },
    dbEventsBefore: 0,
    dbEventsAfter: 0,
  };

  try {
    console.log('[Scrape] ════════════════════════════════════════════════');
    console.log('[Scrape] Starting scrape-only job...');

    // Get pre-run event count
    const [preCount] = await db.select({ count: sql<number>`count(*)::int` }).from(events);
    stats.dbEventsBefore = preCount.count;
    console.log(`[Scrape] DB event count before run: ${stats.dbEventsBefore}`);

    // Skip local-only sources when running on Vercel (see isLocalScrapeRuntime)
    const runLocalOnly = isLocalScrapeRuntime();
    const activeScrapers = SCRAPERS.filter((s) => !s.localOnly || runLocalOnly);
    const skippedSources = SCRAPERS.filter((s) => s.localOnly && !runLocalOnly).map((s) => s.name);
    if (skippedSources.length > 0) {
      console.log(
        `[Scrape] Skipping ${skippedSources.length} local-only source(s) on Vercel: ${skippedSources.join(', ')}`
      );
    }

    // Scrape all sources in parallel (each with its own timer)
    console.log(`[Scrape] Scraping ${activeScrapers.length} sources in parallel...`);
    const scrapeStartTime = Date.now();
    const timedScrapers = activeScrapers.map(async (scraper) => {
      const start = Date.now();
      try {
        const result = await scraper.fn();
        return {
          name: scraper.name,
          status: 'fulfilled' as const,
          value: result,
          duration: Date.now() - start,
          stripTags: scraper.stripTags,
        };
      } catch (error) {
        return {
          name: scraper.name,
          status: 'rejected' as const,
          reason: error,
          duration: Date.now() - start,
          stripTags: scraper.stripTags,
        };
      }
    });
    const scraperResults = await Promise.all(timedScrapers);

    stats.scraping.duration = Date.now() - scrapeStartTime;

    // Process results: build summary, collect events, log outcomes
    const allEvents: ScrapedEvent[] = [];
    let successCount = 0;
    let failCount = 0;
    const scraperSummaryLines: string[] = [];
    // Per-scraper outcome, persisted to cron_job_runs so a run stays auditable after
    // Vercel's ~1h runtime log retention expires.
    const scraperStats: Array<{
      name: string;
      ok: boolean;
      events: number;
      ms: number;
      error?: string;
    }> = [];

    for (const result of scraperResults) {
      const dur = formatDuration(result.duration);
      if (result.status === 'fulfilled') {
        const count = result.value.length;
        stats.scraping.total += count;
        successCount++;

        // Collect events (strip tags if needed for sources where AI adds them later)
        if (result.stripTags) {
          allEvents.push(...result.value.map((e) => ({ ...e, tags: undefined })));
        } else {
          allEvents.push(...result.value);
        }

        scraperStats.push({
          name: result.name,
          ok: true,
          events: count,
          ms: result.duration,
        });

        if (count === 0) {
          console.warn(`[Scrape] WARN: ${result.name} returned 0 events (${dur})`);
          scraperSummaryLines.push(`  ${result.name}: 0 events (${dur}) [WARN: empty]`);
        } else {
          scraperSummaryLines.push(`  ${result.name}: ${count} events (${dur})`);
        }
      } else {
        failCount++;
        const errDetail = formatErrorDetails(result.reason);
        scraperStats.push({
          name: result.name,
          ok: false,
          events: 0,
          ms: result.duration,
          error: errDetail.slice(0, 200),
        });
        console.error(`[Scrape] ERROR: ${result.name} failed (${dur}): ${errDetail}`);
        scraperSummaryLines.push(`  ${result.name}: FAILED (${dur}) - ${errDetail}`);
      }
    }

    // Log scraper results table
    console.log(`[Scrape] ── Scraper Results (${formatDuration(stats.scraping.duration)}) ──`);
    console.log(
      `[Scrape] ${successCount} succeeded, ${failCount} failed, ${stats.scraping.total} total events`
    );
    for (const line of scraperSummaryLines) {
      console.log(`[Scrape] ${line}`);
    }

    // Facebook scraping (separate due to browser requirements)
    if (isFacebookEnabled()) {
      const fbStart = Date.now();
      try {
        console.log('[Scrape] Attempting Facebook scrape...');
        const fbRawEvents = await scrapeFacebookEvents();
        // Filter out low-interest events (must have >=4 going OR >=9 interested)
        const fbEvents = fbRawEvents.filter(
          (e) =>
            (e.goingCount !== undefined && e.goingCount >= 4) ||
            (e.interestedCount !== undefined && e.interestedCount >= 9)
        );
        const fbDur = formatDuration(Date.now() - fbStart);
        console.log(
          `[Scrape] Facebook: ${fbEvents.length} events (${fbDur}), filtered ${fbRawEvents.length - fbEvents.length} low-interest`
        );
        allEvents.push(...fbEvents);
        stats.scraping.total += fbEvents.length;
        successCount++;
        scraperStats.push({
          name: 'Facebook',
          ok: true,
          events: fbEvents.length,
          ms: Date.now() - fbStart,
        });
      } catch (fbError) {
        const fbDur = formatDuration(Date.now() - fbStart);
        const fbErrDetail = formatErrorDetails(fbError);
        failCount++;
        scraperStats.push({
          name: 'Facebook',
          ok: false,
          events: 0,
          ms: Date.now() - fbStart,
          error: fbErrDetail.slice(0, 200),
        });
        console.error(`[Scrape] ERROR: Facebook failed (${fbDur}): ${fbErrDetail}`);
      }
    } else {
      skippedSources.push('Facebook');
    }

    // Upsert phase
    console.log(`[Scrape] Upserting ${allEvents.length} events to database...`);

    // Batch upserts (chunks of 10)
    const upsertStartTime = Date.now();
    const upsertBatches = chunk(allEvents, 10);

    for (const batch of upsertBatches) {
      await Promise.all(
        batch.map(async (event) => {
          try {
            const upsertResult = await db
              .insert(events)
              .values({
                sourceId: event.sourceId,
                source: event.source,
                title: event.title,
                description: event.description,
                startDate: event.startDate,
                location: event.location,
                zip: event.zip,
                organizer: event.organizer,
                price: event.price,
                url: event.url,
                imageUrl: event.imageUrl,
                tags: [], // Empty tags - AI job will populate
                interestedCount: event.interestedCount,
                goingCount: event.goingCount,
                timeUnknown: event.timeUnknown || false,
                lastSeenAt: new Date(),
              })
              .onConflictDoUpdate({
                target: events.url,
                set: {
                  title: event.title,
                  // Keep the longer description — the verify cron enriches thin
                  // descriptions, and events are never re-verified, so a raw
                  // re-scrape must not overwrite enrichment with shorter text
                  description: sql`CASE WHEN length(coalesce(${event.description ?? null}::text, '')) > length(coalesce(${events.description}, '')) THEN ${event.description ?? null}::text ELSE ${events.description} END`,
                  startDate: event.startDate,
                  location: sql`COALESCE(NULLIF(trim(${event.location ?? null}::text), ''), ${events.location})`,
                  zip: sql`COALESCE(NULLIF(trim(${event.zip ?? null}::text), ''), ${events.zip})`,
                  organizer: sql`COALESCE(NULLIF(trim(${event.organizer ?? null}::text), ''), ${events.organizer})`,
                  // Don't let a null/Unknown scrape clobber a verified price
                  price: sql`CASE WHEN NULLIF(trim(${event.price ?? null}::text), '') IS NULL OR lower(trim(${event.price ?? null}::text)) = 'unknown' THEN COALESCE(${events.price}, ${event.price ?? null}::text) ELSE ${event.price ?? null}::text END`,
                  imageUrl: sql`COALESCE(NULLIF(trim(${event.imageUrl ?? null}::text), ''), ${events.imageUrl})`,
                  interestedCount: event.interestedCount,
                  goingCount: event.goingCount,
                  lastSeenAt: new Date(),
                  // Note: tags are NOT updated on conflict - preserves AI-generated tags
                },
              })
              // xmax = 0 only for a freshly inserted row; on the update path it holds
              // the locking transaction id. Costs no extra round trip.
              .returning({ inserted: sql<boolean>`(xmax = 0)` });
            stats.upsert.success++;
            const src = event.source;
            if (!stats.upsert.bySource[src])
              stats.upsert.bySource[src] = { inserted: 0, updated: 0, failed: 0 };
            if (upsertResult[0]?.inserted) {
              stats.upsert.inserted++;
              stats.upsert.bySource[src].inserted++;
            } else {
              stats.upsert.updated++;
              stats.upsert.bySource[src].updated++;
            }
          } catch (err) {
            stats.upsert.failed++;
            const src = event.source;
            if (!stats.upsert.bySource[src])
              stats.upsert.bySource[src] = { inserted: 0, updated: 0, failed: 0 };
            stats.upsert.bySource[src].failed++;
            console.error(
              `[Scrape] Upsert failed: "${event.title}" (${event.source}, url=${event.url}): ${formatErrorDetails(err)}`
            );
          }
        })
      );
    }
    stats.upsert.duration = Date.now() - upsertStartTime;
    console.log(
      `[Scrape] Upsert complete in ${formatDuration(stats.upsert.duration)}: ${stats.upsert.inserted} inserted, ${stats.upsert.updated} updated, ${stats.upsert.failed} failed`
    );

    // Log per-source upsert breakdown for any source that added rows or hit failures
    const notableSources = Object.entries(stats.upsert.bySource).filter(
      ([, c]) => c.inserted > 0 || c.failed > 0
    );
    if (notableSources.length > 0) {
      console.log('[Scrape] ── Upsert by Source ──');
      for (const [src, counts] of notableSources) {
        console.log(
          `[Scrape]   ${src}: ${counts.inserted} new, ${counts.updated} updated, ${counts.failed} failed`
        );
      }
    }

    // Deduplication
    const dedupStartTime = Date.now();
    console.log('[Scrape] Running deduplication...');
    const allDbEvents = await db
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

    const duplicateGroups = findDuplicates(allDbEvents);
    const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);
    const fieldUpdates = getFieldUpdates(duplicateGroups);
    stats.dedup.removed = duplicateIdsToRemove.length;

    // Count duplicates by method
    for (const group of duplicateGroups) {
      const methods = group.method.split(',');
      for (const method of methods) {
        stats.dedup.byMethod[method] = (stats.dedup.byMethod[method] || 0) + group.remove.length;
      }
    }

    // Log duplicate groups for visibility
    for (const group of duplicateGroups) {
      console.log(`[Scrape] Dedup: Keep "${group.keep.title}" (${group.keep.id.substring(0, 6)})`);
      for (const removed of group.remove) {
        console.log(
          `[Scrape]   Remove: "${removed.title}" (${removed.id.substring(0, 6)}) via Method ${group.method}`
        );
      }
    }

    // Salvage the losers' data onto the winner before soft-deleting them, so a
    // failure here cannot strand an image or price on a now-hidden row.
    if (fieldUpdates.length > 0) {
      const mergedFieldCounts: Record<string, number> = {};
      for (const update of fieldUpdates) {
        await db.update(events).set(update.fields).where(eq(events.id, update.id));
        for (const field of Object.keys(update.fields)) {
          mergedFieldCounts[field] = (mergedFieldCounts[field] || 0) + 1;
        }
      }
      const fieldSummary = Object.entries(mergedFieldCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([field, count]) => `${field}=${count}`)
        .join(', ');
      console.log(
        `[Scrape] Deduplication: merged data into ${fieldUpdates.length} kept events (${fieldSummary}).`
      );
    }

    if (duplicateIdsToRemove.length > 0) {
      // Soft-delete (set deduped_at) rather than hard-delete so a bad merge can
      // be recovered by clearing deduped_at + setting dedup_skip=true.
      await db
        .update(events)
        .set({ dedupedAt: new Date() })
        .where(inArray(events.id, duplicateIdsToRemove));
      const methodSummary = Object.entries(stats.dedup.byMethod)
        .map(([m, c]) => `${m}=${c}`)
        .join(', ');
      console.log(
        `[Scrape] Deduplication: soft-deleted ${duplicateIdsToRemove.length} duplicates in ${formatDuration(Date.now() - dedupStartTime)} (by method: ${methodSummary})`
      );
    } else {
      console.log(
        `[Scrape] Deduplication: no duplicates found (${formatDuration(Date.now() - dedupStartTime)}).`
      );
    }

    // Get post-run event count
    const [postCount] = await db.select({ count: sql<number>`count(*)::int` }).from(events);
    stats.dbEventsAfter = postCount.count;

    // Invalidate cache so home page shows updated events
    invalidateEventsCache();

    // Final summary
    const totalDuration = Date.now() - jobStartTime;
    console.log('[Scrape] ────────────────────────────────────────────────');
    console.log(`[Scrape] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log('[Scrape] ────────────────────────────────────────────────');
    console.log(
      `[Scrape] Scraped: ${stats.scraping.total} events from ${successCount}/${SCRAPERS.length} sources (${formatDuration(stats.scraping.duration)})`
    );
    console.log(
      `[Scrape] Upserted: ${stats.upsert.success} ok, ${stats.upsert.failed} failed (${formatDuration(stats.upsert.duration)})`
    );
    console.log(
      `[Scrape] Dedup: ${stats.dedup.removed} removed${
        Object.keys(stats.dedup.byMethod).length > 0
          ? ` (${Object.entries(stats.dedup.byMethod)
              .map(([m, c]) => `${m}=${c}`)
              .join(', ')})`
          : ''
      }`
    );
    console.log(
      `[Scrape] DB events: ${stats.dbEventsBefore} before -> ${stats.dbEventsAfter} after (net ${stats.dbEventsAfter >= stats.dbEventsBefore ? '+' : ''}${stats.dbEventsAfter - stats.dbEventsBefore})`
    );
    console.log('[Scrape] ════════════════════════════════════════════════');

    const result = {
      scraped: stats.scraping.total,
      upserted: stats.upsert.success,
      inserted: stats.upsert.inserted,
      updated: stats.upsert.updated,
      duplicatesRemoved: stats.dedup.removed,
      skippedSources,
      scrapers: scraperStats,
      insertedBySource: Object.fromEntries(
        Object.entries(stats.upsert.bySource)
          .filter(([, c]) => c.inserted > 0)
          .map(([src, c]) => [src, c.inserted])
      ),
      failures: {
        upsert: stats.upsert.failed,
        scrapers: failCount,
      },
      dbEventsBefore: stats.dbEventsBefore,
      dbEventsAfter: stats.dbEventsAfter,
    };

    await completeCronJob(runId, result);

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats: result,
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error('[Scrape] ════════════════════════════════════════════════');
    console.error(`[Scrape] JOB FAILED after ${formatDuration(totalDuration)}`);
    console.error(`[Scrape] Error: ${formatErrorDetails(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[Scrape] Stack: ${error.stack}`);
    }
    console.error('[Scrape] ════════════════════════════════════════════════');

    await failCronJob(runId, error);

    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
