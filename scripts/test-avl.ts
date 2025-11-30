import { scrapeAvlToday } from '../lib/scrapers/avltoday';

async function main() {
  console.log('Testing AVL Today Scraper...');
  try {
    const events = await scrapeAvlToday();
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
