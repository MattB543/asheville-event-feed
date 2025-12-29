import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  const result = await db.execute(sql`
    SELECT 
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE ai_summary IS NULL)::int as missing_summary,
      COUNT(*) FILTER (WHERE tags IS NULL OR tags = '{}')::int as missing_tags,
      COUNT(*) FILTER (WHERE score IS NULL)::int as missing_score,
      COUNT(*) FILTER (WHERE embedding IS NULL)::int as missing_embedding
    FROM events
    WHERE start_date >= NOW() 
      AND start_date <= NOW() + INTERVAL '3 months'
  `);
  
  const row = result[0] as any;
  console.log('=== FUTURE EVENTS (next 3 months) ===');
  console.log('Total:', row.total);
  console.log('Missing Summary:', row.missing_summary);
  console.log('Missing Tags:', row.missing_tags);
  console.log('Missing Score:', row.missing_score);
  console.log('Missing Embedding:', row.missing_embedding);
  console.log('');
  const complete = row.total - Math.max(row.missing_summary, row.missing_tags, row.missing_score, row.missing_embedding);
  console.log('Fully Complete:', complete, '/', row.total);
  process.exit(0);
}

main();
