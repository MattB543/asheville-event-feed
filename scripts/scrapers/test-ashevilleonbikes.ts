/**
 * Test Script for Asheville on Bikes Google Calendar Scraper
 *
 * Usage:
 *   npx tsx scripts/scrapers/test-ashevilleonbikes.ts
 *   npx tsx scripts/scrapers/test-ashevilleonbikes.ts --db
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

import { scrapeAshevilleOnBikes } from '../../lib/scrapers/ashevilleonbikes';
import { ScrapedEvent } from '../../lib/scrapers/types';

const SOURCE = 'ASHEVILLE_ON_BIKES';
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-ashevilleonbikes');

async function runScraperTest(): Promise<ScrapedEvent[]> {
  console.log('='.repeat(70));
  console.log('SCRAPER TEST - ASHEVILLE ON BIKES');
  console.log('='.repeat(70));
  console.log();

  const startTime = Date.now();
  const events = await scrapeAshevilleOnBikes();
  const duration = Date.now() - startTime;

  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(DEBUG_DIR, 'events.json'), JSON.stringify(events, null, 2));

  console.log();
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log();
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`Events found: ${events.length}`);
  console.log();

  if (events.length > 0) {
    const withDescriptions = events.filter((e) => e.description).length;
    const withLocations = events.filter((e) => e.location).length;
    const withUrls = events.filter((e) => e.url).length;
    const withKnownPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
    const timeUnknownCount = events.filter((e) => e.timeUnknown).length;

    console.log('FIELD COVERAGE:');
    console.log(
      `  With descriptions: ${withDescriptions}/${events.length} (${pct(
        withDescriptions,
        events.length
      )}%)`
    );
    console.log(
      `  With locations:    ${withLocations}/${events.length} (${pct(
        withLocations,
        events.length
      )}%)`
    );
    console.log(
      `  With URLs:         ${withUrls}/${events.length} (${pct(withUrls, events.length)}%)`
    );
    console.log(
      `  With prices:       ${withKnownPrices}/${events.length} (${pct(
        withKnownPrices,
        events.length
      )}%)`
    );
    console.log(`  Time unknown:      ${timeUnknownCount}`);
    console.log();

    const dates = events
      .map((e) => e.startDate)
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length > 0) {
      console.log('DATE RANGE:');
      console.log(`  Earliest: ${formatDate(dates[0])}`);
      console.log(`  Latest:   ${formatDate(dates[dates.length - 1])}`);
      console.log();
    }

    console.log('SAMPLE EVENTS (verify timezone!):');
    console.log('-'.repeat(70));
    for (const event of events.slice(0, 5)) {
      console.log();
      console.log(`  Title: ${event.title}`);
      console.log(`  Date (UTC):     ${event.startDate.toISOString()}`);
      console.log(`  Date (Eastern): ${formatDate(event.startDate)}`);
      console.log(`  Time unknown:   ${event.timeUnknown ? 'yes' : 'no'}`);
      if (event.location) console.log(`  Location: ${event.location}`);
      if (event.price) console.log(`  Price: ${event.price}`);
      console.log(`  URL: ${event.url}`);
    }
  }

  console.log();
  console.log('='.repeat(70));
  console.log('DEBUG FILES');
  console.log('='.repeat(70));
  console.log();
  console.log(`Saved to: ${DEBUG_DIR}`);
  console.log();

  return events;
}

async function runDatabaseTest(scrapedEvents: ScrapedEvent[]): Promise<void> {
  const { db } = await import('../../lib/db');
  const { events } = await import('../../lib/db/schema');
  const { eq } = await import('drizzle-orm');

  console.log();
  console.log('='.repeat(70));
  console.log('DATABASE TEST');
  console.log('='.repeat(70));
  console.log();

  const testEvents = scrapedEvents.slice(0, 3);
  console.log(`Inserting ${testEvents.length} test events...`);
  console.log();

  for (const event of testEvents) {
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
          tags: [],
          timeUnknown: event.timeUnknown || false,
        })
        .onConflictDoUpdate({
          target: events.url,
          set: {
            title: event.title,
            description: event.description,
            startDate: event.startDate,
            location: event.location,
            price: event.price,
            imageUrl: event.imageUrl,
          },
        });
      console.log(`  Inserted: ${event.title.slice(0, 60)}`);
    } catch (err) {
      console.error(`  Failed: ${event.title.slice(0, 60)}`, err);
    }
  }

  console.log();
  console.log('='.repeat(70));
  console.log('VERIFICATION');
  console.log('='.repeat(70));
  console.log();

  const inserted = await db.select().from(events).where(eq(events.source, SOURCE)).limit(10);

  console.log(`Found ${inserted.length} events with source='${SOURCE}'`);
  console.log();

  for (const event of inserted) {
    console.log(`Title: ${event.title}`);
    console.log(`  DB startDate: ${event.startDate}`);
    console.log(
      `  As Eastern: ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
    console.log(`  Price: ${event.price}`);
    console.log(`  URL: ${event.url}`);
    console.log();
  }

  console.log('To remove test events:');
  console.log(
    `  npx tsx -e "import { db } from './lib/db'; import { events } from './lib/db/schema'; import { eq } from 'drizzle-orm'; await db.delete(events).where(eq(events.source, '${SOURCE}'))"`
  );
}

async function main() {
  const runDbTest = process.argv.includes('--db');

  try {
    const events = await runScraperTest();

    if (runDbTest) {
      await runDatabaseTest(events);
    } else {
      console.log();
      console.log('To also test database insertion, run with --db flag:');
      console.log('  npx tsx scripts/scrapers/test-ashevilleonbikes.ts --db');
      console.log();
    }
  } catch (error) {
    console.error();
    console.error('TEST FAILED');
    console.error('='.repeat(70));
    console.error(error);
    process.exit(1);
  }
}

function pct(a: number, b: number): string {
  return b === 0 ? '0' : Math.round((a / b) * 100).toString();
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

main();
