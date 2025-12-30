import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { isFacebookEnabled } from '../../lib/config/env';
import { scrapeAvlToday } from '../../lib/scrapers/avltoday';
import { scrapeEventbrite } from '../../lib/scrapers/eventbrite';
import { scrapeMeetup } from '../../lib/scrapers/meetup';
import { scrapeHarrahs } from '../../lib/scrapers/harrahs';
import { scrapeOrangePeel } from '../../lib/scrapers/orangepeel';
import { scrapeGreyEagle } from '../../lib/scrapers/greyeagle';
import { scrapeLiveMusicAvl } from '../../lib/scrapers/livemusicavl';
import { scrapeExploreAsheville } from '../../lib/scrapers/exploreasheville';
import { scrapeMisfitImprov } from '../../lib/scrapers/misfitimprov';
import { scrapeUDharma } from '../../lib/scrapers/udharma';
import { scrapeNCStage } from '../../lib/scrapers/ncstage';
import { scrapeStoryParlor } from '../../lib/scrapers/storyparlor';
import { scrapeMountainX } from '../../lib/scrapers/mountainx';
import { scrapeStaticAge } from '../../lib/scrapers/staticage';
import { scrapeRevolve } from '../../lib/scrapers/revolve';
import { scrapeBMCMuseum } from '../../lib/scrapers/bmcmuseum';
import { scrapeFacebookEvents } from '../../lib/scrapers/facebook';
import type { EventSource, ScrapedEventWithTags } from '../../lib/scrapers/types';

type RunResult = {
  label: string;
  source: EventSource;
  scraped: number;
  upserted: number;
  failed: number;
  beforeCount: number;
  afterCount: number;
  durationMs: number;
  skipped?: boolean;
  error?: string;
};

const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

async function countBySource(source: EventSource): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(eq(events.source, source));
  return Number(result[0]?.count ?? 0);
}

async function upsertEvents(scrapedEvents: ScrapedEventWithTags[]) {
  let success = 0;
  let failed = 0;

  for (const batch of chunk(scrapedEvents, 10)) {
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
              tags: event.tags ?? [],
              interestedCount: event.interestedCount,
              goingCount: event.goingCount,
              timeUnknown: event.timeUnknown ?? false,
              recurringType: event.recurringType,
              recurringEndDate: event.recurringEndDate,
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
                timeUnknown: event.timeUnknown ?? false,
                recurringType: event.recurringType,
                recurringEndDate: event.recurringEndDate,
                lastSeenAt: new Date(),
              },
            });
          success++;
        } catch (err) {
          failed++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`  Failed to upsert "${event.title}" (${event.source}): ${message}`);
        }
      })
    );
  }

  return { success, failed };
}

