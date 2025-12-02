import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { and, gte, lte, sql, asc } from 'drizzle-orm';

async function main() {
  // First check what dates we have
  const firstEvent = await db.select({ startDate: events.startDate }).from(events).orderBy(asc(events.startDate)).limit(1);
  console.log('First event date in DB:', firstEvent[0]?.startDate);

  // Get events for Dec 2, 3, 4 2025 with 'Live Music' tag
  const today = new Date('2025-12-02T00:00:00');
  const endOfThurs = new Date('2025-12-05T00:00:00');

  const results = await db
    .select({
      title: events.title,
      startDate: events.startDate,
      location: events.location,
      price: events.price,
      tags: events.tags,
    })
    .from(events)
    .where(
      and(
        gte(events.startDate, today),
        lte(events.startDate, endOfThurs),
        sql`'Live Music' = ANY(${events.tags})`
      )
    )
    .orderBy(events.startDate);

  console.log('=== Live Music Events: Dec 2-4 ===');
  console.log('Total found:', results.length);
  console.log('');

  results.forEach((e, i) => {
    const date = new Date(e.startDate);
    const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    console.log(`${i + 1}. ${e.title}`);
    console.log(`   ${day} @ ${time}`);
    console.log(`   ${e.location || 'TBD'}`);
    console.log(`   Price: ${e.price || 'Unknown'}`);
    console.log('');
  });
}

main().then(() => process.exit(0));
