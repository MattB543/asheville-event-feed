import '../lib/config/env';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, desc, gte } from 'drizzle-orm';

async function main() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  console.log('');
  console.log('='.repeat(60));
  console.log('Cron Health Check - Last 24 Hours');
  console.log('='.repeat(60));
  console.log(`Current time: ${now.toLocaleString()}`);
  console.log('');

  // 1. Check scraper activity by source (lastSeenAt updates)
  console.log('[SCRAPER] ACTIVITY (events seen in last 24h)');
  console.log('-'.repeat(60));

  const recentlySeen = await db
    .select({
      source: events.source,
      count: sql<number>`count(*)::int`,
      latestSeen: sql<string>`max(last_seen_at)`,
    })
    .from(events)
    .where(gte(events.lastSeenAt, oneDayAgo))
    .groupBy(events.source)
    .orderBy(desc(sql`count(*)`));

  let totalSeen = 0;
  console.log('Source'.padEnd(22) + 'Count'.padEnd(8) + 'Last Seen');
  console.log('-'.repeat(60));
  for (const row of recentlySeen) {
    const lastSeen = new Date(row.latestSeen).toLocaleString();
    console.log(row.source.padEnd(22) + String(row.count).padEnd(8) + lastSeen);
    totalSeen += row.count;
  }
  console.log('-'.repeat(60));
  console.log('TOTAL'.padEnd(22) + String(totalSeen));
  console.log('');

  // 2. Check for new events created
  const newEvents = await db
    .select({
      source: events.source,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(gte(events.createdAt, oneDayAgo))
    .groupBy(events.source)
    .orderBy(desc(sql`count(*)`));

  console.log('[NEW EVENTS] CREATED (last 24h)');
  console.log('-'.repeat(60));
  let totalNew = 0;
  for (const row of newEvents) {
    console.log(row.source.padEnd(22) + row.count);
    totalNew += row.count;
  }
  if (totalNew === 0) {
    console.log('(none)');
  }
  console.log('-'.repeat(60));
  console.log('TOTAL'.padEnd(22) + totalNew);
  console.log('');

  // 3. Check AI processing (events with AI summary updated recently)
  const oneDayAgoISO = oneDayAgo.toISOString();
  const aiProcessed = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(sql`updated_at >= ${oneDayAgoISO}::timestamptz AND ai_summary IS NOT NULL`);

  const withEmbeddings = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(sql`embedding IS NOT NULL`);

  const withoutEmbeddings = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(sql`embedding IS NULL AND start_date >= now()`);

  console.log('[AI] PROCESSING STATUS');
  console.log('-'.repeat(60));
  console.log(`Events updated with AI in last 24h:  ${aiProcessed[0].count}`);
  console.log(`Total events with embeddings:        ${withEmbeddings[0].count}`);
  console.log(`Future events missing embeddings:    ${withoutEmbeddings[0].count}`);
  console.log('');

  // 4. Check for potential issues
  console.log('[WARN] POTENTIAL ISSUES');
  console.log('-'.repeat(60));

  // Check if any source hasn't been seen in 24h
  const allSources = [
    'AVL_TODAY',
    'EVENTBRITE',
    'MEETUP',
    'EXPLORE_ASHEVILLE',
    'ORANGE_PEEL',
    'GREY_EAGLE',
    'HARRAHS',
    'LIVE_MUSIC_AVL',
  ];
  const seenSources = new Set(recentlySeen.map((r) => r.source));
  const missingSources = allSources.filter((s) => !seenSources.has(s));

  if (missingSources.length > 0) {
    console.log(`Sources not seen in 24h: ${missingSources.join(', ')}`);
  } else {
    console.log('[OK] All major sources have been scraped recently');
  }

  // Check if scraping happened in last 6 hours (should have run at least once)
  const recentScrape = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(gte(events.lastSeenAt, sixHoursAgo));

  if (recentScrape[0].count === 0) {
    console.log('[WARN] No scraping activity in last 6 hours - cron may have issues');
  } else {
    console.log(`[OK] ${recentScrape[0].count} events seen in last 6 hours`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('');
  console.log('Note: Runtime logs are only stored for ~1 hour in Vercel.');
  console.log('For detailed cron logs, check: https://vercel.com/dashboard');
  console.log('');
}

main().catch(console.error);