async function runScraper(
  label: string,
  source: EventSource,
  scrape: () => Promise<ScrapedEventWithTags[]>,
  options?: { filter?: (events: ScrapedEventWithTags[]) => ScrapedEventWithTags[] }
): Promise<RunResult> {
  console.log('='.repeat(70));
  console.log(`Running ${label} scraper`);
  console.log('='.repeat(70));

  const beforeCount = await countBySource(source);
  const started = Date.now();

  try {
    const rawEvents = await scrape();
    const eventsToInsert = options?.filter ? options.filter(rawEvents) : rawEvents;

    console.log(`Scraped ${eventsToInsert.length} events`);
    const { success, failed } = await upsertEvents(eventsToInsert);
    const afterCount = await countBySource(source);

    console.log(`Upserted ${success} events (${failed} failed)`);
    console.log(`Count before: ${beforeCount} after: ${afterCount} delta: ${afterCount - beforeCount}`);
    console.log(`Duration: ${formatDuration(Date.now() - started)}`);
    console.log('');

    return {
      label,
      source,
      scraped: eventsToInsert.length,
      upserted: success,
      failed,
      beforeCount,
      afterCount,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${label} failed: ${message}`);
    console.log('');

    return {
      label,
      source,
      scraped: 0,
      upserted: 0,
      failed: 0,
      beforeCount,
      afterCount: beforeCount,
      durationMs: Date.now() - started,
      error: message,
    };
  }
}

async function main() {
  const results: RunResult[] = [];
  const runStarted = Date.now();
  const startFrom = process.env.SCRAPER_START?.toUpperCase();
  const onlyList = process.env.SCRAPER_ONLY
    ?.split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  const runs = [
    { label: 'AVL Today', source: 'AVL_TODAY', scrape: () => scrapeAvlToday() },
    { label: 'Eventbrite', source: 'EVENTBRITE', scrape: () => scrapeEventbrite(25) },
    { label: 'Meetup', source: 'MEETUP', scrape: () => scrapeMeetup(30) },
    { label: 'Harrahs', source: 'HARRAHS', scrape: () => scrapeHarrahs() },
    { label: 'Orange Peel', source: 'ORANGE_PEEL', scrape: () => scrapeOrangePeel() },
    { label: 'Grey Eagle', source: 'GREY_EAGLE', scrape: () => scrapeGreyEagle() },
    { label: 'Live Music AVL', source: 'LIVE_MUSIC_AVL', scrape: () => scrapeLiveMusicAvl() },
    { label: 'Explore Asheville', source: 'EXPLORE_ASHEVILLE', scrape: () => scrapeExploreAsheville() },
    { label: 'Misfit Improv', source: 'MISFIT_IMPROV', scrape: () => scrapeMisfitImprov() },
    { label: 'UDharma', source: 'UDHARMA', scrape: () => scrapeUDharma() },
    { label: 'NC Stage', source: 'NC_STAGE', scrape: () => scrapeNCStage() },
    { label: 'Story Parlor', source: 'STORY_PARLOR', scrape: () => scrapeStoryParlor() },
    { label: 'Mountain Xpress', source: 'MOUNTAIN_X', scrape: () => scrapeMountainX() },
    { label: 'Static Age', source: 'STATIC_AGE', scrape: () => scrapeStaticAge() },
    { label: 'Revolve', source: 'REVOLVE', scrape: () => scrapeRevolve() },
    { label: 'BMC Museum', source: 'BMC_MUSEUM', scrape: () => scrapeBMCMuseum() },
  ] as const;

  let runsToExecute = runs;
  if (startFrom) {
    const startIndex = runs.findIndex(
      (run) => run.source === startFrom || run.label.toUpperCase() === startFrom
    );
    if (startIndex >= 0) {
      runsToExecute = runs.slice(startIndex);
      console.log(`Starting from ${runsToExecute[0].label} due to SCRAPER_START=${startFrom}`);
      console.log('');
    } else if (startFrom !== 'FACEBOOK') {
      console.log(`SCRAPER_START=${startFrom} did not match a scraper; running full list.`);
      console.log('');
    }
  }

  if (onlyList && onlyList.length > 0) {
    const filtered = runsToExecute.filter(
      (run) =>
        onlyList.includes(run.source) || onlyList.includes(run.label.toUpperCase())
    );
    runsToExecute = filtered;
    console.log(`Limiting to SCRAPER_ONLY=${onlyList.join(', ')}`);
    console.log('');
  }

  for (const run of runsToExecute) {
    const result = await runScraper(run.label, run.source, run.scrape);
    results.push(result);
  }

  const shouldRunFacebook = onlyList
    ? onlyList.includes('FACEBOOK')
    : isFacebookEnabled();

  if (shouldRunFacebook && isFacebookEnabled()) {
    const fbResult = await runScraper(
      'Facebook',
      'FACEBOOK',
      async () => {
        const all = await scrapeFacebookEvents();
        const filtered = all.filter(
          (e) =>
            (e.goingCount !== undefined && e.goingCount >= 4) ||
            (e.interestedCount !== undefined && e.interestedCount >= 9)
        );
        const filteredOut = all.length - filtered.length;
        if (filteredOut > 0) {
          console.log(`Facebook filter removed ${filteredOut} low-interest events`);
        }
        return filtered;
      }
    );
    results.push(fbResult);
  } else if (shouldRunFacebook) {
    console.log('Facebook requested but disabled by env; skipping.');
    console.log('');
    const beforeCount = await countBySource('FACEBOOK');
    results.push({
      label: 'Facebook',
      source: 'FACEBOOK',
      scraped: 0,
      upserted: 0,
      failed: 0,
      beforeCount,
      afterCount: beforeCount,
      durationMs: 0,
      skipped: true,
    });
  } else {
    const beforeCount = await countBySource('FACEBOOK');
    results.push({
      label: 'Facebook',
      source: 'FACEBOOK',
      scraped: 0,
      upserted: 0,
      failed: 0,
      beforeCount,
      afterCount: beforeCount,
      durationMs: 0,
      skipped: true,
    });
  }

  console.log('='.repeat(70));
  console.log('Summary');
  console.log('='.repeat(70));

  let totalScraped = 0;
  let totalUpserted = 0;
  let totalFailed = 0;

  for (const result of results) {
    const status = result.skipped ? 'SKIPPED' : result.error ? 'ERROR' : 'OK';
    console.log(
      `${result.label.padEnd(18)} | ${status.padEnd(7)} | scraped ${String(result.scraped).padStart(4)} | upserted ${String(result.upserted).padStart(4)} | failed ${String(result.failed).padStart(3)} | delta ${String(result.afterCount - result.beforeCount).padStart(4)} | ${formatDuration(result.durationMs)}`
    );
    totalScraped += result.scraped;
    totalUpserted += result.upserted;
    totalFailed += result.failed;
  }

  const totalDuration = Date.now() - runStarted;
  console.log('-'.repeat(70));
  console.log(`TOTAL scraped ${totalScraped}, upserted ${totalUpserted}, failed ${totalFailed}`);
  console.log(`Total duration: ${formatDuration(totalDuration)}`);

  const summaryPath = path.join(process.cwd(), 'claude', 'debug', 'scraper-run-summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        startedAt: new Date(runStarted).toISOString(),
        durationMs: totalDuration,
        results,
      },
      null,
      2
    )
  );
  console.log(`Summary written to ${summaryPath}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});
