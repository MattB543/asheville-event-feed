/**
 * Test script for Grey Eagle scraper
 *
 * Usage: npx tsx scripts/test-greyeagle.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { scrapeGreyEagle } from '../lib/scrapers/greyeagle';

async function main() {
  console.log('='.repeat(70));
  console.log('Testing Grey Eagle Scraper');
  console.log('='.repeat(70));
  console.log();

  // Run the scraper
  console.log('Running scraper...');
  console.log('-'.repeat(70));

  const events = await scrapeGreyEagle();

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
  const specialEvents = events.filter(e => e.location?.includes('Special')).length;

  console.log('Statistics:');
  console.log(`  - With description: ${withDesc} (${Math.round(withDesc/events.length*100)}%)`);
  console.log(`  - With image: ${withImage} (${Math.round(withImage/events.length*100)}%)`);
  console.log(`  - With price: ${withPrice} (${Math.round(withPrice/events.length*100)}%)`);
  console.log(`  - Special events: ${specialEvents}`);
  console.log();

  // Show sample events
  console.log('Sample Events (first 10):');
  console.log('-'.repeat(70));

  for (const event of events.slice(0, 10)) {
    console.log();
    console.log(`${event.title}`);
    console.log(`  Date: ${event.startDate.toLocaleDateString()} ${event.startDate.toLocaleTimeString()}`);
    console.log(`  Location: ${event.location}`);
    console.log(`  Source ID: ${event.sourceId}`);
    console.log(`  Price: ${event.price}`);
    console.log(`  URL: ${event.url.slice(0, 60)}...`);
    console.log(`  Image: ${event.imageUrl ? 'Yes' : 'No'}`);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('All event titles:');
  console.log('='.repeat(70));

  for (const event of events) {
    const date = event.startDate.toLocaleDateString();
    const special = event.location?.includes('Special') ? ' [Special]' : '';
    console.log(`${date} - ${event.title}${special}`);
  }

  // Save raw data to JSON file for inspection
  const outputDir = path.join(process.cwd(), 'grey-eagle-tests');
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
