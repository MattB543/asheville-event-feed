import '../../lib/config/env';
import { db } from '../../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  const now = new Date();

  // Most recent scraper activity
  const recentResult = await db.execute(sql`
    SELECT source, "lastSeenAt"
    FROM events
    ORDER BY "lastSeenAt" DESC NULLS LAST
    LIMIT 5
  `);

  console.log('\n=== Most Recent Scraper Activity ===');
  for (const r of recentResult) {
    const ago = Math.round(
      (now.getTime() - new Date(r.lastSeenAt as string).getTime()) / 1000 / 60
    );
    console.log(`  ${r.source}: ${ago} min ago`);
  }

  // Count by source in last 24h
  const countResult = await db.execute(sql`
    SELECT source, COUNT(*)::int as count
    FROM events
    WHERE "lastSeenAt" >= NOW() - INTERVAL '24 hours'
    GROUP BY source
    ORDER BY count DESC
  `);

  console.log('\n=== Events Scraped in Last 24h ===');
  let total = 0;
  for (const r of countResult) {
    console.log(`  ${r.source}: ${r.count}`);
    total += Number(r.count);
  }
  console.log(`  TOTAL: ${total}`);

  // AI processing status
  const aiResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE tags IS NULL OR array_length(tags, 1) IS NULL)::int as missing_tags,
      COUNT(*) FILTER (WHERE embedding IS NULL)::int as missing_embedding,
      COUNT(*) FILTER (WHERE "aiSummary" IS NULL)::int as missing_summary,
      COUNT(*)::int as total
    FROM events
    WHERE "startDate" >= NOW()
  `);

  const s = aiResult[0] as Record<string, number>;
  console.log('\n=== Upcoming Events AI Status ===');
  console.log(`  Total upcoming: ${s.total}`);
  console.log(
    `  Missing tags: ${s.missing_tags}${s.missing_tags > 0 ? ' (needs attention)' : ' OK'}`
  );
  console.log(
    `  Missing embeddings: ${s.missing_embedding}${s.missing_embedding > 0 ? ' (needs attention)' : ' OK'}`
  );
  console.log(
    `  Missing summaries: ${s.missing_summary}${s.missing_summary > 0 ? ' (needs attention)' : ' OK'}`
  );

  // New events in last 24h
  const newResult = await db.execute(sql`
    SELECT COUNT(*)::int as count FROM events WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
  `);
  console.log('\n=== New Events Added (Last 24h) ===');
  console.log(`  ${(newResult[0] as Record<string, number>).count} new events`);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
