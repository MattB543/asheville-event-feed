/**
 * Verify Harrah's events in database
 *
 * Usage: npx tsx scripts/verify-harrahs.ts
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, sql } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(60));
  console.log("Verifying Harrah's events in database");
  console.log('='.repeat(60));
  console.log();

  // Count by source
  const countResult = await db
    .select({
      source: events.source,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .groupBy(events.source);

  console.log('📊 Events by source:');
  for (const row of countResult) {
    console.log(`  ${row.source}: ${row.count}`);
  }
  console.log();

  // Get Harrah's events
  const harrahsEvents = await db
    .select()
    .from(events)
    .where(eq(events.source, 'HARRAHS'))
    .orderBy(events.startDate);

  console.log(`📅 Harrah's events in database: ${harrahsEvents.length}`);
  console.log();

  // Stats
  const withDesc = harrahsEvents.filter(e => e.description).length;
  const withImage = harrahsEvents.filter(e => e.imageUrl).length;
  const withTags = harrahsEvents.filter(e => e.tags && e.tags.length > 0).length;

  console.log('📈 Harrah\'s data quality:');
  console.log(`  - With description: ${withDesc} (${Math.round(withDesc/harrahsEvents.length*100)}%)`);
  console.log(`  - With image: ${withImage} (${Math.round(withImage/harrahsEvents.length*100)}%)`);
  console.log(`  - With tags: ${withTags} (${Math.round(withTags/harrahsEvents.length*100)}%)`);
  console.log();

  // Sample events
  console.log('📝 Sample events (first 5):');
  console.log('-'.repeat(60));

  for (const event of harrahsEvents.slice(0, 5)) {
    console.log();
    console.log(`ID: ${event.id}`);
    console.log(`Title: ${event.title}`);
    console.log(`Date: ${event.startDate?.toLocaleDateString()} ${event.startDate?.toLocaleTimeString()}`);
    console.log(`Source ID: ${event.sourceId}`);
    console.log(`Location: ${event.location}`);
    console.log(`Organizer: ${event.organizer}`);
    console.log(`Price: ${event.price}`);
    console.log(`URL: ${event.url}`);
    console.log(`Image: ${event.imageUrl ? 'Yes (' + event.imageUrl.slice(0, 50) + '...)' : 'No'}`);
    console.log(`Tags: ${event.tags?.join(', ') || 'None'}`);
    console.log(`Description: ${event.description ? event.description.slice(0, 100) + '...' : 'None'}`);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('✅ Verification complete!');
}

main().catch(console.error);
