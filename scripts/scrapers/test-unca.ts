/**
 * Test script for UNC Asheville scraper (UNCA)
 *
 * Uses a past date range to validate parsing and timezone handling.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fetchWithRetry } from '../../lib/utils/retry';

const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-unca');
const API_BASE = 'https://go.unca.edu/wp-json/tribe/events/v1/events';
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Referer: 'https://go.unca.edu/events/',
};

const START_DATE = process.env.UNCA_START_DATE || '2025-09-29';
const END_DATE = process.env.UNCA_END_DATE || '2025-10-24';

if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function debugSave(filename: string, data: unknown): void {
  const filepath = path.join(DEBUG_DIR, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content);
  console.log(`[DEBUG] Saved: ${filepath}`);
}

interface RawEvent {
  id: number;
  title: string;
  start_date: string;
  utc_start_date?: string;
  timezone?: string;
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
  imageUrl?: string;
  description?: string;
}

function generateValidationReport(events: TransformedEvent[], rawEvents: RawEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - UNCA Scraper`,
    `Generated: ${new Date().toISOString()}`,
    `Date range: ${START_DATE} to ${END_DATE}`,
    `Total events: ${events.length}`,
    '',
    '='.repeat(60),
    'TIMEZONE VALIDATION',
    '='.repeat(60),
    '',
    'Comparing API local time vs our parsed ET time:',
    '',
  ];

  const samplesToCheck = Math.min(10, rawEvents.length);
  for (let i = 0; i < samplesToCheck; i++) {
    const raw = rawEvents[i];
    const transformed = events.find((e) => e.sourceId === `unca-${raw.id}`);
    if (!raw || !transformed) continue;

    const parsedDate = new Date(transformed.startDate);
    const apiLocal = raw.start_date;
    const apiUtc = raw.utc_start_date || 'N/A';
    const apiTimezone = raw.timezone || 'N/A';
    const ourLocal = parsedDate.toLocaleString('en-US', { timeZone: 'America/New_York' });

    lines.push(`Event: ${raw.title.slice(0, 60)}`);
    lines.push(`  API local time:  ${apiLocal} (${apiTimezone})`);
    lines.push(`  API UTC time:    ${apiUtc}`);
    lines.push(`  Our parsed (UTC): ${parsedDate.toISOString()}`);
    lines.push(`  Our parsed (ET):  ${ourLocal}`);

    const apiLocalMatch = apiLocal.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (apiLocalMatch) {
      const apiHour = parseInt(apiLocalMatch[4], 10);
      const apiMinute = parseInt(apiLocalMatch[5], 10);
      const ourHour = parseInt(
        parsedDate.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          hour12: false,
        }),
        10
      );
      const ourMinute = parseInt(
        parsedDate.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          minute: 'numeric',
          hour12: false,
        }),
        10
      );
      if (apiHour === ourHour && apiMinute === ourMinute) {
        lines.push(`  Status: OK - Times match`);
      } else {
        lines.push(`  Status: WARNING - Time mismatch! API=${apiHour}:${apiMinute}`);
      }
    }

    if (
      raw.utc_start_date &&
      raw.utc_start_date === raw.start_date &&
      (raw.timezone || '').toUpperCase().includes('UTC')
    ) {
      lines.push(`  Note: UTC+0 label with identical timestamps (local fallback expected)`);
    }

    lines.push('');
  }

  lines.push('='.repeat(60));
  lines.push('FIELD COMPLETENESS');
  lines.push('='.repeat(60));
  lines.push('');

  const withImages = events.filter((e) => e.imageUrl).length;
  const withPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter((e) => e.description).length;
  const withZips = events.filter((e) => e.zip).length;
  const withLocations = events.filter((e) => e.location).length;

  lines.push(
    `With images:       ${withImages}/${events.length} (${Math.round((withImages / events.length) * 100)}%)`
  );
  lines.push(
    `With prices:       ${withPrices}/${events.length} (${Math.round((withPrices / events.length) * 100)}%)`
  );
  lines.push(
    `With descriptions: ${withDescriptions}/${events.length} (${Math.round((withDescriptions / events.length) * 100)}%)`
  );
  lines.push(
    `With locations:    ${withLocations}/${events.length} (${Math.round((withLocations / events.length) * 100)}%)`
  );
  lines.push(
    `With zip codes:    ${withZips}/${events.length} (${Math.round((withZips / events.length) * 100)}%)`
  );
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

async function main() {
  console.log('='.repeat(60));
  console.log('UNCA SCRAPER TEST');
  console.log('='.repeat(60));
  console.log(`Debug output: ${DEBUG_DIR}`);
  console.log(`Date range: ${START_DATE} to ${END_DATE}`);
  console.log();

  console.log('[Step 1] Fetching raw API response (page 1)...');
  const url = new URL(API_BASE);
  url.searchParams.set('start_date', START_DATE);
  url.searchParams.set('end_date', `${END_DATE} 23:59:59`);
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

  console.log('[Step 2] Running scraper with past-range support...');
  const { scrapeUncaEvents } = await import('../../lib/scrapers/unca');
  const startTime = Date.now();
  const events = await scrapeUncaEvents({
    startDate: START_DATE,
    endDate: END_DATE,
    includePast: true,
  });
  const duration = Date.now() - startTime;

  console.log(`  Completed in ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Found ${events.length} events`);
  console.log();

  debugSave('02-transformed-events.json', events);

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
  console.log('  2. Verify timezone handling in sample events');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
