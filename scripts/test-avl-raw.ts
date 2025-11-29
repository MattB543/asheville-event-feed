import { scrapeAvlToday } from '@/lib/scrapers/avltoday';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('========================================');
  console.log('AVL Today Scraper - Raw Output Test');
  console.log('========================================\n');

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`Timestamp: ${timestamp}`);
  console.log('Starting scrape...\n');

  try {
    // Run the scraper
    const events = await scrapeAvlToday();

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('\n========================================');
    console.log('Scraping Complete!');
    console.log('========================================');
    console.log(`Total events scraped: ${events.length}`);
    console.log(`Duration: ${duration} seconds`);

    // Show sample of event titles
    console.log('\nSample Event Titles:');
    const sampleSize = Math.min(5, events.length);
    for (let i = 0; i < sampleSize; i++) {
      console.log(`  ${i + 1}. ${events[i].title}`);
    }

    // Prepare output data
    const outputData = {
      metadata: {
        timestamp,
        totalCount: events.length,
        scrapeDuration: `${duration}s`,
        source: 'AVL_TODAY',
        scraper: 'scrapeAvlToday()',
      },
      events,
    };

    // Save to file
    const outputDir = path.join(process.cwd(), 'claude', 'scraping-results');
    const outputPath = path.join(outputDir, 'avltoday-raw.json');

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

    // Get file size
    const stats = fs.statSync(outputPath);
    const fileSizeKB = (stats.size / 1024).toFixed(2);

    console.log('\n========================================');
    console.log('Output Saved Successfully!');
    console.log('========================================');
    console.log(`File path: ${outputPath}`);
    console.log(`File size: ${fileSizeKB} KB`);
    console.log('========================================\n');

  } catch (error) {
    console.error('\n❌ Error during scraping:');
    console.error(error);
    process.exit(1);
  }
}

main();
