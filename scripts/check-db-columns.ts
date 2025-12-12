import { neon } from '@neondatabase/serverless';
import { env } from '../lib/config/env';

async function main() {
  const sql = neon(env.DATABASE_URL);

  console.log('Columns in events table:');
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'events' ORDER BY ordinal_position`;

  for (const c of cols) {
    console.log(`  ${c.column_name}: ${c.data_type}`);
  }

  console.log('\nTrying direct count:');
  const count = await sql`SELECT COUNT(*) as cnt FROM events`;
  console.log(`  Events count: ${count[0].cnt}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
