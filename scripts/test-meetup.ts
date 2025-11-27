import { scrapeMeetup } from '../lib/scrapers/meetup';

async function main() {
  console.log('Testing Meetup Scraper...');
  try {
    const events = await scrapeMeetup(3); // Test with 3 pages
    console.log(`Found ${events.length} events.`);
    if (events.length > 0) {
      console.log('\nFirst event:', events[0]);
      console.log('\n--- Sample of events ---');
      events.slice(0, 5).forEach((e, i) => {
        console.log(`\n${i + 1}. ${e.title}`);
        console.log(`   Date: ${e.startDate.toLocaleDateString()}`);
        console.log(`   Location: ${e.location}`);
        console.log(`   Organizer: ${e.organizer}`);
        console.log(`   Price: ${e.price}`);
        console.log(`   URL: ${e.url}`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
