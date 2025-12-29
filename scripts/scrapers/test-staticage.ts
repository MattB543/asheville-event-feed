/**
 * Test script for Static Age NC scraper
 *
 * Usage: npm run test:staticage
 *
 * Set DEBUG_DIR to save debug files:
 *   DEBUG_DIR=./debug-scraper-staticage npm run test:staticage
 */

import 'dotenv/config';

// Set debug directory if not already set
if (!process.env.DEBUG_DIR) {
  process.env.DEBUG_DIR = './debug-scraper-staticage';
}

async function main() {
  console.log('='.repeat(60));
  console.log('SCRAPER TEST - Static Age NC');
  console.log('='.repeat(60));
  console.log('');

  // Import scraper
  const { scrapeStaticAge } = await import('../../lib/scrapers/staticage');

  // Run scraper
  const startTime = Date.now();
  const events = await scrapeStaticAge();
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
  const withImages = events.filter(e => e.imageUrl).length;
  const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter(e => e.description).length;
  const withRecurring = events.filter(e => e.recurringType).length;

  console.log('\nField Completeness:');
  console.log(`  Images:       ${withImages}/${events.length} (${Math.round(withImages / events.length * 100)}%)`);
  console.log(`  Prices:       ${withPrices}/${events.length} (${Math.round(withPrices / events.length * 100)}%)`);
  console.log(`  Descriptions: ${withDescriptions}/${events.length} (${Math.round(withDescriptions / events.length * 100)}%)`);
  console.log(`  Recurring:    ${withRecurring}/${events.length}`);

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
    console.log(`    Eastern:  ${e.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`    Location: ${e.location || 'N/A'}`);
    console.log(`    Price:    ${e.price}`);
    console.log(`    URL:      ${e.url}`);
    if (e.recurringType) {
      console.log(`    Recurring: ${e.recurringType}`);
    }
  }

  // Venue distribution
  console.log('\nVenue Distribution:');
  const venueCounts: Record<string, number> = {};
  for (const event of events) {
    const venue = event.location?.split(',')[0] || 'Unknown';
    venueCounts[venue] = (venueCounts[venue] || 0) + 1;
  }
  for (const [venue, count] of Object.entries(venueCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)} - ${venue}`);
  }

  console.log('');
  console.log(`Debug files saved to: ${process.env.DEBUG_DIR}`);
}

main().catch(console.error);
