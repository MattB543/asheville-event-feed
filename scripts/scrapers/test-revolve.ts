/**
 * Test script for Revolve scraper
 *
 * Usage: npm run test:revolve
 *
 * Set DEBUG_DIR to save debug files:
 *   DEBUG_DIR=./debug-scraper-revolve npm run test:revolve
 */

import 'dotenv/config';

// Set debug directory if not already set
if (!process.env.DEBUG_DIR) {
  process.env.DEBUG_DIR = './debug-scraper-revolve';
}

async function main() {
  console.log('='.repeat(60));
  console.log('SCRAPER TEST - Revolve');
  console.log('='.repeat(60));
  console.log('');

  // Import scraper
  const { scrapeRevolve } = await import('../../lib/scrapers/revolve');

  // Run scraper
  const startTime = Date.now();
  const events = await scrapeRevolve();
  const duration = Date.now() - startTime;

  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log('');

  console.log(`Completed in ${(duration / 1000).toFixed(1)}s`);
  console.log(`Found ${events.length} events`);

  if (events.length === 0) {
    console.log('\nNo events found. Check debug files for details.');
    return;
  }

  // Field completeness
  const withImages = events.filter((e) => e.imageUrl).length;
  const withPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
  const withLocations = events.filter((e) => e.location).length;
  const withZips = events.filter((e) => e.zip).length;

  console.log('\nField Completeness:');
  console.log(
    `  Images:    ${withImages}/${events.length} (${Math.round((withImages / events.length) * 100)}%)`
  );
  console.log(
    `  Prices:    ${withPrices}/${events.length} (${Math.round((withPrices / events.length) * 100)}%)`
  );
  console.log(
    `  Locations: ${withLocations}/${events.length} (${Math.round((withLocations / events.length) * 100)}%)`
  );
  console.log(
    `  Zips:      ${withZips}/${events.length} (${Math.round((withZips / events.length) * 100)}%)`
  );

  // Price distribution
  console.log('\nPrice Distribution:');
  const priceCounts: Record<string, number> = {};
  for (const event of events) {
    const price = event.price || 'Unknown';
    priceCounts[price] = (priceCounts[price] || 0) + 1;
  }
  const sortedPrices = Object.entries(priceCounts).sort((a, b) => b[1] - a[1]);
  for (const [price, count] of sortedPrices.slice(0, 10)) {
    console.log(`  ${count.toString().padStart(4)} - ${price}`);
  }

  // Sample events with timezone verification
  console.log('\nSample Events (verify timezone!):');
  for (const e of events.slice(0, 5)) {
    console.log('');
    console.log(`  ${e.title}`);
    console.log(`    UTC:      ${e.startDate.toISOString()}`);
    console.log(
      `    Eastern:  ${e.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
    console.log(`    Location: ${e.location || 'N/A'}`);
    console.log(`    Zip:      ${e.zip || 'N/A'}`);
    console.log(`    Price:    ${e.price}`);
    console.log(`    Organizer: ${e.organizer}`);
    console.log(`    URL:      ${e.url}`);
    if (e.imageUrl) {
      console.log(`    Image:    ${e.imageUrl.substring(0, 60)}...`);
    }
  }

  // Organizer distribution
  console.log('\nOrganizer Distribution:');
  const orgCounts: Record<string, number> = {};
  for (const event of events) {
    const org = event.organizer || 'Unknown';
    orgCounts[org] = (orgCounts[org] || 0) + 1;
  }
  for (const [org, count] of Object.entries(orgCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)} - ${org}`);
  }

  console.log('');
  console.log(`Debug files saved to: ${process.env.DEBUG_DIR}`);
}

main().catch(console.error);
