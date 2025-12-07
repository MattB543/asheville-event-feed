import { scrapeAvlToday } from '../lib/scrapers/avltoday';
import { scrapeEventbrite } from '../lib/scrapers/eventbrite';
import { scrapeMeetup } from '../lib/scrapers/meetup';
import { scrapeHarrahs } from '../lib/scrapers/harrahs';
import { scrapeOrangePeel } from '../lib/scrapers/orangepeel';
import { scrapeGreyEagle } from '../lib/scrapers/greyeagle';
import { scrapeLiveMusicAvl } from '../lib/scrapers/livemusicavl';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { inArray } from 'drizzle-orm';
import { findDuplicates, getIdsToRemove } from '../lib/utils/deduplication';

// Helper to chunk arrays
const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Upsert events to database
async function upsertEvents(scrapedEvents: any[], sourceName: string) {
  let success = 0;
  let failed = 0;

  for (const batch of chunk(scrapedEvents, 10)) {
    await Promise.all(
      batch.map(async (event) => {
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
          success++;
        } catch (err) {
          failed++;
          console.error(
            `  ❌ Failed to upsert "${event.title}":`,
            err instanceof Error ? err.message : err
          );
        }
      })
    );
  }

  console.log(`  ✅ ${sourceName}: ${success} upserted, ${failed} failed`);
  return { success, failed };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Running scrapers sequentially with DB insertion...');
  console.log('═══════════════════════════════════════════════════════════\n');

  const results: { source: string; scraped: number; inserted: number; failed: number }[] = [];

  // 1. AVL Today
  console.log('1️⃣  AVL Today...');
  try {
    const avlEvents = await scrapeAvlToday();
    console.log(`   Scraped ${avlEvents.length} events`);
    const { success, failed } = await upsertEvents(avlEvents, 'AVL Today');
    results.push({ source: 'AVL Today', scraped: avlEvents.length, inserted: success, failed });
  } catch (err) {
    console.error('   ❌ AVL Today scraper failed:', err);
    results.push({ source: 'AVL Today', scraped: 0, inserted: 0, failed: 0 });
  }
  console.log();

  // 2. Eventbrite
  console.log('2️⃣  Eventbrite...');
  try {
    const ebEvents = await scrapeEventbrite(5); // 5 pages for testing
    console.log(`   Scraped ${ebEvents.length} events`);
    const { success, failed } = await upsertEvents(ebEvents, 'Eventbrite');
    results.push({ source: 'Eventbrite', scraped: ebEvents.length, inserted: success, failed });
  } catch (err) {
    console.error('   ❌ Eventbrite scraper failed:', err);
    results.push({ source: 'Eventbrite', scraped: 0, inserted: 0, failed: 0 });
  }
  console.log();

  // 3. Meetup
  console.log('3️⃣  Meetup...');
  try {
    const meetupEvents = await scrapeMeetup(7); // 7 days for testing
    console.log(`   Scraped ${meetupEvents.length} events`);
    const { success, failed } = await upsertEvents(meetupEvents, 'Meetup');
    results.push({ source: 'Meetup', scraped: meetupEvents.length, inserted: success, failed });
  } catch (err) {
    console.error('   ❌ Meetup scraper failed:', err);
    results.push({ source: 'Meetup', scraped: 0, inserted: 0, failed: 0 });
  }
  console.log();

  // 4. Harrah's
  console.log('4️⃣  Harrah\'s...');
  try {
    const harrahsEvents = await scrapeHarrahs();
    console.log(`   Scraped ${harrahsEvents.length} events`);
    const eventsWithTags = harrahsEvents.map(e => ({ ...e, tags: [] }));
    const { success, failed } = await upsertEvents(eventsWithTags, 'Harrah\'s');
    results.push({ source: 'Harrah\'s', scraped: harrahsEvents.length, inserted: success, failed });
  } catch (err) {
    console.error('   ❌ Harrah\'s scraper failed:', err);
    results.push({ source: 'Harrah\'s', scraped: 0, inserted: 0, failed: 0 });
  }
  console.log();

  // 5. Orange Peel
  console.log('5️⃣  Orange Peel...');
  try {
    const orangePeelEvents = await scrapeOrangePeel();
    console.log(`   Scraped ${orangePeelEvents.length} events`);
    const eventsWithTags = orangePeelEvents.map(e => ({ ...e, tags: [] }));
    const { success, failed } = await upsertEvents(eventsWithTags, 'Orange Peel');
    results.push({ source: 'Orange Peel', scraped: orangePeelEvents.length, inserted: success, failed });
  } catch (err) {
    console.error('   ❌ Orange Peel scraper failed:', err);
    results.push({ source: 'Orange Peel', scraped: 0, inserted: 0, failed: 0 });
  }
  console.log();

  // 6. Grey Eagle
  console.log('6️⃣  Grey Eagle...');
  try {
    const greyEagleEvents = await scrapeGreyEagle();
    console.log(`   Scraped ${greyEagleEvents.length} events`);
    const eventsWithTags = greyEagleEvents.map(e => ({ ...e, tags: [] }));
    const { success, failed } = await upsertEvents(eventsWithTags, 'Grey Eagle');
    results.push({ source: 'Grey Eagle', scraped: greyEagleEvents.length, inserted: success, failed });
  } catch (err) {
    console.error('   ❌ Grey Eagle scraper failed:', err);
    results.push({ source: 'Grey Eagle', scraped: 0, inserted: 0, failed: 0 });
  }
  console.log();

  // 7. Live Music AVL
  console.log('7️⃣  Live Music AVL...');
  try {
    const liveMusicEvents = await scrapeLiveMusicAvl();
    console.log(`   Scraped ${liveMusicEvents.length} events`);
    const eventsWithTags = liveMusicEvents.map(e => ({ ...e, tags: [] }));
    const { success, failed } = await upsertEvents(eventsWithTags, 'Live Music AVL');
    results.push({ source: 'Live Music AVL', scraped: liveMusicEvents.length, inserted: success, failed });
  } catch (err) {
    console.error('   ❌ Live Music AVL scraper failed:', err);
    results.push({ source: 'Live Music AVL', scraped: 0, inserted: 0, failed: 0 });
  }
  console.log();

  // 8. Deduplication
  console.log('8️⃣  Running deduplication...');
  const allDbEvents = await db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      startDate: events.startDate,
      price: events.price,
      description: events.description,
      createdAt: events.createdAt,
    })
    .from(events);

  const duplicateGroups = findDuplicates(allDbEvents);
  const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);

  if (duplicateIdsToRemove.length > 0) {
    await db.delete(events).where(inArray(events.id, duplicateIdsToRemove));
    console.log(`   ✅ Removed ${duplicateIdsToRemove.length} duplicate events`);
  } else {
    console.log('   ✅ No duplicates found');
  }
  console.log();

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  let totalScraped = 0;
  let totalInserted = 0;
  let totalFailed = 0;
  for (const r of results) {
    console.log(`${r.source.padEnd(15)} | Scraped: ${String(r.scraped).padStart(4)} | Inserted: ${String(r.inserted).padStart(4)} | Failed: ${r.failed}`);
    totalScraped += r.scraped;
    totalInserted += r.inserted;
    totalFailed += r.failed;
  }
  console.log('───────────────────────────────────────────────────────────');
  console.log(`${'TOTAL'.padEnd(15)} | Scraped: ${String(totalScraped).padStart(4)} | Inserted: ${String(totalInserted).padStart(4)} | Failed: ${totalFailed}`);
  console.log(`Duplicates removed: ${duplicateIdsToRemove.length}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
