import '../../lib/config/env';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';

async function main() {
  const allEvents = await db
    .select({
      id: events.id,
      title: events.title,
      tags: events.tags,
    })
    .from(events);

  let nullTags = 0;
  let emptyTags = 0;
  let hasTags = 0;

  for (const ev of allEvents) {
    if (ev.tags === null) {
      nullTags++;
    } else if (Array.isArray(ev.tags) && ev.tags.length === 0) {
      emptyTags++;
    } else {
      hasTags++;
    }
  }

  console.log(`Total events: ${allEvents.length}`);
  console.log(`Tags IS NULL: ${nullTags}`);
  console.log(`Tags IS EMPTY ([]): ${emptyTags}`);
  console.log(`Tags HAS VALUES: ${hasTags}`);

  if (emptyTags > 0) {
    console.log('\nSample events with empty tags:');
    allEvents
      .filter((e) => Array.isArray(e.tags) && e.tags.length === 0)
      .slice(0, 5)
      .forEach((e) => {
        console.log(`- ${e.title}`);
      });
  }
}

main().catch(console.error);
