import { scrapeEventbrite } from '../lib/scrapers/eventbrite';

async function main() {
  console.log('=== EVENTBRITE SCRAPER TEST (10 pages) ===\n');
  const events = await scrapeEventbrite(10);
  console.log('\n--- RESULTS ---');
  console.log('Total events:', events.length);

  // Show sample events
  console.log('\n--- SAMPLE EVENTS (first 5) ---');
  events.slice(0, 5).forEach((e, i) => {
    console.log('\n' + (i+1) + '. ' + e.title);
    console.log('   Date:', e.startDate.toLocaleString());
    console.log('   Location:', e.location);
    console.log('   Organizer:', e.organizer);
    console.log('   Price:', e.price);
    console.log('   Has Image:', !!e.imageUrl);
    console.log('   URL:', e.url);
  });

  // Stats
  console.log('\n--- STATS ---');
  const withImages = events.filter(e => e.imageUrl).length;
  const withPrice = events.filter(e => e.price && e.price !== 'Unknown').length;
  const free = events.filter(e => e.price === 'Free').length;
  console.log('With images:', withImages, '/', events.length);
  console.log('With price:', withPrice, '/', events.length);
  console.log('Free events:', free);
}

main().then(() => process.exit(0));
