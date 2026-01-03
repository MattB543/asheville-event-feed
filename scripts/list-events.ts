import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  const sources = ['AVL_TODAY', 'EXPLORE_ASHEVILLE', 'MOUNTAIN_X'];

  for (const source of sources) {
    const result = await db
      .select({
        id: events.id,
        title: events.title,
        url: events.url,
      })
      .from(events)
      .where(and(eq(events.source, source), eq(events.hidden, false)))
      .limit(3);

    console.log(`\n${source} events:`);
    for (const e of result) {
      console.log(`  ${e.id.slice(0, 6)} - ${e.title.slice(0, 40)}...`);
      console.log(`    URL: ${e.url}`);
    }
  }

  process.exit(0);
}

main();
