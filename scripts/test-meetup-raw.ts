import { scrapeMeetup } from '../lib/scrapers/meetup';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('Testing Meetup Scraper - Saving Raw Results...');
  console.log('================================================\n');

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    // Run scraper with 3 pages
    const events = await scrapeMeetup(3);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n================================================`);
    console.log(`Scraping completed in ${duration} seconds`);
    console.log(`Total events scraped: ${events.length}`);

    // Prepare raw output object
    const rawOutput = {
      metadata: {
        timestamp,
        duration_seconds: parseFloat(duration),
        pages_requested: 3,
        total_events: events.length,
        scraper_version: 'meetup-graphql',
        api_endpoint: 'https://api.meetup.com/gql-ext',
      },
      events: events.map(event => ({
        ...event,
        // Convert Date objects to ISO strings for JSON
        startDate: event.startDate.toISOString(),
      })),
    };

    // Save to file
    const outputDir = path.join(process.cwd(), 'claude', 'scraping-results');
    const outputPath = path.join(outputDir, 'meetup-raw.json');

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(rawOutput, null, 2), 'utf-8');

    const fileStats = fs.statSync(outputPath);
    const fileSizeKB = (fileStats.size / 1024).toFixed(2);

    console.log(`\nRaw output saved successfully!`);
    console.log(`File path: ${outputPath}`);
    console.log(`File size: ${fileSizeKB} KB`);

    // Display sample events
    if (events.length > 0) {
      console.log(`\n--- Sample Events (5 of ${events.length}) ---`);
      events.slice(0, 5).forEach((e, i) => {
        console.log(`\n${i + 1}. ${e.title}`);
        console.log(`   Source ID: ${e.sourceId}`);
        console.log(`   Date: ${e.startDate.toLocaleDateString()} at ${e.startDate.toLocaleTimeString()}`);
        console.log(`   Location: ${e.location}`);
        console.log(`   Organizer: ${e.organizer}`);
        console.log(`   Price: ${e.price}`);
        console.log(`   Has Image: ${e.imageUrl ? 'Yes' : 'No'}`);
        console.log(`   URL: ${e.url}`);
      });

      // Statistics
      const withImages = events.filter(e => e.imageUrl).length;
      const freeEvents = events.filter(e => e.price === 'Free').length;
      const paidEvents = events.filter(e => e.price !== 'Free' && e.price !== 'Unknown').length;
      const onlineEvents = events.filter(e => e.location === 'Online').length;
      const physicalEvents = events.filter(e => e.location !== 'Online').length;

      console.log(`\n--- Statistics ---`);
      console.log(`Total events: ${events.length}`);
      console.log(`Events with images: ${withImages} (${((withImages/events.length)*100).toFixed(1)}%)`);
      console.log(`Free events: ${freeEvents} (${((freeEvents/events.length)*100).toFixed(1)}%)`);
      console.log(`Paid events: ${paidEvents} (${((paidEvents/events.length)*100).toFixed(1)}%)`);
      console.log(`Online events: ${onlineEvents} (${((onlineEvents/events.length)*100).toFixed(1)}%)`);
      console.log(`Physical events: ${physicalEvents} (${((physicalEvents/events.length)*100).toFixed(1)}%)`);

      // Get unique organizers
      const organizers = new Set(events.map(e => e.organizer));
      console.log(`Unique organizers: ${organizers.size}`);

      // Top 5 organizers by event count
      const organizerCounts = new Map<string, number>();
      events.forEach(e => {
        const count = organizerCounts.get(e.organizer || 'Unknown') || 0;
        organizerCounts.set(e.organizer || 'Unknown', count + 1);
      });
      const topOrganizers = Array.from(organizerCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      console.log(`\nTop 5 Organizers:`);
      topOrganizers.forEach(([org, count], i) => {
        console.log(`  ${i + 1}. ${org} (${count} events)`);
      });
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main().then(() => {
  console.log(`\n✅ Test completed successfully!`);
  process.exit(0);
});
