/**
 * Test Script Template for New Scrapers
 *
 * This script runs a scraper in debug mode, saving raw data and validation
 * reports to a debug folder for inspection.
 *
 * Usage:
 *   1. Copy this file to scripts/scrapers/test-yoursource.ts
 *   2. Update SOURCE_NAME and the scraper import
 *   3. Run: npx tsx scripts/scrapers/test-yoursource.ts
 *   4. Review debug output files
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION - Update these for your scraper
// ============================================================================

const SOURCE_NAME = 'yoursource'; // Used for debug folder name

// Set up debug directory BEFORE importing scraper
const DEBUG_DIR = path.join(process.cwd(), `debug-scraper-${SOURCE_NAME}`);
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
process.env.DEBUG_DIR = DEBUG_DIR;

// Import your scraper AFTER setting DEBUG_DIR
// import { scrapeYourSource } from '../lib/scrapers/yoursource';

// ============================================================================
// TEST RUNNER
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log(`SCRAPER TEST - ${SOURCE_NAME.toUpperCase()}`);
  console.log('='.repeat(70));
  console.log();
  console.log(`Debug output directory: ${DEBUG_DIR}`);
  console.log();

  const startTime = Date.now();

  try {
    // Run the scraper
    console.log('Running scraper...');
    console.log();

    // TODO: Replace with your scraper function
    // const events = await scrapeYourSource();
    const events: Array<{
      sourceId: string;
      source: string;
      title: string;
      description?: string;
      startDate: Date;
      location?: string;
      organizer?: string;
      price?: string;
      url: string;
      imageUrl?: string;
    }> = [];

    const duration = Date.now() - startTime;

    // Print summary
    console.log();
    console.log('='.repeat(70));
    console.log('RESULTS');
    console.log('='.repeat(70));
    console.log();
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`Events found: ${events.length}`);
    console.log();

    // Statistics
    if (events.length > 0) {
      const withImages = events.filter(e => e.imageUrl).length;
      const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
      const withDescriptions = events.filter(e => e.description).length;
      const freeEvents = events.filter(e => e.price === 'Free').length;

      console.log('FIELD COVERAGE:');
      console.log(`  With images:       ${withImages}/${events.length} (${pct(withImages, events.length)}%)`);
      console.log(`  With prices:       ${withPrices}/${events.length} (${pct(withPrices, events.length)}%)`);
      console.log(`  With descriptions: ${withDescriptions}/${events.length} (${pct(withDescriptions, events.length)}%)`);
      console.log(`  Free events:       ${freeEvents}`);
      console.log();

      // Date range
      const dates = events.map(e => e.startDate).filter(d => !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
      if (dates.length > 0) {
        console.log('DATE RANGE:');
        console.log(`  Earliest: ${formatDate(dates[0])}`);
        console.log(`  Latest:   ${formatDate(dates[dates.length - 1])}`);
        console.log();
      }

      // Sample events
      console.log('SAMPLE EVENTS (first 5):');
      console.log('-'.repeat(70));
      for (const event of events.slice(0, 5)) {
        console.log();
        console.log(`  Title: ${event.title}`);
        console.log(`  Date (UTC): ${event.startDate.toISOString()}`);
        console.log(`  Date (ET):  ${formatDate(event.startDate)}`);
        if (event.location) console.log(`  Location: ${event.location}`);
        if (event.organizer) console.log(`  Organizer: ${event.organizer}`);
        if (event.price) console.log(`  Price: ${event.price}`);
        console.log(`  URL: ${event.url}`);
        if (event.imageUrl) console.log(`  Image: ${event.imageUrl.substring(0, 60)}...`);
      }
    }

    // Debug file locations
    console.log();
    console.log('='.repeat(70));
    console.log('DEBUG FILES');
    console.log('='.repeat(70));
    console.log();
    console.log(`Saved to: ${DEBUG_DIR}`);
    console.log();

    const debugFiles = fs.readdirSync(DEBUG_DIR).sort();
    for (const file of debugFiles) {
      const stat = fs.statSync(path.join(DEBUG_DIR, file));
      const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`;
      console.log(`  ${file} (${size})`);
    }

    console.log();
    console.log('NEXT STEPS:');
    console.log('  1. Review validation report:');
    console.log(`     cat "${path.join(DEBUG_DIR, '04-validation-report.txt')}"`);
    console.log();
    console.log('  2. Check for timezone issues (dates should be correct Eastern time)');
    console.log();
    console.log('  3. Verify field mapping in transformed events:');
    console.log(`     cat "${path.join(DEBUG_DIR, '02-transformed-events.json')}" | jq ".[0]"`);
    console.log();
    console.log('  4. Check for HTML entities (should be decoded):');
    console.log(`     grep -E "&amp;|&quot;|&#" "${path.join(DEBUG_DIR, '03-final-events.json')}"`);
    console.log();
    console.log('  5. When validation passes, run database test:');
    console.log(`     npx tsx scripts/scrapers/test-${SOURCE_NAME}-db.ts`);
    console.log();

  } catch (error) {
    console.error();
    console.error('TEST FAILED');
    console.error('='.repeat(70));
    console.error(error);
    process.exit(1);
  }
}

// Helper functions
function pct(a: number, b: number): string {
  return b === 0 ? '0' : Math.round((a / b) * 100).toString();
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
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
