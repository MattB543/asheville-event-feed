/**
 * Test script for the Mountain Xpress scraper.
 *
 * Saves:
 * - The transformed event payloads
 * - A validation report with date coverage, field completeness, and samples
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { scrapeMountainX } from '../../lib/scrapers/mountainx';

const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-mountainx');

if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function debugSave(filename: string, data: unknown): void {
  const filepath = path.join(DEBUG_DIR, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content);
  console.log(`[DEBUG] Saved: ${filepath}`);
}

interface TransformedEvent {
  title: string;
  startDate: Date | string;
  location?: string;
  zip?: string;
  price?: string;
  url: string;
  imageUrl?: string;
  description?: string;
  organizer?: string;
  timeUnknown?: boolean;
}

async function main() {
  console.log('='.repeat(60));
  console.log('MOUNTAIN XPRESS SCRAPER TEST');
  console.log('='.repeat(60));
  console.log(`Debug output: ${DEBUG_DIR}`);
  console.log();

  console.log('[Step 1] Running scraper...');
  const startedAt = Date.now();
  const events = await scrapeMountainX();
  const durationMs = Date.now() - startedAt;
  console.log(`  Completed in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Found ${events.length} events`);
  console.log();

  debugSave('01-transformed-events.json', events);

  console.log('[Step 2] Generating validation report...');
  const report = generateValidationReport(events);
  debugSave('02-validation-report.txt', report);

  console.log();
  console.log('='.repeat(60));
  console.log('DEBUG FILES SAVED');
  console.log('='.repeat(60));
  console.log('  - 01-transformed-events.json (ScrapedEvent output)');
  console.log('  - 02-validation-report.txt  (coverage and field checks)');
  console.log();
}

function generateValidationReport(events: TransformedEvent[]): string {
  const lines: string[] = [
    'VALIDATION REPORT - Mountain Xpress Scraper',
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    '='.repeat(60),
    'DATE COVERAGE',
    '='.repeat(60),
    '',
  ];

  const monthCounts = new Map<string, number>();
  let earliest: Date | null = null;
  let latest: Date | null = null;
  let pastCount = 0;

  for (const event of events) {
    const date = new Date(event.startDate);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
    if (date < new Date()) pastCount++;

    const monthKey = date.toISOString().slice(0, 7);
    monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
  }

  lines.push(`Earliest event: ${earliest?.toISOString() || 'N/A'}`);
  lines.push(`Latest event:   ${latest?.toISOString() || 'N/A'}`);
  lines.push(`Past events:    ${pastCount}`);
  lines.push('');
  lines.push('Counts by month:');

  for (const [month, count] of [...monthCounts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    lines.push(`  ${month}: ${count}`);
  }

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('FIELD COMPLETENESS');
  lines.push('='.repeat(60));
  lines.push('');

  const withImages = events.filter((event) => event.imageUrl).length;
  const withPrices = events.filter((event) => event.price && event.price !== 'Unknown').length;
  const withDescriptions = events.filter((event) => event.description).length;
  const withLocations = events.filter((event) => event.location).length;
  const withZips = events.filter((event) => event.zip).length;
  const withOrganizers = events.filter((event) => event.organizer).length;
  const allDay = events.filter((event) => event.timeUnknown).length;

  lines.push(
    `With images:       ${withImages}/${events.length} (${pct(withImages, events.length)}%)`
  );
  lines.push(
    `With prices:       ${withPrices}/${events.length} (${pct(withPrices, events.length)}%)`
  );
  lines.push(
    `With descriptions: ${withDescriptions}/${events.length} (${pct(withDescriptions, events.length)}%)`
  );
  lines.push(
    `With locations:    ${withLocations}/${events.length} (${pct(withLocations, events.length)}%)`
  );
  lines.push(`With zip codes:    ${withZips}/${events.length} (${pct(withZips, events.length)}%)`);
  lines.push(
    `With organizers:   ${withOrganizers}/${events.length} (${pct(withOrganizers, events.length)}%)`
  );
  lines.push(`All-day / unknown: ${allDay}/${events.length} (${pct(allDay, events.length)}%)`);
  lines.push('');

  lines.push('='.repeat(60));
  lines.push('PRICE VALUES');
  lines.push('='.repeat(60));
  lines.push('');

  const priceCount: Record<string, number> = {};
  for (const event of events) {
    const price = event.price || 'Unknown';
    priceCount[price] = (priceCount[price] || 0) + 1;
  }

  for (const [price, count] of Object.entries(priceCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)) {
    lines.push(`  ${count.toString().padStart(4)} x "${price}"`);
  }

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('SAMPLE EVENTS (First 10)');
  lines.push('='.repeat(60));
  lines.push('');

  for (const event of events.slice(0, 10)) {
    const date = new Date(event.startDate);
    lines.push(`Title: ${event.title}`);
    lines.push(`  Date (UTC): ${date.toISOString()}`);
    lines.push(`  Date (ET):  ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    lines.push(`  Location:   ${event.location || 'N/A'}`);
    lines.push(`  Organizer:  ${event.organizer || 'N/A'}`);
    lines.push(`  Zip:        ${event.zip || 'N/A'}`);
    lines.push(`  Price:      ${event.price || 'N/A'}`);
    lines.push(`  URL:        ${event.url}`);
    lines.push(`  All Day:    ${event.timeUnknown ? 'Yes' : 'No'}`);
    lines.push('');
  }

  return lines.join('\n');
}

function pct(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
