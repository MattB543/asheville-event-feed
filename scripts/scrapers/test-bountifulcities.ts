/**
 * Test Script for the Bountiful Cities scraper (public Google Calendar ICS)
 *
 * Scrape-only: prints every event plus the shared checks in civicChecks.ts (non-NC and
 * online/virtual filters, url/sourceId uniqueness, dedup merging two different events).
 * Exits 1 when any check finds a problem.
 *
 * Usage:
 *   npx tsx scripts/scrapers/test-bountifulcities.ts
 *   TZ=UTC npx tsx scripts/scrapers/test-bountifulcities.ts   # as on Vercel
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Set up debug directory BEFORE importing scraper
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-bountifulcities');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
process.env.DEBUG_DIR = DEBUG_DIR;

import { scrapeBountifulCities } from '../../lib/scrapers/bountifulcities';
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
  const events = await scrapeBountifulCities();
  console.log(`\nEvents found: ${events.length}\n`);

  // Some entries (a share market with no notes) have no description, and that's fine.
  const problems = checkEvents(events).filter((p) => !p.startsWith('Missing description:'));

  for (const e of events) {
    console.log(`${formatDate(e.startDate)} | ${e.title} | ${e.price}`);
    console.log(`    ${e.location}${e.zip ? ` [${e.zip}]` : ''}`);
    console.log(`    ${e.url}`);
    if (e.description) console.log(`    ${e.description.replace(/\n+/g, ' / ').slice(0, 160)}`);
  }
  console.log(`\nDebug files: ${DEBUG_DIR}`);
  exitOnProblems(problems);
}

main().catch((error) => {
  console.error('TEST FAILED', error);
  process.exit(1);
});
