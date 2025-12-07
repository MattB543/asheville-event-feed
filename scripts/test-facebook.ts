import { scrapeFacebookEvents } from '../lib/scrapers/facebook';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { isFacebookEnabled } from '../lib/config/env';

async function main() {
  console.log('Checking Facebook config...');
  console.log('Facebook enabled:', isFacebookEnabled());

  if (!isFacebookEnabled()) {
    console.log('Facebook scraping is not enabled. Check FB_ENABLED and credentials in .env');
    return;
  }

  console.log('\nRunning Facebook scraper...');
  try {
    const fbRawEvents = await scrapeFacebookEvents();
    console.log(`Raw events scraped: ${fbRawEvents.length}`);

    // Filter low-interest events (same as cron)
    const fbFiltered = fbRawEvents.filter(
      (e) =>
        (e.goingCount !== undefined && e.goingCount > 1) ||
        (e.interestedCount !== undefined && e.interestedCount > 3)
    );
    console.log(`After interest filter: ${fbFiltered.length} (filtered ${fbRawEvents.length - fbFiltered.length} low-interest)`);

    if (fbFiltered.length === 0) {
      console.log('No events to insert.');
      return;
    }

    // Upsert to DB
    let success = 0;
    let failed = 0;
    for (const event of fbFiltered) {
      try {
        await db.insert(events).values({
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
          tags: [],
          interestedCount: event.interestedCount,
          goingCount: event.goingCount,
        }).onConflictDoUpdate({
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
        console.error(`Failed to upsert "${event.title}":`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`\n✅ Facebook: ${success} upserted, ${failed} failed`);
  } catch (err) {
    console.error('❌ Facebook scraper failed:', err);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
