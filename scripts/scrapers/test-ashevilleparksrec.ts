/**
 * Test Script for the City of Asheville Parks & Recreation (WebTrac) Scraper
 *
 * Scrape-only: runs the scraper in debug mode, saving raw pages and the
 * formatted events to a debug folder, and never touches the database. Exits
 * nonzero when the scrape fails or its output has problems.
 *
 * Usage:
 *   npx tsx scripts/scrapers/test-ashevilleparksrec.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Set up debug directory BEFORE importing scraper
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-ashevilleparksrec');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
process.env.DEBUG_DIR = DEBUG_DIR;

// Import scraper AFTER setting DEBUG_DIR
import { scrapeAshevilleParksRec } from '../../lib/scrapers/ashevilleparksrec';
import { ScrapedEvent } from '../../lib/scrapers/types';
import { formatDateEastern, getStartOfTodayEastern } from '../../lib/utils/timezone';

const SOURCE = 'ASHEVILLE_PARKS_REC';

async function runScraperTest(): Promise<ScrapedEvent[]> {
  console.log('='.repeat(70));
  console.log('SCRAPER TEST - CITY OF ASHEVILLE PARKS & RECREATION');
  console.log('='.repeat(70));
  console.log();
  console.log(`Debug output directory: ${DEBUG_DIR}`);
  console.log();

  const startTime = Date.now();
  const events = await scrapeAshevilleParksRec();
  const duration = Date.now() - startTime;

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
    const withZips = events.filter((e) => e.zip).length;
    const withPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
    const freeEvents = events.filter((e) => e.price === 'Free').length;
    const timeUnknown = events.filter((e) => e.timeUnknown).length;

    console.log('FIELD COVERAGE:');
    console.log(`  With descriptions: ${withDescriptions}/${events.length}`);
    console.log(`  With zips:         ${withZips}/${events.length}`);
    console.log(`  With prices:       ${withPrices}/${events.length}`);
    console.log(`  Free events:       ${freeEvents}`);
    console.log(`  Time unknown:      ${timeUnknown}`);
    console.log();

    console.log('EVENTS BY ORGANIZER / FACILITY:');
    const byOrganizer = new Map<string, number>();
    for (const event of events) {
      const key = event.organizer || '(none)';
      byOrganizer.set(key, (byOrganizer.get(key) || 0) + 1);
    }
    for (const [organizer, count] of [...byOrganizer].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${organizer}`);
    }
    console.log();

    const dates = events.map((e) => e.startDate).sort((a, b) => a.getTime() - b.getTime());
    console.log('DATE RANGE:');
    console.log(`  Earliest: ${formatDate(dates[0])}`);
    console.log(`  Latest:   ${formatDate(dates[dates.length - 1])}`);
    console.log();

    console.log('SAMPLE EVENTS (first 8):');
    console.log('-'.repeat(70));
    for (const event of events.slice(0, 8)) {
      console.log();
      console.log(`  Title: ${event.title}`);
      console.log(`  Date (ET): ${formatDate(event.startDate)}`);
      console.log(`  Location: ${event.location}`);
      console.log(`  Organizer: ${event.organizer}`);
      console.log(`  Price: ${event.price}`);
      console.log(`  URL: ${event.url}`);
      console.log(`  Description:\n    ${(event.description || '').replace(/\n/g, '\n    ')}`);
    }
  }

  console.log();
  console.log(`Debug files saved to: ${DEBUG_DIR}`);
  return events;
}

/** Everything that would make this output unsafe or useless to upsert. */
function findProblems(events: ScrapedEvent[]): string[] {
  if (events.length === 0) return ['No events returned'];

  const problems: string[] = [];
  const startOfToday = getStartOfTodayEastern();

  const duplicates = (values: string[]) => [
    ...new Set(values.filter((value, i) => values.indexOf(value) !== i)),
  ];
  for (const url of duplicates(events.map((e) => e.url))) {
    problems.push(`Duplicate URL (violates the unique constraint): ${url}`);
  }
  for (const sourceId of duplicates(events.map((e) => e.sourceId))) {
    problems.push(`Duplicate sourceId: ${sourceId}`);
  }

  for (const event of events) {
    const label = `"${event.title || '(untitled)'}" (${event.sourceId})`;
    if (event.source !== SOURCE) problems.push(`${label}: source is ${event.source}`);
    if (!event.title?.trim()) problems.push(`${label}: no title`);
    if (!event.url?.startsWith('https://')) problems.push(`${label}: bad URL ${event.url}`);
    if (!event.location?.trim()) problems.push(`${label}: no location`);
    if (!event.description?.trim()) problems.push(`${label}: no description`);
    if (!event.price) problems.push(`${label}: no price`);
    if (Number.isNaN(event.startDate.getTime())) {
      problems.push(`${label}: invalid start date`);
    } else if (event.startDate < startOfToday) {
      problems.push(`${label}: starts in the past (${formatDate(event.startDate)})`);
    }
  }

  return problems;
}

async function main() {
  let problems: string[];
  try {
    problems = findProblems(await runScraperTest());
  } catch (error) {
    console.error();
    console.error('TEST FAILED');
    console.error('='.repeat(70));
    console.error(error);
    process.exit(1);
  }

  console.log();
  if (problems.length > 0) {
    console.error(`PROBLEMS (${problems.length}):`);
    for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('No problems found.');
}

function formatDate(date: Date): string {
  return formatDateEastern(date, {
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
