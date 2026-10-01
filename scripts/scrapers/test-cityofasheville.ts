/**
 * Test Script for the City of Asheville scraper (City Council, boards and commissions)
 *
 * Scrape-only: prints every event plus the checks in civicChecks.ts (location filters the feed
 * applies, url/sourceId uniqueness, dedup merging two different meetings). Exits 1 when any check
 * finds a problem, so it can gate a change.
 *
 * Usage:
 *   npx tsx scripts/scrapers/test-cityofasheville.ts
 *   TZ=UTC npx tsx scripts/scrapers/test-cityofasheville.ts   # as on Vercel
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Set up debug directory BEFORE importing scraper
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-cityofasheville');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
process.env.DEBUG_DIR = DEBUG_DIR;

import { scrapeCityOfAsheville } from '../../lib/scrapers/cityofasheville';
import { checkEvents, exitOnProblems } from './civicChecks';

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('SCRAPER TEST - CITY OF ASHEVILLE');
  console.log('='.repeat(70));

  const start = Date.now();
  const events = await scrapeCityOfAsheville();
  console.log();
  console.log(`Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`Events found: ${events.length}`);
  console.log();

  const in30 = events.filter((e) => e.startDate.getTime() < Date.now() + 30 * 86400000);
  const byFormat: Record<string, number> = {};
  for (const e of in30) {
    const format =
      e.location === 'Remote meeting'
        ? 'remote'
        : /\(hybrid\)/i.test(e.title)
          ? 'hybrid'
          : e.location
            ? 'in person'
            : 'no location';
    byFormat[format] = (byFormat[format] || 0) + 1;
  }
  console.log(`NEXT 30 DAYS: ${in30.length} events`, byFormat);
  console.log();

  const problems = checkEvents(events);

  console.log('ALL EVENTS:');
  console.log('-'.repeat(70));
  for (const e of events) {
    console.log();
    console.log(
      `  ${formatDate(e.startDate)} | ${e.title}${e.timeUnknown ? ' (time unknown)' : ''}`
    );
    console.log(`    Location: ${e.location ?? '(none)'}${e.zip ? ` [${e.zip}]` : ''}`);
    console.log(`    Price: ${e.price} | sourceId: ${e.sourceId}`);
    console.log(`    URL: ${e.url}`);
    console.log(`    ${(e.description ?? '').split('\n').join('\n    ')}`);
  }
  console.log();
  console.log(`Debug files: ${DEBUG_DIR}`);
  exitOnProblems(problems);
}

main().catch((error) => {
  console.error('TEST FAILED', error);
  process.exit(1);
});
