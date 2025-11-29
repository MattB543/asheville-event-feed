/**
 * Insert Harrah's events into the database
 *
 * Usage: npx tsx scripts/insert-harrahs.ts
 */

import 'dotenv/config';
import { scrapeHarrahs } from '../lib/scrapers/harrahs';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';

async function main() {
  console.log('='.repeat(60));
  console.log("Inserting Harrah's events into database");
  console.log('='.repeat(60));
  console.log();

  // Scrape events
  console.log('Scraping events...');
  const harrahsEvents = await scrapeHarrahs();
  console.log(`Found ${harrahsEvents.length} events`);
  console.log();

  // Insert into database
  console.log('Inserting into database...');
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const event of harrahsEvents) {
    try {
      const result = await db.insert(events)
        .values({
          sourceId: event.sourceId,
          source: event.source,
          title: event.title,
          description: event.description,
          startDate: event.startDate,
          location: event.location,
          organizer: event.organizer,
          price: event.price,
          url: event.url,
          imageUrl: event.imageUrl,
          tags: [], // Will be tagged by AI later
        })
        .onConflictDoUpdate({
          target: events.url,
          set: {
            title: event.title,
            description: event.description,
            startDate: event.startDate,
            location: event.location,
            organizer: event.organizer,
            price: event.price,
            imageUrl: event.imageUrl,
          },
        })
        .returning({ id: events.id });

      if (result.length > 0) {
        inserted++;
      }
    } catch (err) {
      console.error(`Failed to insert ${event.title}:`, err);
      failed++;
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Total events: ${harrahsEvents.length}`);
  console.log(`Inserted/Updated: ${inserted}`);
  console.log(`Failed: ${failed}`);
  console.log();
  console.log('✅ Done!');
}

main().catch(console.error);
