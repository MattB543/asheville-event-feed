import '../../lib/config/env';
import { scrapeEventbrite } from '../../lib/scrapers/eventbrite';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { inArray } from 'drizzle-orm';
import { generateEventTags } from '../../lib/ai/tagAndSummarize';
import { ScrapedEventWithTags } from '../../lib/scrapers/types';

/**
 * Backfill script to scrape 30 pages of EventBrite events
 * This should be run once to populate the database with historical events
 *
 * Usage: npx tsx scripts/scrapers/backfill-eventbrite.ts
 */
async function main() {
  console.log('='.repeat(60));
  console.log('EventBrite Backfill Script');
  console.log('Scraping 30 pages of events from Asheville, NC');
  console.log('='.repeat(60));

  try {
    // Scrape 30 pages of EventBrite
    console.log('\n[Backfill] Step 1: Scraping EventBrite...');
    const ebEvents = await scrapeEventbrite(30);
    console.log(`[Backfill] Scraped ${ebEvents.length} events`);

    if (ebEvents.length === 0) {
      console.log('[Backfill] No events found. Exiting.');
      return;
    }

    // Check which events are new
    console.log('\n[Backfill] Step 2: Checking for existing events...');
    const scrapedUrls = ebEvents.map((e) => e.url);
    let existingUrls = new Set<string>();
    if (scrapedUrls.length > 0) {
      const existingEvents = await db
        .select({ url: events.url })
        .from(events)
        .where(inArray(events.url, scrapedUrls));
      existingUrls = new Set(existingEvents.map((e) => e.url));
    }
    // Convert to ScrapedEventWithTags for proper typing
    const newEvents: ScrapedEventWithTags[] = ebEvents
      .filter((e) => !existingUrls.has(e.url))
      .map((e) => ({ ...e, tags: [] }));

    console.log(
      `[Backfill] Found ${newEvents.length} new events (${existingUrls.size} already exist)`
    );

    if (newEvents.length === 0) {
      console.log('[Backfill] All events already in database. Exiting.');
      return;
    }

    // Generate tags for new events in batches
    console.log('\n[Backfill] Step 3: Generating tags for new events...');
    const chunk = <T>(arr: T[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
      );

    let taggedCount = 0;
    const batches = chunk(newEvents, 5);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(
        `[Backfill] Tagging batch ${i + 1}/${batches.length} (${batch.length} events)...`
      );

      await Promise.all(
        batch.map(async (event) => {
          try {
            const tags = await generateEventTags({
              title: event.title,
              description: event.description,
              location: event.location,
              organizer: event.organizer,
              startDate: event.startDate,
            });
            event.tags = tags;
            taggedCount++;
          } catch (err) {
            console.error(`[Backfill] Failed to tag event "${event.title}":`, err);
            event.tags = [];
          }
        })
      );

      // Small delay between batches to avoid rate limits
      if (i < batches.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(`[Backfill] Tagged ${taggedCount}/${newEvents.length} events`);

    // Insert all events into database
    console.log('\n[Backfill] Step 4: Inserting events into database...');
    let insertedCount = 0;

    for (const event of newEvents) {
      try {
        await db
          .insert(events)
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
          .onConflictDoNothing({ target: events.url });

        insertedCount++;

        // Progress indicator
        if (insertedCount % 50 === 0) {
          console.log(`[Backfill] Inserted ${insertedCount}/${newEvents.length} events...`);
        }
      } catch (err) {
        console.error(`[Backfill] Failed to insert event "${event.title}":`, err);
      }
    }

    console.log(`[Backfill] Successfully inserted ${insertedCount} events`);

    console.log('\n' + '='.repeat(60));
    console.log('Backfill Complete!');
    console.log(`Total events scraped: ${ebEvents.length}`);
    console.log(`New events inserted: ${insertedCount}`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n[Backfill] Fatal error:', error);
    process.exit(1);
  }
}

main();
