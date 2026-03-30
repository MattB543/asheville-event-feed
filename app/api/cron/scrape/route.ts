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
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { inArray, eq, sql } from 'drizzle-orm';
import type { ScrapedEvent } from '@/lib/scrapers/types';
import { env, isFacebookEnabled } from '@/lib/config/env';
import { findDuplicates, getIdsToRemove, getDescriptionUpdates } from '@/lib/utils/deduplication';
import { verifyAuthToken } from '@/lib/utils/auth';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';

export const maxDuration = 800; // 13+ minutes (requires Fluid Compute)

// Helper to format duration in human-readable form
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

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
}

const SCRAPERS: ScraperDef[] = [
  { name: 'AVL Today', fn: scrapeAvlToday, stripTags: true },
  { name: 'Eventbrite', fn: () => scrapeEventbrite(25), stripTags: true },
  { name: 'Meetup', fn: () => scrapeMeetup(30), stripTags: true },
  { name: "Harrah's", fn: scrapeHarrahs },
  { name: 'Orange Peel', fn: scrapeOrangePeel },
  { name: 'Grey Eagle', fn: scrapeGreyEagle },
  { name: 'Live Music AVL', fn: scrapeLiveMusicAvl },
  { name: 'Mountain Xpress', fn: scrapeMountainX },
  { name: 'UNCA', fn: scrapeUncaEvents },
  { name: 'Static Age', fn: scrapeStaticAge },
  { name: 'Revolve', fn: scrapeRevolve },
  { name: 'BMC Museum', fn: scrapeBMCMuseum },
  { name: 'Asheville on Bikes', fn: scrapeAshevilleOnBikes },
  { name: 'Explore Asheville', fn: scrapeExploreAsheville },
  { name: 'Misfit Improv', fn: scrapeMisfitImprov },
  { name: 'UDharma', fn: scrapeUDharma },
  { name: 'NC Stage', fn: scrapeNCStage },
  { name: 'Story Parlor', fn: scrapeStoryParlor },
  { name: 'Theater Alliance', fn: scrapeTheaterAlliance },
  { name: 'PechaKucha', fn: scrapePechaKucha },
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
  const runId = await startCronJob('scrape');

  // Stats tracking
  const stats = {
    scraping: { duration: 0, total: 0 },
    upsert: {
      duration: 0,
      success: 0,
      failed: 0,
      bySource: {} as Record<string, { success: number; failed: number }>,
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

    // Scrape all sources in parallel (each with its own timer)
    console.log(`[Scrape] Scraping ${SCRAPERS.length} sources in parallel...`);
    const scrapeStartTime = Date.now();
    const timedScrapers = SCRAPERS.map(async (scraper) => {
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

        if (count === 0) {
          console.warn(`[Scrape] WARN: ${result.name} returned 0 events (${dur})`);
          scraperSummaryLines.push(`  ${result.name}: 0 events (${dur}) [WARN: empty]`);
        } else {
          scraperSummaryLines.push(`  ${result.name}: ${count} events (${dur})`);
        }
      } else {
        failCount++;
        const errDetail = formatErrorDetails(result.reason);
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
      } catch (fbError) {
        const fbDur = formatDuration(Date.now() - fbStart);
        console.error(`[Scrape] ERROR: Facebook failed (${fbDur}): ${formatErrorDetails(fbError)}`);
      }
    }

    // Upsert phase
    console.log(`[Scrape] Upserting ${allEvents.length} events to database...`);

    // Helper to chunk arrays
    const chunk = <T>(arr: T[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
      );

    // Batch upserts (chunks of 10)
    const upsertStartTime = Date.now();
    const upsertBatches = chunk(allEvents, 10);

    for (const batch of upsertBatches) {
      await Promise.all(
        batch.map(async (event) => {
          try {
            await db
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
                  description: event.description,
                  startDate: event.startDate,
                  location: event.location,
                  zip: event.zip,
                  organizer: event.organizer,
                  price: event.price,
                  imageUrl: event.imageUrl,
                  interestedCount: event.interestedCount,
                  goingCount: event.goingCount,
                  lastSeenAt: new Date(),
                  // Note: tags are NOT updated on conflict - preserves AI-generated tags
                },
              });
            stats.upsert.success++;
            const src = event.source;
            if (!stats.upsert.bySource[src]) stats.upsert.bySource[src] = { success: 0, failed: 0 };
            stats.upsert.bySource[src].success++;
          } catch (err) {
            stats.upsert.failed++;
            const src = event.source;
            if (!stats.upsert.bySource[src]) stats.upsert.bySource[src] = { success: 0, failed: 0 };
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
      `[Scrape] Upsert complete in ${formatDuration(stats.upsert.duration)}: ${stats.upsert.success} succeeded, ${stats.upsert.failed} failed`
    );

    // Log per-source upsert breakdown if any failures occurred
    if (stats.upsert.failed > 0) {
      console.log('[Scrape] ── Upsert by Source ──');
      for (const [src, counts] of Object.entries(stats.upsert.bySource)) {
        if (counts.failed > 0) {
          console.log(`[Scrape]   ${src}: ${counts.success} ok, ${counts.failed} failed`);
        }
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
      })
      .from(events);

    const duplicateGroups = findDuplicates(allDbEvents);
    const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);
    const descriptionUpdates = getDescriptionUpdates(duplicateGroups);
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

    // Apply description merges before deleting duplicates
    // (keep the longer description from removed events)
    if (descriptionUpdates.length > 0) {
      for (const update of descriptionUpdates) {
        await db
          .update(events)
          .set({ description: update.description })
          .where(eq(events.id, update.id));
      }
      console.log(
        `[Scrape] Deduplication: merged ${descriptionUpdates.length} longer descriptions.`
      );
    }

    if (duplicateIdsToRemove.length > 0) {
      await db.delete(events).where(inArray(events.id, duplicateIdsToRemove));
      const methodSummary = Object.entries(stats.dedup.byMethod)
        .map(([m, c]) => `${m}=${c}`)
        .join(', ');
      console.log(
        `[Scrape] Deduplication: removed ${duplicateIdsToRemove.length} duplicates in ${formatDuration(Date.now() - dedupStartTime)} (by method: ${methodSummary})`
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
      duplicatesRemoved: stats.dedup.removed,
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
