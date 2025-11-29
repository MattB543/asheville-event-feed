/**
 * Delete Facebook events with low interest (<=3 interested AND <=1 going)
 * Events must have >1 going OR >3 interested to be kept
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, and, lte, inArray } from 'drizzle-orm';

async function main() {
  // Find events to delete: interested <= 3 AND going <= 1
  const toDelete = await db.select({
    id: events.id,
    title: events.title,
    interestedCount: events.interestedCount,
    goingCount: events.goingCount,
  }).from(events).where(
    and(
      eq(events.source, 'FACEBOOK'),
      lte(events.interestedCount, 3),
      lte(events.goingCount, 1)
    )
  );

  console.log(`Events to delete (${toDelete.length}):`);
  for (const e of toDelete) {
    console.log(`  - [${e.interestedCount} int, ${e.goingCount} going] ${e.title}`);
  }

  if (toDelete.length > 0) {
    const ids = toDelete.map(e => e.id);
    await db.delete(events).where(inArray(events.id, ids));
    console.log(`\nDeleted ${toDelete.length} events`);
  } else {
    console.log('\nNo events to delete');
  }
}

main().catch(console.error);
