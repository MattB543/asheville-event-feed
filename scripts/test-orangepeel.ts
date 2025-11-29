/**
 * Test script for Orange Peel scraper
 *
 * Tests the hybrid Ticketmaster API + Website JSON-LD scraping approach.
 * Saves raw data to a JSON file for inspection.
 *
 * Usage: npx tsx scripts/test-orangepeel.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { scrapeOrangePeel, fetchTicketmasterEvents, fetchWebsiteEvents } from '../lib/scrapers/orangepeel';

async function main() {
  console.log('='.repeat(70));
  console.log('Testing Orange Peel Scraper');
  console.log('='.repeat(70));
  console.log();

  // Check for API key
  if (!process.env.TICKETMASTER_API_KEY) {
    console.log('Warning: TICKETMASTER_API_KEY not set - will only use website scraping');
  } else {
    console.log('TICKETMASTER_API_KEY is set');
  }
  console.log();

  // Run the full scraper
  console.log('Running hybrid scraper...');
  console.log('-'.repeat(70));

  const events = await scrapeOrangePeel();

  console.log();
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log();

  console.log(`Total events: ${events.length}`);
  console.log();

  // Stats
  const withDesc = events.filter(e => e.description).length;
  const withImage = events.filter(e => e.imageUrl).length;
  const withPrice = events.filter(e => e.price && e.price !== 'Unknown').length;
  const fromTM = events.filter(e => e.sourceId.startsWith('tm-')).length;
  const fromWeb = events.filter(e => e.sourceId.startsWith('op-web-')).length;
  const atPulp = events.filter(e => e.location === 'Pulp').length;

  console.log('Statistics:');
  console.log(`  - From Ticketmaster: ${fromTM}`);
  console.log(`  - From Website: ${fromWeb}`);
  console.log(`  - At Pulp (smaller venue): ${atPulp}`);
  console.log(`  - With description: ${withDesc} (${Math.round(withDesc/events.length*100)}%)`);
  console.log(`  - With image: ${withImage} (${Math.round(withImage/events.length*100)}%)`);
  console.log(`  - With price: ${withPrice} (${Math.round(withPrice/events.length*100)}%)`);
  console.log();

  // Show sample events
  console.log('Sample Events (first 10):');
  console.log('-'.repeat(70));

  for (const event of events.slice(0, 10)) {
    const source = event.sourceId.startsWith('tm-') ? '[TM]' : '[WEB]';
    console.log();
    console.log(`${source} ${event.title}`);
    console.log(`  Date: ${event.startDate.toLocaleDateString()} ${event.startDate.toLocaleTimeString()}`);
    console.log(`  Location: ${event.location}`);
    console.log(`  Source ID: ${event.sourceId}`);
    console.log(`  Price: ${event.price}`);
    console.log(`  URL: ${event.url.slice(0, 60)}...`);
    console.log(`  Image: ${event.imageUrl ? 'Yes' : 'No'}`);
    console.log(`  Description: ${event.description ? event.description.slice(0, 80) + '...' : 'None'}`);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('All event titles:');
  console.log('='.repeat(70));

  for (const event of events) {
    const source = event.sourceId.startsWith('tm-') ? 'TM ' : 'WEB';
    const date = event.startDate.toLocaleDateString();
    const loc = event.location === 'Pulp' ? ' [Pulp]' : '';
    console.log(`[${source}] ${date} - ${event.title}${loc}`);
  }

  // Save raw data to JSON file for inspection
  const outputDir = path.join(process.cwd(), 'orange-peel-tests');
  const outputFile = path.join(outputDir, 'scraped-data.json');

  // Convert dates to ISO strings for JSON serialization
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
