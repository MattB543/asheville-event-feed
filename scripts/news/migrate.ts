/**
 * Apply a news migration (default drizzle/0019_news.sql, the news_* tables)
 * and verify the result.
 *
 * Usage:
 *   npx tsx scripts/news/migrate.ts                                 # apply 0019, then verify
 *   npx tsx scripts/news/migrate.ts drizzle/0020_news_ai_lease.sql  # apply that file, then verify
 *   npx tsx scripts/news/migrate.ts --verify                        # read-only checks only
 *
 * The SQL is idempotent, so re-running it is harmless. Verification checks
 * that each table exists with RLS enabled, that anon/authenticated hold no
 * privileges on it, that its columns match the Drizzle definitions in
 * lib/db/schema.ts exactly (db.select() names every declared column, so any
 * drift breaks reads), and that the news-ai lease index exists.
 */

import '../../lib/config/env';
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import { getTableColumns, getTableName, type Table } from 'drizzle-orm';
import { db } from '../../lib/db';
import { newsArticles, newsDays, newsSources, newsStories } from '../../lib/db/schema';

const DEFAULT_MIGRATION = path.join(__dirname, '../../drizzle/0019_news.sql');
const TABLES: Table[] = [newsSources, newsArticles, newsStories, newsDays];
const LEASE_INDEX = 'cron_job_runs_one_running_news_ai';

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const migration = file ? path.resolve(file) : DEFAULT_MIGRATION;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  let problems = 0;
  const fail = (msg: string) => {
    problems++;
    console.error(`  FAIL ${msg}`);
  };

  try {
    if (!verifyOnly) {
      console.log(`Applying ${path.basename(migration)}...`);
      // No parameters, so postgres.js sends it as one simple-protocol query:
      // every statement, including the file's own BEGIN/COMMIT.
      await sql.unsafe(fs.readFileSync(migration, 'utf8'));
      console.log('Applied.');
    }

    for (const table of TABLES) {
      const name = getTableName(table);
      console.log(`\n${name}`);

      const [cls] = await sql<{ relrowsecurity: boolean }[]>`
        SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ${name} AND c.relkind = 'r'`;
      if (!cls) {
        fail('table does not exist');
        continue;
      }
      if (cls.relrowsecurity) console.log('  ok   RLS enabled');
      else fail('RLS is not enabled');

      const grants = await sql<{ grantee: string; privilege_type: string }[]>`
        SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = ${name} AND grantee IN ('anon', 'authenticated')`;
      if (grants.length === 0) console.log('  ok   no anon/authenticated grants');
      else fail(`grants: ${grants.map((g) => `${g.grantee}:${g.privilege_type}`).join(', ')}`);

      const policies =
        await sql`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${name}`;
      if (policies.length > 0)
        fail(`unexpected policies: ${policies.map((p) => p.policyname).join(', ')}`);

      const dbColumns = await sql<
        { column_name: string; data_type: string; udt_name: string; is_nullable: string }[]
      >`
        SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}`;
      const byName = new Map(dbColumns.map((c) => [c.column_name, c]));
      const declared = Object.values(getTableColumns(table));
      for (const col of declared) {
        const actual = byName.get(col.name);
        if (!actual) {
          fail(`column ${col.name} is declared in Drizzle but missing from the table`);
          continue;
        }
        byName.delete(col.name);
        const nullable = actual.is_nullable === 'YES';
        if (nullable === col.notNull) {
          fail(
            `column ${col.name}: Drizzle notNull=${col.notNull}, table is_nullable=${actual.is_nullable}`
          );
        }
        // Drizzle's SQL type ('text[]', 'vector(1536)', 'timestamp with time zone') vs the catalog's
        const want = col.getSQLType().replace(/\(.*\)$/, '');
        const have =
          actual.data_type === 'ARRAY'
            ? `${actual.udt_name.replace(/^_/, '')}[]`
            : actual.data_type === 'USER-DEFINED'
              ? actual.udt_name
              : actual.data_type;
        if (want !== have) fail(`column ${col.name}: Drizzle type ${want}, table type ${have}`);
      }
      for (const extra of byName.keys())
        fail(`column ${extra} exists in the table but not in Drizzle`);
      console.log(`  ok   ${declared.length} columns checked against Drizzle`);

      // The real test: a full-width Drizzle select must not error.
      await db.select().from(table).limit(1);
      console.log('  ok   db.select() works');
    }

    console.log('\ncron_job_runs');
    const [lease] = await sql`
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${LEASE_INDEX}`;
    if (lease) console.log(`  ok   ${LEASE_INDEX} exists`);
    else fail(`${LEASE_INDEX} is missing: apply drizzle/0020_news_ai_lease.sql`);
  } finally {
    await sql.end();
  }

  console.log(problems === 0 ? '\nAll checks passed.' : `\n${problems} problem(s).`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
