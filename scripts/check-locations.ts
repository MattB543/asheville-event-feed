import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  // Get distinct locations and their counts
  const locations = await db.select({
    location: events.location,
    count: sql<number>`count(*)::int`
  })
  .from(events)
  .groupBy(events.location)
  .orderBy(sql`count(*) desc`)
  .limit(100);

  console.log('=== Distinct Locations (Top 100 by count) ===\n');
  locations.forEach(l => {
    console.log(`[${l.count}] ${l.location || '(null)'}`);
  });

  // Total events count
  const totalCount = await db.select({ count: sql<number>`count(*)::int` }).from(events);
  console.log(`\n=== Total Events: ${totalCount[0].count} ===`);

  // Show some sample events with their locations to understand the format
  console.log('\n=== Sample Events with Locations ===\n');
  const samples = await db.select({
    title: events.title,
    location: events.location,
    source: events.source
  })
  .from(events)
  .limit(20);

  samples.forEach(e => {
    console.log(`[${e.source}] "${e.title.substring(0, 50)}..." -> ${e.location || '(null)'}`);
  });
}

main().catch(console.error).finally(() => process.exit(0));
