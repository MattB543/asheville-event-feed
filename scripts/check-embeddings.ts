import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function checkEmbeddings() {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int as with_embeddings,
      COUNT(*) FILTER (WHERE embedding IS NULL)::int as without_embeddings
    FROM events
    WHERE start_date > NOW()
  `);

  const row = result[0] as any;
  console.log('Future Events Statistics:');
  console.log('-------------------------');
  console.log('With embeddings:', row.with_embeddings);
  console.log('Without embeddings:', row.without_embeddings);
  console.log('Total future events:', row.total);
  const coverage = (row.with_embeddings / row.total) * 100;
  console.log('Coverage:', coverage.toFixed(1) + '%');

  process.exit(0);
}

checkEmbeddings().catch(e => { console.error(e); process.exit(1); });
