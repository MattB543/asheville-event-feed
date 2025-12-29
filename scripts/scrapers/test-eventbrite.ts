import { scrapeEventbrite } from '../../lib/scrapers/eventbrite';

async function main() {
  console.log('Testing Eventbrite Scraper...');
  try {
    const events = await scrapeEventbrite();
    console.log(`Found ${events.length} events.`);
    if (events.length > 0) {
      console.log('First event:', events[0]);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
