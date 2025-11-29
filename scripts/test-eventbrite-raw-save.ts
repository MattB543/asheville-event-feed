import { scrapeEventbrite } from '../lib/scrapers/eventbrite';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('='.repeat(70));
  console.log('EVENTBRITE SCRAPER - RAW RESULTS CAPTURE');
  console.log('='.repeat(70));
  console.log('');

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`Start time: ${timestamp}`);
  console.log('Scraping 3 pages of Eventbrite events...');
  console.log('');

  let events: Awaited<ReturnType<typeof scrapeEventbrite>> = [];
  let error = null;

  try {
    events = await scrapeEventbrite(3);
    console.log('');
    console.log('='.repeat(70));
    console.log('SCRAPING COMPLETE');
    console.log('='.repeat(70));
    console.log(`Total events scraped: ${events.length}`);
    console.log('');

    // Show sample event titles
    if (events.length > 0) {
      console.log('Sample event titles:');
      const sampleSize = Math.min(5, events.length);
      for (let i = 0; i < sampleSize; i++) {
        const event = events[i];
        console.log(`  ${i + 1}. ${event.title}`);
        console.log(`     - Organizer: ${event.organizer}`);
        console.log(`     - Price: ${event.price}`);
        console.log(`     - Location: ${event.location}`);
        console.log(`     - Date: ${event.startDate.toLocaleString()}`);
        console.log('');
      }
    }

  } catch (err) {
    error = err;
    console.error('');
    console.error('='.repeat(70));
    console.error('ERROR DURING SCRAPING');
    console.error('='.repeat(70));
    console.error('Error:', err);
    events = [];
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Prepare output data
  const outputData = {
    metadata: {
      timestamp: timestamp,
      scrapedAt: new Date().toISOString(),
      durationSeconds: parseFloat(duration),
      totalEvents: events.length,
      scraper: 'eventbrite',
      pagesScraped: 3,
      error: error ? {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      } : null
    },
    events: events.map(event => ({
      ...event,
      // Convert Date to ISO string for JSON serialization
      startDate: event.startDate.toISOString()
    }))
  };

  // Save to file
  const outputDir = path.join(process.cwd(), 'claude', 'scraping-results');
  const outputPath = path.join(outputDir, 'eventbrite-raw.json');

  try {
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write file with pretty formatting
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

    console.log('='.repeat(70));
    console.log('RESULTS SAVED');
    console.log('='.repeat(70));
    console.log(`File path: ${outputPath}`);

    // Get file size
    const stats = fs.statSync(outputPath);
    const fileSizeKB = (stats.size / 1024).toFixed(2);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    if (stats.size > 1024 * 1024) {
      console.log(`File size: ${fileSizeMB} MB`);
    } else {
      console.log(`File size: ${fileSizeKB} KB`);
    }

    console.log(`Duration: ${duration} seconds`);
    console.log('');

    // Summary statistics
    if (events.length > 0) {
      console.log('='.repeat(70));
      console.log('SUMMARY STATISTICS');
      console.log('='.repeat(70));

      // Count by price category
      const freeEvents = events.filter(e => e.price === 'Free').length;
      const paidEvents = events.filter(e => e.price && e.price !== 'Free' && e.price !== 'Unknown').length;
      const unknownPrice = events.filter(e => e.price === 'Unknown').length;

      console.log(`Free events: ${freeEvents}`);
      console.log(`Paid events: ${paidEvents}`);
      console.log(`Unknown price: ${unknownPrice}`);
      console.log('');

      // Count events with images
      const withImages = events.filter(e => e.imageUrl && e.imageUrl.length > 0).length;
      console.log(`Events with images: ${withImages}`);
      console.log(`Events without images: ${events.length - withImages}`);
      console.log('');

      // Unique organizers
      const uniqueOrganizers = new Set(events.map(e => e.organizer).filter(Boolean));
      console.log(`Unique organizers: ${uniqueOrganizers.size}`);
      console.log('');

      // Top 5 organizers by event count
      const organizerCounts = events.reduce((acc, event) => {
        if (event.organizer) {
          acc[event.organizer] = (acc[event.organizer] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

      const topOrganizers = Object.entries(organizerCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

      console.log('Top 5 organizers:');
      topOrganizers.forEach(([organizer, count], idx) => {
        console.log(`  ${idx + 1}. ${organizer} (${count} events)`);
      });
    }

  } catch (saveError) {
    console.error('');
    console.error('ERROR SAVING FILE');
    console.error('Error:', saveError);
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('DONE');
  console.log('='.repeat(70));
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
