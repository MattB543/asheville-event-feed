/**
 * Test script for Misfit Improv scraper
 *
 * Usage: npx tsx scripts/test-misfitimprov.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { scrapeMisfitImprov } from '../lib/scrapers/misfitimprov';

async function main() {
  console.log('='.repeat(70));
  console.log('Testing Misfit Improv Scraper');
  console.log('='.repeat(70));
  console.log();

  // Run the scraper
  console.log('Running scraper...');
  console.log('-'.repeat(70));

  const startTime = Date.now();
  const events = await scrapeMisfitImprov();
  const duration = Date.now() - startTime;

  console.log();
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log();

  console.log(`Total events: ${events.length}`);
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log();

  // Stats
  const withDesc = events.filter(e => e.description).length;
  const withImage = events.filter(e => e.imageUrl).length;
  const withPrice = events.filter(e => e.price && e.price !== 'Unknown').length;
  const freeEvents = events.filter(e => e.price === 'Free').length;

  console.log('Statistics:');
  console.log(`  - With description: ${withDesc} (${Math.round(withDesc/events.length*100)}%)`);
  console.log(`  - With image: ${withImage} (${Math.round(withImage/events.length*100)}%)`);
  console.log(`  - With price: ${withPrice} (${Math.round(withPrice/events.length*100)}%)`);
  console.log(`  - Free events: ${freeEvents}`);
  console.log();

  // Check for unique URLs (critical for DB)
  const urls = events.map(e => e.url);
  const uniqueUrls = new Set(urls);
  if (uniqueUrls.size !== urls.length) {
    console.log('WARNING: Duplicate URLs found!');
    const duplicates = urls.filter((url, i) => urls.indexOf(url) !== i);
    console.log('  Duplicates:', duplicates);
  } else {
    console.log('URL uniqueness: OK (all URLs unique)');
  }
  console.log();

  // Verify date handling
  console.log('Date Validation:');
  const now = new Date();
  const pastEvents = events.filter(e => e.startDate < now);
  const futureEvents = events.filter(e => e.startDate >= now);
  console.log(`  - Past events: ${pastEvents.length} (should be 0)`);
  console.log(`  - Future events: ${futureEvents.length}`);
  console.log();

  // Show sample events
  console.log('Sample Events (first 10):');
  console.log('-'.repeat(70));

  for (const event of events.slice(0, 10)) {
    console.log();
    console.log(`${event.title}`);
    console.log(`  Date (UTC): ${event.startDate.toISOString()}`);
    console.log(`  Date (Eastern): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`  Location: ${event.location}`);
    console.log(`  Organizer: ${event.organizer}`);
    console.log(`  Source ID: ${event.sourceId}`);
    console.log(`  Price: ${event.price}`);
    console.log(`  URL: ${event.url}`);
    console.log(`  Image: ${event.imageUrl ? 'Yes' : 'No'}`);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('All event titles by date:');
  console.log('='.repeat(70));

  // Sort by date
  const sortedEvents = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  for (const event of sortedEvents) {
    const date = event.startDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const time = event.startDate.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
    const price = event.price === 'Free' ? '[FREE]' : `[${event.price}]`;
    console.log(`${date} ${time} - ${event.title} ${price}`);
  }

  // Save raw data to JSON file for inspection
  const outputDir = path.join(process.cwd(), 'debug-scraper-misfitimprov');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputFile = path.join(outputDir, 'scraped-data.json');

  const jsonData = events.map(e => ({
    ...e,
    startDate: e.startDate.toISOString(),
  }));

  fs.writeFileSync(outputFile, JSON.stringify(jsonData, null, 2));
  console.log();
  console.log(`Raw data saved to: ${outputFile}`);

  console.log();
  console.log('Test complete!');
}

main().catch(console.error);
