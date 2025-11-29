import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, like, asc } from 'drizzle-orm';

async function main() {
  // Check for Rumours ATL
  const rumours = await db.select().from(events).where(like(events.title, '%Rumours%'));
  console.log('Rumours ATL events:', rumours.length);
  for (const e of rumours) {
    console.log('  -', e.source, e.title, e.startDate.toLocaleDateString());
  }

  // Check earliest Orange Peel event
  const earliest = await db.select().from(events)
    .where(eq(events.source, 'ORANGE_PEEL'))
    .orderBy(asc(events.startDate))
    .limit(5);
  console.log('\nEarliest 5 Orange Peel events:');
  for (const e of earliest) {
    console.log('  -', e.startDate.toLocaleDateString(), e.title);
  }

  // Total count by source
  const allOrangePeel = await db.select().from(events).where(eq(events.source, 'ORANGE_PEEL'));
  console.log('\nTotal Orange Peel events:', allOrangePeel.length);
}

main().catch(console.error);
