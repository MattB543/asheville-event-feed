/**
 * Test Script for Black Mountain College Museum Scraper
 *
 * Runs the scraper and displays results with field coverage stats
 * and timezone verification.
 *
 * Usage:
 *   npx tsx scripts/scrapers/test-bmcmuseum.ts          # Scraper test only
 *   npx tsx scripts/scrapers/test-bmcmuseum.ts --db     # Scraper + database test
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Import scraper
import { scrapeBMCMuseum } from '../../lib/scrapers/bmcmuseum';
import { ScrapedEvent } from '../../lib/scrapers/types';

const SOURCE = 'BMC_MUSEUM';
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-bmcmuseum');

async function runScraperTest(): Promise<ScrapedEvent[]> {
  console.log('='.repeat(70));
  console.log('SCRAPER TEST - BLACK MOUNTAIN COLLEGE MUSEUM');
  console.log('='.repeat(70));
  console.log();

  const startTime = Date.now();

  console.log('Running scraper...');
  console.log();

  const events = await scrapeBMCMuseum();

  const duration = Date.now() - startTime;

  // Save results to debug folder
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
  }
  fs.writeFileSync(
    path.join(DEBUG_DIR, 'events.json'),
    JSON.stringify(events, null, 2)
  );

  // Print summary
  console.log();
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log();
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`Events found: ${events.length}`);
  console.log();

  // Statistics
  if (events.length > 0) {
    const withImages = events.filter(e => e.imageUrl).length;
    const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
    const withDescriptions = events.filter(e => e.description).length;
    const freeEvents = events.filter(e => e.price === 'Free').length;

    console.log('FIELD COVERAGE:');
    console.log(`  With images:       ${withImages}/${events.length} (${pct(withImages, events.length)}%)`);
    console.log(`  With prices:       ${withPrices}/${events.length} (${pct(withPrices, events.length)}%)`);
    console.log(`  With descriptions: ${withDescriptions}/${events.length} (${pct(withDescriptions, events.length)}%)`);
    console.log(`  Free events:       ${freeEvents}`);
    console.log();

    // Price distribution
    console.log('PRICE DISTRIBUTION:');
    const priceCounts: Record<string, number> = {};
    for (const event of events) {
      const price = event.price || 'Unknown';
      priceCounts[price] = (priceCounts[price] || 0) + 1;
    }
    for (const [price, count] of Object.entries(priceCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count.toString().padStart(3)} - ${price}`);
    }
    console.log();

    // Date range
    const dates = events.map(e => e.startDate).filter(d => !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
    if (dates.length > 0) {
      console.log('DATE RANGE:');
      console.log(`  Earliest: ${formatDate(dates[0])}`);
      console.log(`  Latest:   ${formatDate(dates[dates.length - 1])}`);
      console.log();
    }

    // Sample events with timezone verification
    console.log('SAMPLE EVENTS (verify timezone!):');
    console.log('-'.repeat(70));
    for (const event of events.slice(0, 5)) {
      console.log();
      console.log(`  Title: ${event.title}`);
      console.log(`  Date (UTC):     ${event.startDate.toISOString()}`);
      console.log(`  Date (Eastern): ${formatDate(event.startDate)}`);
      if (event.location) console.log(`  Location: ${event.location}`);
      if (event.organizer) console.log(`  Organizer: ${event.organizer}`);
      if (event.price) console.log(`  Price: ${event.price}`);
      console.log(`  URL: ${event.url}`);
      if (event.imageUrl) console.log(`  Image: ${event.imageUrl.substring(0, 70)}...`);
    }
  }

  // Debug file locations
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
  // Dynamic import to avoid loading db when not needed
  const { db } = await import('../../lib/db');
  const { events } = await import('../../lib/db/schema');
  const { eq } = await import('drizzle-orm');

  console.log();
  console.log('='.repeat(70));
  console.log('DATABASE TEST');
  console.log('='.repeat(70));
  console.log();

  // Insert only first 3 events for testing
  const testEvents = scrapedEvents.slice(0, 3);
  console.log(`Inserting ${testEvents.length} test events...`);
  console.log();

  for (const event of testEvents) {
    try {
      await db.insert(events).values({
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
      }).onConflictDoUpdate({
        target: events.url,
        set: {
          title: event.title,
          description: event.description,
          startDate: event.startDate,
          price: event.price,
          imageUrl: event.imageUrl,
        },
      });
      console.log(`  Inserted: ${event.title.slice(0, 50)}`);
    } catch (err) {
      console.error(`  Failed: ${event.title.slice(0, 50)}`, err);
    }
  }

  // Query back and verify
  console.log();
  console.log('='.repeat(70));
  console.log('VERIFICATION');
  console.log('='.repeat(70));
  console.log();

  const inserted = await db.select()
    .from(events)
    .where(eq(events.source, SOURCE))
    .limit(10);

  console.log(`Found ${inserted.length} events with source='${SOURCE}'`);
  console.log();

  for (const event of inserted) {
    console.log(`Title: ${event.title}`);
    console.log(`  DB startDate: ${event.startDate}`);
    console.log(`  As Eastern: ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`  Price: ${event.price}`);
    console.log(`  URL: ${event.url}`);
    console.log();
  }

  // Cleanup instructions
  console.log('To remove test events:');
  console.log(`  npx tsx -e "import { db } from './lib/db'; import { events } from './lib/db/schema'; import { eq } from 'drizzle-orm'; await db.delete(events).where(eq(events.source, '${SOURCE}'))"`);
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
      console.log('  npx tsx scripts/scrapers/test-bmcmuseum.ts --db');
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

// Helper functions
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
