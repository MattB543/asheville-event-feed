/**
 * Test Script for the Public Library Scraper
 *
 * Runs the scraper in debug mode (raw feeds + formatted events saved to a debug
 * folder) and prints per-system / per-branch counts, field coverage, the
 * expected daily volume, and a sample of events.
 *
 * Scrape-only: this script never writes to the database.
 *
 * Usage:
 *   npx tsx scripts/scrapers/test-library.ts
 *   npx tsx scripts/scrapers/test-library.ts --days 30   # count window (default 30)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Set up debug directory BEFORE importing scraper
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-library');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
process.env.DEBUG_DIR = DEBUG_DIR;

// Import scraper AFTER setting DEBUG_DIR
import { scrapeLibraries } from '../../lib/scrapers/library';
import { getLibrarySystemName } from '../../lib/config/librarySystems';
import { ScrapedEvent } from '../../lib/scrapers/types';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const countDays = Number(argValue('--days') ?? 30);

  console.log('='.repeat(70));
  console.log('SCRAPER TEST - PUBLIC LIBRARIES');
  console.log('='.repeat(70));
  console.log(`Debug output directory: ${DEBUG_DIR}`);
  console.log();

  const startTime = Date.now();
  const events = await scrapeLibraries();
  const duration = Date.now() - startTime;

  console.log();
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`Events found (full horizon): ${events.length}`);

  if (events.length === 0) {
    console.error('No events returned');
    process.exit(1);
  }

  // Validation
  const problems: string[] = [];
  const urls = new Set<string>();
  const sourceIds = new Set<string>();
  for (const e of events) {
    if (urls.has(e.url)) problems.push(`duplicate url: ${e.url}`);
    if (sourceIds.has(e.sourceId)) problems.push(`duplicate sourceId: ${e.sourceId}`);
    urls.add(e.url);
    sourceIds.add(e.sourceId);
    if (isNaN(e.startDate.getTime())) problems.push(`bad date: ${e.title}`);
    if (!e.zip || !/^\d{5}$/.test(e.zip)) problems.push(`bad zip "${e.zip}": ${e.title}`);
    if (!e.location?.includes(' NC ')) problems.push(`location missing NC: ${e.location}`);
    if (/<[a-z][^>]*>/i.test(e.description ?? ''))
      problems.push(`HTML left in description: ${e.title}`);
    if (!getLibrarySystemName(e.url))
      problems.push(`url host missing from lib/config/librarySystems.ts: ${e.url}`);
    // A first paragraph that is nothing but a branch name ("Fletcher Library")
    const firstParagraph = (e.description ?? '').split('\n')[0];
    if (/^[\w .'/-]{1,40}\blibr?ary$/i.test(firstParagraph))
      problems.push(`description opens with a branch name: ${firstParagraph}`);
    if (/^\S+ Library [A-Z]/.test(e.description ?? ''))
      problems.push(`branch name run into first sentence: ${e.description?.slice(0, 60)}`);
    if (/^(ED|ET|FL|GR|MR)\s/.test(e.title)) problems.push(`branch code left in title: ${e.title}`);
    // undefined would leave a stale stored flag in place on upsert
    if (typeof e.timeUnknown !== 'boolean') problems.push(`timeUnknown not a boolean: ${e.title}`);
  }
  console.log(`Validation problems: ${problems.length}`);
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  // Fail the run (nonzero exit) but still print the report below.
  if (problems.length > 0) process.exitCode = 1;

  // Counts for the next N days
  const cutoff = new Date(Date.now() + countDays * 24 * 60 * 60 * 1000);
  const window = events.filter((e) => e.startDate < cutoff);
  console.log();
  console.log(
    `NEXT ${countDays} DAYS: ${window.length} events (${(window.length / countDays).toFixed(1)}/day)`
  );

  const bySystem = groupCount(window, (e) => getLibrarySystemName(e.url) ?? '?');
  // Organizer is the branch (the system itself for an unmapped off-site program).
  const byBranch = groupCount(
    window,
    (e) => `${getLibrarySystemName(e.url)} | ${e.organizer} | ${e.location?.split(',')[0]}`
  );
  console.log();
  console.log('BY SYSTEM:');
  for (const [k, n] of bySystem) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log();
  console.log('BY BRANCH:');
  for (const [k, n] of byBranch) console.log(`  ${String(n).padStart(4)}  ${k}`);

  // Daily volume
  const byDay = groupCount(window, (e) =>
    e.startDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  );
  const dayCounts = byDay.map(([, n]) => n);
  console.log();
  console.log(
    `PER DAY: min ${Math.min(...dayCounts)}, max ${Math.max(...dayCounts)}, median ${median(dayCounts)} over ${byDay.length} days with events`
  );

  // Most repeated titles (story times etc.)
  const byTitle = groupCount(window, (e) => e.title.toLowerCase());
  console.log();
  console.log('MOST REPEATED TITLES:');
  for (const [k, n] of byTitle.slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  const storyTimes = window.filter((e) => /story ?time|cuento/i.test(e.title)).length;
  console.log(`  Story times: ${storyTimes} (${Math.round((storyTimes / window.length) * 100)}%)`);

  // Field coverage
  const pct = (n: number) => `${n}/${events.length} (${Math.round((n / events.length) * 100)}%)`;
  console.log();
  console.log('FIELD COVERAGE (full horizon):');
  console.log(`  With images:       ${pct(events.filter((e) => e.imageUrl).length)}`);
  console.log(`  With descriptions: ${pct(events.filter((e) => e.description).length)}`);
  console.log(`  Time unknown:      ${pct(events.filter((e) => e.timeUnknown).length)}`);
  const prices = groupCount(events, (e) => e.price ?? 'none');
  console.log(`  Prices:            ${prices.map(([p, n]) => `${p}=${n}`).join(', ')}`);

  // Samples: one per system
  console.log();
  console.log('SAMPLE (first event per system):');
  console.log('-'.repeat(70));
  const seen = new Set<string>();
  for (const e of events) {
    const system = getLibrarySystemName(e.url) ?? '';
    if (seen.has(system)) continue;
    seen.add(system);
    printEvent(e);
  }

  console.log();
  console.log(`Debug files saved to: ${DEBUG_DIR}`);
  if (problems.length > 0) console.error(`FAILED: ${problems.length} validation problem(s)`);
}

function groupCount<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function printEvent(event: ScrapedEvent): void {
  console.log();
  console.log(`  Title:     ${event.title}`);
  console.log(
    `  Date (ET): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}${event.timeUnknown ? ' (time unknown)' : ''}`
  );
  console.log(`  Organizer: ${event.organizer}`);
  console.log(`  Location:  ${event.location}`);
  console.log(`  Zip:       ${event.zip}`);
  console.log(`  Price:     ${event.price}`);
  console.log(`  URL:       ${event.url}`);
  if (event.imageUrl) console.log(`  Image:     ${event.imageUrl.slice(0, 90)}`);
  if (event.description)
    console.log(`  Desc:      ${event.description.slice(0, 160).replace(/\n/g, ' / ')}...`);
}

main().catch((error) => {
  console.error('TEST FAILED');
  console.error(error);
  process.exit(1);
});
