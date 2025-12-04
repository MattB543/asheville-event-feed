import { scrapeMeetup } from '../lib/scrapers/meetup';

async function main() {
  console.log('Testing Meetup Scraper (30 days - PRODUCTION)...');
  const start = Date.now();

  try {
    const events = await scrapeMeetup(30);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log('');
    console.log('='.repeat(50));
    console.log('PRODUCTION READY CHECK');
    console.log('='.repeat(50));
    console.log(`Days fetched: 30`);
    console.log(`Total events: ${events.length}`);
    console.log(`Time elapsed: ${elapsed}s`);
    console.log(`Events with images: ${events.filter(e => e.imageUrl).length}`);
    console.log(`Events with price: ${events.filter(e => e.price && e.price !== 'Unknown').length}`);

    // Count by organizer
    const byOrganizer = new Map<string, number>();
    for (const ev of events) {
      const org = ev.organizer || 'Unknown';
      byOrganizer.set(org, (byOrganizer.get(org) || 0) + 1);
    }

    console.log('');
    console.log('Top 10 organizers:');
    const sorted = [...byOrganizer.entries()].sort((a, b) => b[1] - a[1]);
    for (const [org, count] of sorted.slice(0, 10)) {
      console.log(`  ${org}: ${count}`);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
