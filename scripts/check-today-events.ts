import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, gte, desc } from 'drizzle-orm';

async function checkTodayEvents() {
  // Get start of today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Count events by source created today
  const countBySource = await db.select({
    source: events.source,
    count: sql<number>`count(*)`
  })
  .from(events)
  .where(gte(events.createdAt, today))
  .groupBy(events.source);

  console.log('Events created today by source:');
  console.log(JSON.stringify(countBySource, null, 2));

  // Get sample events from each source created today
  const sampleEvents = await db.select({
    id: events.id,
    source: events.source,
    title: events.title,
    startDate: events.startDate,
    organizer: events.organizer,
    createdAt: events.createdAt
  })
  .from(events)
  .where(gte(events.createdAt, today))
  .orderBy(desc(events.createdAt))
  .limit(30);

  console.log('\nSample events created today (most recent 30):');
  sampleEvents.forEach(e => {
    const titleTrunc = e.title.length > 50 ? e.title.substring(0, 50) + '...' : e.title;
    console.log(`[${e.source}] ${titleTrunc} | ${e.organizer || 'No organizer'} | ${e.createdAt}`);
  });

  // Total count
  const totalCount = await db.select({
    count: sql<number>`count(*)`
  })
  .from(events)
  .where(gte(events.createdAt, today));

  console.log(`\nTotal events created today: ${totalCount[0].count}`);

  // Also show overall DB stats
  const overallCount = await db.select({
    source: events.source,
    count: sql<number>`count(*)`
  })
  .from(events)
  .groupBy(events.source);

  console.log('\n--- Overall DB Stats ---');
  console.log(JSON.stringify(overallCount, null, 2));

  const totalOverall = await db.select({
    count: sql<number>`count(*)`
  })
  .from(events);

  console.log(`Total events in DB: ${totalOverall[0].count}`);

  process.exit(0);
}

checkTodayEvents().catch(console.error);
