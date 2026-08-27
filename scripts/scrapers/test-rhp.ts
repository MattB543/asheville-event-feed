/**
 * Test harness for all rhp-events venue scrapers.
 *
 * One script covers every venue because they share lib/scrapers/rhp.ts —
 * five near-identical test scripts would add nothing.
 *
 * Usage:
 *   npm run test:rhp            # all venues
 *   npm run test:rhp -- amh     # one venue (substring match on the key)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import type { ScrapedEvent } from '../../lib/scrapers/types';

const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-rhp');

const VENUES: Record<string, () => Promise<ScrapedEvent[]>> = {
  amh: async () =>
    (await import('../../lib/scrapers/ashevillemusichall')).scrapeAshevilleMusicHall(),
  pisgah: async () => (await import('../../lib/scrapers/pisgahbrewing')).scrapePisgahBrewing(),
  kingstreet: async () => (await import('../../lib/scrapers/kingstreet')).scrapeKingStreet(),
};

function pct(n: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`;
}

async function runVenue(key: string): Promise<ScrapedEvent[]> {
  console.log('\n' + '='.repeat(66));
  console.log(`SCRAPER TEST - ${key}`);
  console.log('='.repeat(66));

  const started = Date.now();
  const events = await VENUES[key]();
  const duration = ((Date.now() - started) / 1000).toFixed(1);

  fs.writeFileSync(path.join(DEBUG_DIR, `${key}.json`), JSON.stringify(events, null, 2));

  const n = events.length;
  console.log(`\nCompleted in ${duration}s — ${n} events`);
  console.log('\nField completeness:');
  for (const [field, count] of [
    ['Images', events.filter((e) => e.imageUrl).length],
    ['Descriptions', events.filter((e) => e.description).length],
    ['Prices (known)', events.filter((e) => e.price && e.price !== 'Unknown').length],
    ['Free', events.filter((e) => e.price === 'Free').length],
    ['Zips', events.filter((e) => e.zip).length],
    ['Time known', events.filter((e) => !e.timeUnknown).length],
  ] as Array<[string, number]>) {
    console.log(`  ${field.padEnd(16)} ${String(count).padStart(4)}/${n}  (${pct(count, n)})`);
  }

  // --- Validation ---------------------------------------------------------
  const problems: string[] = [];
  const now = new Date();

  const past = events.filter((e) => e.startDate < now);
  if (past.length)
    problems.push(
      `${past.length} events in the PAST (e.g. "${past[0].title}" ${past[0].startDate.toISOString()})`
    );

  const urls = new Set<string>();
  const dupUrls = events.filter((e) => (urls.has(e.url) ? true : (urls.add(e.url), false)));
  if (dupUrls.length) problems.push(`${dupUrls.length} duplicate URLs (e.g. ${dupUrls[0].url})`);

  const ids = new Set<string>();
  const dupIds = events.filter((e) => (ids.has(e.sourceId) ? true : (ids.add(e.sourceId), false)));
  if (dupIds.length)
    problems.push(`${dupIds.length} duplicate sourceIds (e.g. ${dupIds[0].sourceId})`);

  const entities = events.filter((e) => /&(amp|#\d+|quot|lt|gt);/.test(e.title));
  if (entities.length)
    problems.push(
      `${entities.length} titles with undecoded HTML entities (e.g. "${entities[0].title}")`
    );

  const farOut = events.filter((e) => e.startDate.getTime() > now.getTime() + 550 * 864e5);
  if (farOut.length)
    problems.push(
      `${farOut.length} events >18mo out (e.g. "${farOut[0].title}" ${farOut[0].startDate.toISOString()})`
    );

  const noLocation = events.filter((e) => !e.location);
  if (noLocation.length) problems.push(`${noLocation.length} events with no location`);

  console.log(problems.length ? '\nPROBLEMS:' : '\nValidation: clean');
  for (const p of problems) console.log(`  ! ${p}`);

  // --- Timezone spot check ------------------------------------------------
  console.log('\nSample events (verify Eastern times against the venue site):');
  for (const e of events.slice(0, 5)) {
    console.log(`\n  ${e.title}`);
    console.log(
      `    Eastern:  ${e.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
    console.log(`    UTC:      ${e.startDate.toISOString()}`);
    console.log(`    Venue:    ${e.organizer} | ${e.location}`);
    console.log(`    Price:    ${e.price}${e.timeUnknown ? '   (time unknown)' : ''}`);
    console.log(`    URL:      ${e.url}`);
  }

  // Date span, to confirm we got the whole upcoming window
  if (n) {
    const sorted = [...events].sort((a, b) => +a.startDate - +b.startDate);
    console.log(
      `\nDate span: ${sorted[0].startDate.toISOString().slice(0, 10)} -> ${sorted[n - 1].startDate.toISOString().slice(0, 10)}`
    );
  }

  return events;
}

async function main() {
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const filter = process.argv[2];
  const keys = Object.keys(VENUES).filter((k) => !filter || k.includes(filter));
  if (!keys.length) {
    console.error(`No venue matches "${filter}". Available: ${Object.keys(VENUES).join(', ')}`);
    process.exit(1);
  }

  const totals: Array<[string, number]> = [];
  for (const key of keys) {
    try {
      const events = await runVenue(key);
      totals.push([key, events.length]);
    } catch (error) {
      console.error(`\n[${key}] FAILED:`, error instanceof Error ? error.message : error);
      totals.push([key, -1]);
    }
  }

  console.log('\n' + '='.repeat(66));
  console.log('SUMMARY');
  console.log('='.repeat(66));
  for (const [key, count] of totals) {
    console.log(`  ${key.padEnd(12)} ${count < 0 ? 'FAILED' : `${count} events`}`);
  }
  console.log(`\nDebug output: ${DEBUG_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
