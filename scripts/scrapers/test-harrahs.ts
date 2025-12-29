/**
 * Test script for Harrah's Cherokee Center Asheville scraper
 *
 * Tests the hybrid Ticketmaster API + HTML scraping approach.
 *
 * Usage: npx tsx scripts/scrapers/test-harrahs.ts
 */

import 'dotenv/config';
import { scrapeHarrahs } from '../../lib/scrapers/harrahs';

async function main() {
  console.log('='.repeat(60));
  console.log("Testing Harrah's Cherokee Center Asheville Scraper");
  console.log('='.repeat(60));
  console.log();

  // Check for API key
  if (!process.env.TICKETMASTER_API_KEY) {
    console.log('⚠️  TICKETMASTER_API_KEY not set - will only use HTML scraping');
  } else {
    console.log('✅ TICKETMASTER_API_KEY is set');
  }
  console.log();

  // Run the full scraper
  console.log('Running hybrid scraper...');
  console.log('-'.repeat(60));

  const events = await scrapeHarrahs();

  console.log();
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log();

  console.log(`Total events: ${events.length}`);
  console.log();

  // Stats
  const withDesc = events.filter(e => e.description).length;
  const withImage = events.filter(e => e.imageUrl).length;
  const withPrice = events.filter(e => e.price && e.price !== 'Unknown').length;
  const fromTM = events.filter(e => e.sourceId.startsWith('tm-')).length;
  const fromHTML = events.filter(e => e.sourceId.startsWith('harrahs-')).length;

  console.log('📊 Statistics:');
  console.log(`  - From Ticketmaster: ${fromTM}`);
  console.log(`  - From HTML: ${fromHTML}`);
  console.log(`  - With description: ${withDesc} (${Math.round(withDesc/events.length*100)}%)`);
  console.log(`  - With image: ${withImage} (${Math.round(withImage/events.length*100)}%)`);
  console.log(`  - With price: ${withPrice} (${Math.round(withPrice/events.length*100)}%)`);
  console.log();

  // Show sample events
  console.log('📅 Sample Events (first 5):');
  console.log('-'.repeat(60));

  for (const event of events.slice(0, 5)) {
    console.log();
    console.log(`Title: ${event.title}`);
    console.log(`Date: ${event.startDate.toLocaleDateString()} ${event.startDate.toLocaleTimeString()}`);
    console.log(`Source ID: ${event.sourceId}`);
    console.log(`Price: ${event.price}`);
    console.log(`URL: ${event.url}`);
    console.log(`Image: ${event.imageUrl ? 'Yes' : 'No'}`);
    console.log(`Description: ${event.description ? event.description.slice(0, 100) + '...' : 'None'}`);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('All event titles:');
  console.log('='.repeat(60));

  for (const event of events) {
    const source = event.sourceId.startsWith('tm-') ? 'TM' : 'HTML';
    const date = event.startDate.toLocaleDateString();
    console.log(`[${source}] ${date} - ${event.title}`);
  }

  console.log();
  console.log('✅ Test complete!');
}

main().catch(console.error);
