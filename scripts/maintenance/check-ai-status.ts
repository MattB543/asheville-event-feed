import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { sql, isNull, and, or } from 'drizzle-orm';

async function countAll() {
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(events);
  const [missingSummary] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      or(sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`, isNull(events.aiSummary))
    );
  const [missingEmbedding] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(isNull(events.embedding));
  const [missingScore] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(isNull(events.score));

  return {
    total: Number(total.count),
    missingSummary: Number(missingSummary.count),
    missingEmbedding: Number(missingEmbedding.count),
    missingScore: Number(missingScore.count),
  };
}

async function countFuture() {
  const now = new Date();
  const nowIso = now.toISOString();

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(sql`${events.startDate} >= ${nowIso}`);

  const [missingSummary] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        sql`${events.startDate} >= ${nowIso}`,
        or(sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`, isNull(events.aiSummary))
      )
    );

  const [missingEmbedding] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(sql`${events.startDate} >= ${nowIso}`, isNull(events.embedding)));

  const [missingScore] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(sql`${events.startDate} >= ${nowIso}`, isNull(events.score)));

  return {
    total: Number(total.count),
    missingSummary: Number(missingSummary.count),
    missingEmbedding: Number(missingEmbedding.count),
    missingScore: Number(missingScore.count),
  };
}

async function main() {
  const [allCounts, futureCounts] = await Promise.all([countAll(), countFuture()]);
  console.log(JSON.stringify({ all: allCounts, future: futureCounts }, null, 2));
}

main().catch((error) => {
  console.error('Failed to check AI status:', error instanceof Error ? error.message : error);
  process.exit(1);
});
