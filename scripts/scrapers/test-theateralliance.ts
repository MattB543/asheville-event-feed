/**
 * Test script for Asheville Theater Alliance scraper
 *
 * Creates a debug folder with:
 * - Raw API responses
 * - Transformed events
 * - Validation report with timezone checks
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-theateralliance');

if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function debugSave(filename: string, data: unknown): void {
  const filepath = path.join(DEBUG_DIR, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content);
  console.log(`[DEBUG] Saved: ${filepath}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('ASHEVILLE THEATER ALLIANCE SCRAPER TEST');
  console.log('='.repeat(60));
  console.log(`Debug output: ${DEBUG_DIR}`);
  console.log();

  // Set DEBUG_DIR so the scraper saves its own debug files
  process.env.DEBUG_DIR = DEBUG_DIR;

  // Run full scraper
  console.log('[Step 1] Running full scraper...');
  const { scrapeTheaterAlliance } = await import('../../lib/scrapers/theateralliance');
  const startTime = Date.now();
  const events = await scrapeTheaterAlliance();
  const duration = Date.now() - startTime;
  console.log(`  Completed in ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Found ${events.length} events`);
  console.log();

  // Save transformed events
  debugSave('03-transformed-events.json', events);

  // Generate validation report
  console.log('[Step 2] Generating validation report...');
  const report = generateValidationReport(events);
  debugSave('04-validation-report.txt', report);
  console.log(report);

  console.log();
  console.log('='.repeat(60));
  console.log('DEBUG FILES SAVED');
  console.log('='.repeat(60));
  console.log(`  Directory: ${DEBUG_DIR}`);
}

interface EventLike {
  sourceId: string;
  title: string;
  startDate: Date | string;
  location?: string;
  zip?: string;
  price?: string;
  url: string;
  imageUrl?: string;
  description?: string;
  organizer?: string;
}

function generateValidationReport(events: EventLike[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - Asheville Theater Alliance Scraper`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    '='.repeat(60),
    'FIELD COMPLETENESS',
    '='.repeat(60),
    '',
  ];

  const withImages = events.filter((e) => e.imageUrl).length;
  const withPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter((e) => e.description).length;
  const withZips = events.filter((e) => e.zip).length;
  const withLocations = events.filter((e) => e.location).length;
  const withOrganizers = events.filter((e) => e.organizer).length;
  const total = events.length || 1;

  lines.push(
    `With images:       ${withImages}/${events.length} (${Math.round((withImages / total) * 100)}%)`
  );
  lines.push(
    `With prices:       ${withPrices}/${events.length} (${Math.round((withPrices / total) * 100)}%)`
  );
  lines.push(
    `With descriptions: ${withDescriptions}/${events.length} (${Math.round((withDescriptions / total) * 100)}%)`
  );
  lines.push(
    `With locations:    ${withLocations}/${events.length} (${Math.round((withLocations / total) * 100)}%)`
  );
  lines.push(
    `With zip codes:    ${withZips}/${events.length} (${Math.round((withZips / total) * 100)}%)`
  );
  lines.push(
    `With organizers:   ${withOrganizers}/${events.length} (${Math.round((withOrganizers / total) * 100)}%)`
  );
  lines.push('');

  lines.push('='.repeat(60));
  lines.push('UNIQUE VENUES');
  lines.push('='.repeat(60));
  lines.push('');

  const venues = new Map<string, number>();
  for (const e of events) {
    const venue = e.location || 'N/A';
    venues.set(venue, (venues.get(venue) || 0) + 1);
  }
  for (const [venue, count] of [...venues.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${count.toString().padStart(4)} x ${venue}`);
  }
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
  for (const [price, count] of Object.entries(priceCount).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${count.toString().padStart(4)} x "${price}"`);
  }
  lines.push('');

  lines.push('='.repeat(60));
  lines.push('UNIQUE ORGANIZERS');
  lines.push('='.repeat(60));
  lines.push('');

  const organizers = new Map<string, number>();
  for (const e of events) {
    const org = e.organizer || 'N/A';
    organizers.set(org, (organizers.get(org) || 0) + 1);
  }
  for (const [org, count] of [...organizers.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${count.toString().padStart(4)} x ${org}`);
  }
  lines.push('');

  lines.push('='.repeat(60));
  lines.push('SAMPLE EVENTS (First 15)');
  lines.push('='.repeat(60));
  lines.push('');

  for (const event of events.slice(0, 15)) {
    const date = new Date(event.startDate);
    lines.push(`Title: ${event.title}`);
    lines.push(`  Date (UTC): ${date.toISOString()}`);
    lines.push(`  Date (ET):  ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    lines.push(`  Location:   ${event.location || 'N/A'}`);
    lines.push(`  Zip:        ${event.zip || 'N/A'}`);
    lines.push(`  Price:      ${event.price || 'N/A'}`);
    lines.push(`  Organizer:  ${event.organizer || 'N/A'}`);
    lines.push(`  Image:      ${event.imageUrl ? 'Yes' : 'No'}`);
    lines.push(`  URL:        ${event.url}`);
    lines.push('');
  }

  return lines.join('\n');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
