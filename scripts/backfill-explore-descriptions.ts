import '../lib/config/env';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, and, isNull, or } from 'drizzle-orm';
import { fetchEventDescription } from '../lib/scrapers/exploreasheville';

/**
 * Backfill script to fetch descriptions for existing ExploreAsheville events
 *
 * The grid API doesn't include descriptions, so we need to fetch them
 * from individual event detail pages.
 *
 * Usage: npx tsx scripts/backfill-explore-descriptions.ts
 */
async function main() {
  console.log('='.repeat(60));
  console.log('ExploreAsheville Description Backfill Script');
  console.log('Fetching descriptions for events without them');
  console.log('='.repeat(60));

  try {
    // Find ExploreAsheville events without descriptions
    console.log('\n[Backfill] Finding ExploreAsheville events without descriptions...');
    const eventsToUpdate = await db
      .select({
        id: events.id,
        title: events.title,
        url: events.url,
        description: events.description,
      })
      .from(events)
      .where(
        and(
          eq(events.source, 'EXPLORE_ASHEVILLE'),
          or(
            isNull(events.description),
            eq(events.description, '')
          )
        )
      );

    console.log(`[Backfill] Found ${eventsToUpdate.length} events needing descriptions`);

    if (eventsToUpdate.length === 0) {
      console.log('[Backfill] All events already have descriptions. Exiting.');
      return;
    }

    // Fetch descriptions for each event
    console.log('\n[Backfill] Fetching descriptions from detail pages...');
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < eventsToUpdate.length; i++) {
      const event = eventsToUpdate[i];

      try {
        // Strip hash fragment for recurring events (URL like ...#2025-12-15)
        const cleanUrl = event.url.split('#')[0];
        const description = await fetchEventDescription(cleanUrl);

        if (description) {
          // Update the event with the description
          await db
            .update(events)
            .set({ description })
            .where(eq(events.id, event.id));

          successCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        failedCount++;
        console.error(`[Backfill] Failed to fetch description for "${event.title}":`,
          err instanceof Error ? err.message : err);
      }

      // Progress logging every 10 events
      if ((i + 1) % 10 === 0 || i === eventsToUpdate.length - 1) {
        console.log(`[Backfill] Progress: ${i + 1}/${eventsToUpdate.length} (${successCount} success, ${failedCount} failed)`);
      }

      // Rate limit: 150ms between fetches
      await new Promise(r => setTimeout(r, 150));
    }

    console.log('\n' + '='.repeat(60));
    console.log('Backfill Complete!');
    console.log(`Total events processed: ${eventsToUpdate.length}`);
    console.log(`Descriptions fetched: ${successCount}`);
    console.log(`Failed/No description: ${failedCount}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n[Backfill] Fatal error:', error);
    process.exit(1);
  }
}

main();
