/**
 * Test script for Mountain Xpress scraper
 *
 * Creates a debug folder with:
 * - Raw API responses
 * - Transformed events
 * - Validation report with timezone checks
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fetchWithRetry } from '../../lib/utils/retry';
import { getTodayStringEastern } from '../../lib/utils/timezone';

const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-mountainx');

// Ensure debug directory exists
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function debugSave(filename: string, data: unknown): void {
  const filepath = path.join(DEBUG_DIR, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content);
  console.log(`[DEBUG] Saved: ${filepath}`);
}

const API_BASE = 'https://mountainx.com/wp-json/tribe/events/v1/events';
const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

async function main() {
  console.log('='.repeat(60));
  console.log('MOUNTAIN XPRESS SCRAPER TEST');
  console.log('='.repeat(60));
  console.log(`Debug output: ${DEBUG_DIR}`);
  console.log();

  const today = getTodayStringEastern();
  console.log(`Today (Eastern): ${today}`);
  console.log();

  // Step 1: Fetch first page of raw API response
  console.log('[Step 1] Fetching raw API response (page 1)...');
  const url = new URL(API_BASE);
  url.searchParams.set('start_date', today);
  url.searchParams.set('per_page', '50');
  url.searchParams.set('page', '1');

  const response = await fetchWithRetry(
    url.toString(),
    { headers: API_HEADERS, cache: 'no-store' },
    { maxRetries: 3, baseDelay: 1000 }
  );

  const rawData = await response.json();
  debugSave('01-raw-api-response.json', rawData);
  console.log(`  Total events available: ${rawData.total}`);
  console.log(`  Events on this page: ${rawData.events?.length || 0}`);
  console.log();

  // Step 2: Run full scraper
  console.log('[Step 2] Running full scraper...');
  const { scrapeMountainX } = await import('../../lib/scrapers/mountainx');
  const startTime = Date.now();
  const events = await scrapeMountainX();
  const duration = Date.now() - startTime;
  console.log(`  Completed in ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Found ${events.length} events`);
  console.log();

  // Step 3: Save transformed events
  debugSave('02-transformed-events.json', events);

  // Step 4: Generate validation report
  console.log('[Step 3] Generating validation report...');
  const report = generateValidationReport(events, rawData.events || []);
  debugSave('03-validation-report.txt', report);

  console.log();
  console.log('='.repeat(60));
  console.log('DEBUG FILES SAVED');
  console.log('='.repeat(60));
  console.log('  - 01-raw-api-response.json  (raw API data)');
  console.log('  - 02-transformed-events.json (ScrapedEvent format)');
  console.log('  - 03-validation-report.txt   (timezone & field checks)');
  console.log();
  console.log('Next steps:');
  console.log(`  1. Review: cat ${path.join(DEBUG_DIR, '03-validation-report.txt')}`);
  console.log('  2. Check timezone handling in sample events');
  console.log('  3. Verify field mapping is correct');
}

interface RawEvent {
  id: number;
  title: string;
  start_date: string;
  utc_start_date: string;
  timezone: string;
  all_day: boolean;
  cost?: string;
  venue?: { venue?: string; city?: string; state?: string; zip?: string };
  url: string;
}

interface TransformedEvent {
  sourceId: string;
  title: string;
  startDate: Date | string;
  location?: string;
  zip?: string;
  price?: string;
  url: string;
  timeUnknown?: boolean;
}

function generateValidationReport(events: TransformedEvent[], rawEvents: RawEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - Mountain Xpress Scraper`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    '=' .repeat(60),
    'TIMEZONE VALIDATION',
    '='.repeat(60),
    '',
    'Comparing API local time vs UTC time vs our parsed Date:',
    '',
  ];

  // Check first 10 events for timezone accuracy
  const samplesToCheck = Math.min(10, rawEvents.length);
  for (let i = 0; i < samplesToCheck; i++) {
    const raw = rawEvents[i];
    const transformed = events.find(e => e.sourceId === `mx-${raw.id}`);

    if (!raw || !transformed) continue;

    const parsedDate = new Date(transformed.startDate);
    const localTimeFromAPI = raw.start_date;
    const utcTimeFromAPI = raw.utc_start_date;
    const ourLocalTime = parsedDate.toLocaleString('en-US', { timeZone: 'America/New_York' });

    lines.push(`Event: ${raw.title.slice(0, 50)}`);
    lines.push(`  API local time:  ${localTimeFromAPI} (${raw.timezone})`);
    lines.push(`  API UTC time:    ${utcTimeFromAPI}`);
    lines.push(`  Our parsed (UTC): ${parsedDate.toISOString()}`);
    lines.push(`  Our parsed (ET):  ${ourLocalTime}`);

    // Check if our ET matches API local time
    const apiLocalParts = localTimeFromAPI.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (apiLocalParts) {
      // Simple check - does our ET time contain the same hour?
      const apiHour = parseInt(apiLocalParts[4]);
      const ourHour = parsedDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
      if (parseInt(ourHour) === apiHour) {
        lines.push(`  Status: OK - Times match`);
      } else {
        lines.push(`  Status: WARNING - Hour mismatch! API=${apiHour}, Ours=${ourHour}`);
      }
    }
    lines.push('');
  }

  lines.push('='.repeat(60));
  lines.push('DATE RANGE CHECK');
  lines.push('='.repeat(60));
  lines.push('');

  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  let pastCount = 0;
  let tooFarCount = 0;
  let allDayCount = 0;

  for (const event of events) {
    const date = new Date(event.startDate);
    if (date < now) pastCount++;
    if (date > oneYearFromNow) tooFarCount++;
    if (event.timeUnknown) allDayCount++;
  }

  lines.push(`Events in the past: ${pastCount}`);
  lines.push(`Events > 1 year out: ${tooFarCount}`);
  lines.push(`All-day events (timeUnknown=true): ${allDayCount}`);
  lines.push('');

  lines.push('='.repeat(60));
  lines.push('FIELD COMPLETENESS');
  lines.push('='.repeat(60));
  lines.push('');

  const withImages = events.filter(e => (e as { imageUrl?: string }).imageUrl).length;
  const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter(e => (e as { description?: string }).description).length;
  const withZips = events.filter(e => e.zip).length;
  const withLocations = events.filter(e => e.location).length;

  lines.push(`With images:       ${withImages}/${events.length} (${Math.round(withImages/events.length*100)}%)`);
  lines.push(`With prices:       ${withPrices}/${events.length} (${Math.round(withPrices/events.length*100)}%)`);
  lines.push(`With descriptions: ${withDescriptions}/${events.length} (${Math.round(withDescriptions/events.length*100)}%)`);
  lines.push(`With locations:    ${withLocations}/${events.length} (${Math.round(withLocations/events.length*100)}%)`);
  lines.push(`With zip codes:    ${withZips}/${events.length} (${Math.round(withZips/events.length*100)}%)`);
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
  const sortedPrices = Object.entries(priceCount).sort((a, b) => b[1] - a[1]);
  for (const [price, count] of sortedPrices.slice(0, 20)) {
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
    lines.push(`  Zip:        ${event.zip || 'N/A'}`);
    lines.push(`  Price:      ${event.price || 'N/A'}`);
    lines.push(`  URL:        ${event.url}`);
    lines.push(`  All Day:    ${event.timeUnknown ? 'Yes' : 'No'}`);
    lines.push('');
  }

  return lines.join('\n');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
