import { neon } from '@neondatabase/serverless';
import { env } from '../../lib/config/env';

async function main() {
  console.log('Connecting to:', env.DATABASE_URL?.substring(0, 60) + '...');

  const sql = neon(env.DATABASE_URL);

  console.log('\nChecking tables in public schema...');
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;

  if (tables.length === 0) {
    console.log('No tables found! Database appears to be empty.');
    console.log('\nYou may need to run: npx drizzle-kit push');
  } else {
    console.log('Tables found:');
    for (const t of tables) {
      console.log(`  - ${t.table_name}`);
    }
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
