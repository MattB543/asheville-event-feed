import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, isNull, gte, and, or } from 'drizzle-orm';

async function main() {
  const now = new Date();

  const problematic = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      source: events.source,
      tags: events.tags,
      aiSummary: events.aiSummary,
      organizer: events.organizer,
    })
    .from(events)
    .where(
      and(
        gte(events.startDate, now),
        or(
          sql`array_length(tags, 1) IS NULL OR array_length(tags, 1) = 0`,
          isNull(events.aiSummary)
        )
      )
    )
    .limit(10);

  console.log('Found', problematic.length, 'events needing processing');
  for (const e of problematic) {
    const hasTags = e.tags && e.tags.length > 0;
    const hasSummary = !!e.aiSummary;
    console.log('---');
    console.log('ID:', e.id);
    console.log('Title:', e.title);
    console.log('Source:', e.source);
    console.log('Organizer:', e.organizer);
    console.log('Has tags:', hasTags, '| Has summary:', hasSummary);
    console.log('Tags:', e.tags);
    if (!hasTags && !hasSummary) {
      console.log('>>> NEEDS BOTH - likely the blocker');
      console.log('Description:', e.description?.substring(0, 300));
    }
  }

  process.exit(0);
}

main();
