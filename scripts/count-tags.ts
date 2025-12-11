import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  const result = await db.execute(sql`
    SELECT unnest(tags) as tag, COUNT(*) as count
    FROM events
    WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `);

  console.log('Tag | Count');
  console.log('--- | ---');
  for (const row of result.rows) {
    const r = row as { tag: string; count: number };
    console.log(`${r.tag} | ${r.count}`);
  }
  console.log(`\nTotal unique tags: ${result.rows.length}`);
  process.exit(0);
}

main();
