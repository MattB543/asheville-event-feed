/**
 * Test Script for the Buncombe County scraper (CivicPlus calendar ICS feeds)
 *
 * Scrape-only: prints every event plus the checks in civicChecks.ts (location filters the feed
 * applies, url/sourceId uniqueness, dedup merging two different meetings). Exits 1 when any check
 * finds a problem, so it can gate a change.
 *
 * Usage:
 *   npx tsx scripts/scrapers/test-buncombecounty.ts
 *   TZ=UTC npx tsx scripts/scrapers/test-buncombecounty.ts   # as on Vercel
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Set up debug directory BEFORE importing scraper
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-buncombecounty');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
process.env.DEBUG_DIR = DEBUG_DIR;

import { scrapeBuncombeCounty } from '../../lib/scrapers/buncombecounty';
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
  console.log('SCRAPER TEST - BUNCOMBE COUNTY');
  console.log('='.repeat(70));

  const start = Date.now();
  const events = await scrapeBuncombeCounty();
  console.log();
  console.log(`Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`Events found: ${events.length}`);
  console.log();

  // Rough grouping for the 30-day count (the scraper itself only knows feed categories)
  const in30 = events.filter((e) => e.startDate.getTime() < Date.now() + 30 * 86400000);
  const groupOf = (title: string, description = '') =>
    /early voting|election day/i.test(title)
      ? 'voting'
      : description.startsWith('Public meeting')
        ? 'civic meeting'
        : /community engagement market/i.test(title)
          ? 'community engagement market'
          : 'community program';
  const byGroup: Record<string, number> = {};
  for (const e of in30) {
    const group = groupOf(e.title, e.description);
    byGroup[group] = (byGroup[group] || 0) + 1;
  }
  console.log(`NEXT 30 DAYS: ${in30.length} events`, byGroup);
  const byPrice: Record<string, number> = {};
  for (const e of events) byPrice[e.price ?? '(none)'] = (byPrice[e.price ?? '(none)'] || 0) + 1;
  console.log('PRICES:', byPrice);
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
