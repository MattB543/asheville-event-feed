import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { inArray } from 'drizzle-orm';
import { findDuplicates, getIdsToRemove } from '../lib/utils/deduplication';

async function dedupe() {
  console.log('Running deduplication...\n');

  const allEvents = await db.select({
    id: events.id,
    title: events.title,
    organizer: events.organizer,
    startDate: events.startDate,
    price: events.price,
    description: events.description,
    createdAt: events.createdAt,
  }).from(events);

  console.log(`Checking ${allEvents.length} events for duplicates...\n`);

  const duplicateGroups = findDuplicates(allEvents);
  console.log('Found', duplicateGroups.length, 'duplicate groups\n');

  duplicateGroups.forEach((group, i) => {
    console.log(`Group ${i + 1}:`);
    console.log('  Keep:', group.keep.title);
    console.log('  Remove:', group.remove.map(e => e.title));
  });

  const idsToRemove = getIdsToRemove(duplicateGroups);
  console.log('\nIDs to remove:', idsToRemove.length);

  if (idsToRemove.length > 0) {
    await db.delete(events).where(inArray(events.id, idsToRemove));
    console.log('Deleted', idsToRemove.length, 'duplicate events');
  } else {
    console.log('No duplicates to delete');
  }

  process.exit(0);
}
dedupe().catch(console.error);
