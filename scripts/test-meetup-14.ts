import { scrapeMeetup } from '../lib/scrapers/meetup';

async function main() {
  console.log('Testing Meetup Scraper (14 days)...');
  try {
    const events = await scrapeMeetup(14);

    console.log('');
    console.log('='.repeat(50));
    console.log('FINAL RESULTS');
    console.log('='.repeat(50));
    console.log(`Total Asheville-area physical events: ${events.length}`);

    // Count by organizer
    const byOrganizer = new Map<string, number>();
    for (const ev of events) {
      const org = ev.organizer || 'Unknown';
      byOrganizer.set(org, (byOrganizer.get(org) || 0) + 1);
    }

    console.log('');
    console.log('Top organizers:');
    const sorted = [...byOrganizer.entries()].sort((a, b) => b[1] - a[1]);
    for (const [org, count] of sorted.slice(0, 15)) {
      console.log(`  ${org}: ${count}`);
    }

    // Count with/without images
    const withImages = events.filter(e => e.imageUrl).length;
    console.log('');
    console.log(`Images: ${withImages}/${events.length} events have images`);

    // Sample events
    console.log('');
    console.log('Sample events:');
    events.slice(0, 5).forEach((e, i) => {
      console.log(`\n${i + 1}. ${e.title}`);
      console.log(`   Date: ${e.startDate.toLocaleDateString()}`);
      console.log(`   Location: ${e.location}`);
      console.log(`   Organizer: ${e.organizer}`);
      console.log(`   Price: ${e.price}`);
    });

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
