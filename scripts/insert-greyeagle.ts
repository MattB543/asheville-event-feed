/**
 * Insert Grey Eagle events into database
 *
 * Usage: npx tsx scripts/insert-greyeagle.ts
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { scrapeGreyEagle } from '../lib/scrapers/greyeagle';
import { generateEventTags } from '../lib/ai/tagging';
import { isAIEnabled } from '../lib/config/env';
import type { ScrapedEventWithTags } from '../lib/scrapers/types';

async function main() {
  console.log('='.repeat(70));
  console.log('Inserting Grey Eagle Events into Database');
  console.log('='.repeat(70));
  console.log();

  // Scrape events
  console.log('Scraping events...');
  const scrapedEvents = await scrapeGreyEagle();
  console.log(`Scraped ${scrapedEvents.length} events`);
  console.log();

  // Generate tags if AI is enabled
  let taggedCount = 0;
  const eventsWithTags: ScrapedEventWithTags[] = [];

  if (isAIEnabled()) {
    console.log('Generating tags for events...');
    for (const event of scrapedEvents) {
      try {
        const tags = await generateEventTags({
          title: event.title,
          description: event.description,
          location: event.location,
          organizer: event.organizer,
          startDate: event.startDate,
        });
        eventsWithTags.push({ ...event, tags });
        taggedCount++;

        if (taggedCount % 10 === 0) {
          console.log(`  Tagged ${taggedCount}/${scrapedEvents.length} events`);
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`  Failed to tag "${event.title}":`, err);
        eventsWithTags.push({ ...event, tags: [] });
      }
    }
    console.log(`Tagged ${taggedCount} events`);
  } else {
    console.log('AI not enabled, skipping tag generation');
    for (const event of scrapedEvents) {
      eventsWithTags.push({ ...event, tags: [] });
    }
  }
  console.log();

  // Insert into database
  console.log('Inserting events into database...');
  let insertedCount = 0;
  let errorCount = 0;

  for (const event of eventsWithTags) {
    try {
      await db.insert(events)
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
          tags: event.tags || [],
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
        });
      insertedCount++;
    } catch (err) {
      console.error(`  Failed to insert "${event.title}":`, err);
      errorCount++;
    }
  }

  console.log();
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`  Scraped: ${scrapedEvents.length}`);
  console.log(`  Tagged: ${taggedCount}`);
  console.log(`  Inserted/Updated: ${insertedCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log();
  console.log('Done!');
}

main().catch(console.error);
