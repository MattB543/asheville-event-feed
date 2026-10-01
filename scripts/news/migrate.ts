/**
 * Apply drizzle/0019_news.sql (the news_* tables) and verify the result.
 *
 * Usage:
 *   npx tsx scripts/news/migrate.ts            # apply, then verify
 *   npx tsx scripts/news/migrate.ts --verify   # read-only checks only
 *
 * The SQL is idempotent and wraps itself in one transaction, so re-running it
 * is harmless. Verification checks that each table exists with RLS enabled,
 * that anon/authenticated hold no privileges on it, and that its columns match
 * the Drizzle definitions in lib/db/schema.ts exactly (db.select() names every
 * declared column, so any drift breaks reads).
 */

import '../../lib/config/env';
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import { getTableColumns, getTableName, type Table } from 'drizzle-orm';
import { db } from '../../lib/db';
import { newsArticles, newsDays, newsSources, newsStories } from '../../lib/db/schema';

const MIGRATION = path.join(__dirname, '../../drizzle/0019_news.sql');
const TABLES: Table[] = [newsSources, newsArticles, newsStories, newsDays];

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  let problems = 0;
  const fail = (msg: string) => {
    problems++;
    console.error(`  FAIL ${msg}`);
  };

  try {
    if (!verifyOnly) {
      console.log(`Applying ${path.basename(MIGRATION)}...`);
      // No parameters, so postgres.js sends it as one simple-protocol query:
      // every statement, including the file's own BEGIN/COMMIT.
      await sql.unsafe(fs.readFileSync(MIGRATION, 'utf8'));
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
