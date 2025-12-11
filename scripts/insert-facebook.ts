/**
 * Insert Facebook events into database
 *
 * Scrapes Facebook events and inserts them into the database with proper
 * upsert logic (insert or update on URL conflict).
 *
 * Note: Facebook scraping doesn't work on Vercel due to Playwright requirements,
 * so this script is meant to be run locally.
 *
 * Usage: npx tsx scripts/insert-facebook.ts
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { scrapeFacebookEvents } from '../lib/scrapers/facebook';
import { generateEventTags } from '../lib/ai/tagging';
import { isAIEnabled, isFacebookEnabled } from '../lib/config/env';
import type { ScrapedEventWithTags } from '../lib/scrapers/types';

async function main() {
  console.log('='.repeat(70));
  console.log('Inserting Facebook Events into Database');
  console.log('='.repeat(70));
  console.log();

  // Check Facebook config
  if (!isFacebookEnabled()) {
    console.log('❌ Facebook scraping is not enabled.');
    console.log('   Make sure the following env vars are set:');
    console.log('   - FB_ENABLED=true');
    console.log('   - FB_C_USER, FB_XS');
    console.log('   - FB_DTSG, FB_LSD');
    process.exit(1);
  }

  console.log('✅ Facebook credentials configured');
  console.log();

  // Scrape events
  console.log('Scraping Facebook events (this may take a minute)...');
  const allScrapedEvents = await scrapeFacebookEvents();
  console.log(`Scraped ${allScrapedEvents.length} events`);

  // Filter out low-interest events (must have >1 going OR >3 interested)
  // "Going" is a stronger signal than "interested"
  const scrapedEvents = allScrapedEvents.filter(e =>
    (e.goingCount !== undefined && e.goingCount > 1) ||
    (e.interestedCount !== undefined && e.interestedCount > 3)
  );
  const filteredOut = allScrapedEvents.length - scrapedEvents.length;
  if (filteredOut > 0) {
    console.log(`Filtered out ${filteredOut} low-interest events (≤1 going AND ≤3 interested)`);
  }
  console.log(`Keeping ${scrapedEvents.length} events with sufficient interest`);
  console.log();

  if (scrapedEvents.length === 0) {
    console.log('No events to insert. Exiting.');
    process.exit(0);
  }

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

        // Show progress
        if (taggedCount % 5 === 0) {
          console.log(`  Tagged ${taggedCount}/${scrapedEvents.length} events`);
        }

        // Rate limit
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
          interestedCount: event.interestedCount,
          goingCount: event.goingCount,
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
            interestedCount: event.interestedCount,
            goingCount: event.goingCount,
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

  // Show interested/going stats
  const eventsWithCounts = scrapedEvents.filter(e => e.interestedCount || e.goingCount);
  if (eventsWithCounts.length > 0) {
    console.log('📊 Events with Interested/Going counts:');
    console.log('-'.repeat(70));
    // Sort by interested count descending
    eventsWithCounts.sort((a, b) => (b.interestedCount || 0) - (a.interestedCount || 0));
    for (const event of eventsWithCounts.slice(0, 10)) {
      console.log(`  ⭐ ${event.interestedCount || 0} interested, ✅ ${event.goingCount || 0} going`);
      console.log(`     ${event.title}`);
    }
    if (eventsWithCounts.length > 10) {
      console.log(`  ... and ${eventsWithCounts.length - 10} more events with counts`);
    }
  }

  console.log();
  console.log('Done!');
}

main().catch(console.error);
