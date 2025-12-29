import '../../lib/config/env';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { gte, asc } from 'drizzle-orm';

async function main() {
  const now = new Date();
  const results = await db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      location: events.location,
      startDate: events.startDate,
      source: events.source,
      description: events.description
    })
    .from(events)
    .where(gte(events.startDate, now))
    .orderBy(asc(events.startDate))
    .limit(200);

  for (const e of results) {
    const desc = e.description ? e.description.substring(0, 100) : 'No description';
    console.log('---');
    console.log('ID:', e.id);
    console.log('Title:', e.title);
    console.log('Date:', e.startDate);
    console.log('Organizer:', e.organizer);
    console.log('Location:', e.location);
    console.log('Source:', e.source);
    console.log('Desc preview:', desc);
  }
  process.exit(0);
}

main();
