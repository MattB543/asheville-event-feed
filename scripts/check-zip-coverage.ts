/**
 * Check zip code coverage in the database
 */
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, isNull, isNotNull } from 'drizzle-orm';

async function main() {
  const total = await db.select({ count: sql<number>`count(*)` }).from(events);
  const withZip = await db.select({ count: sql<number>`count(*)` }).from(events).where(isNotNull(events.zip));
  const withoutZip = await db.select({ count: sql<number>`count(*)` }).from(events).where(isNull(events.zip));

  const bySource = await db.execute(sql`
    SELECT
      source,
      COUNT(*) as total,
      COUNT(zip) as with_zip,
      COUNT(*) - COUNT(zip) as without_zip,
      ROUND(COUNT(zip)::numeric / NULLIF(COUNT(*)::numeric, 0) * 100, 1) as coverage_pct
    FROM events
    GROUP BY source
    ORDER BY total DESC
  `);

  console.log('ZIP COVERAGE IN DATABASE');
  console.log('========================');
  console.log(`Total: ${total[0].count}`);
  console.log(`With zip: ${withZip[0].count}`);
  console.log(`Without zip: ${withoutZip[0].count}`);
  console.log(`Coverage: ${Math.round(Number(withZip[0].count) / Number(total[0].count) * 100)}%`);
  console.log('');
  console.log('By Source:');
  for (const row of bySource.rows as { source: string; total: number; with_zip: number; without_zip: number; coverage_pct: number }[]) {
    const src = String(row.source).padEnd(18);
    console.log(`  ${src} ${row.with_zip}/${row.total} (${row.coverage_pct}%)`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
