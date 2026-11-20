/**
 * Asks the database for more at once than the pool has connections, and checks that every
 * query finishes with its own answer. Read-only and small (about 80 one-row queries), so it
 * is safe against the live database in .env.
 *
 *   npx tsx scripts/db/pooler-saturation.ts                   # the app's client
 *   npx tsx scripts/db/pooler-saturation.ts --plain           # postgres.js as it was before the fix
 *   npx tsx scripts/db/pooler-saturation.ts --max-pipeline 1  # plain, with that option (0 or 1)
 *
 * Against Supabase's transaction pooler (port 6543) the plain client loses queries: see
 * onePerConnection in lib/db/index.ts. Exits 1 when a query hangs, fails or gets another's answer.
 */
import '../../lib/config/env';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { onePerConnection, POOL_OPTIONS } from '../../lib/db';
import * as schema from '../../lib/db/schema';

const BURST = 12; // POOL_OPTIONS.max is 5
const TRANSACTIONS = 4;
const WAIT_MS = 8000;

const args = process.argv.slice(2);
const maxPipeline = args.includes('--max-pipeline')
  ? Number(args[args.indexOf('--max-pipeline') + 1])
  : null;
const plain = args.includes('--plain') || maxPipeline !== null;
const label = !plain
  ? "the app's client (one query per connection)"
  : maxPipeline === null
    ? 'plain postgres.js'
    : `plain postgres.js, max_pipeline ${maxPipeline}`;

function open() {
  const raw = postgres(process.env.DATABASE_URL!, {
    ...POOL_OPTIONS,
    ...(maxPipeline === null ? {} : { max_pipeline: maxPipeline }),
  });
  const client = plain ? raw : onePerConnection(raw);
  return { client, db: drizzle(client, { schema }), close: () => raw.end({ timeout: 1 }) };
}
type Pool = ReturnType<typeof open>;

/** One query that should answer with `expected`; a null `expected` only has to finish. */
type Ask = { run: Promise<unknown>; expected: number | null };

const firstValue = (rows: unknown): unknown => Object.values((rows as object[])[0] ?? {})[0];

const noParams = ({ client }: Pool, i: number): Ask => ({
  run: client.unsafe(`select ${i} as i`).then(firstValue),
  expected: i,
});
const withParams = ({ client }: Pool, i: number): Ask => ({
  run: client.unsafe('select $1::int as i', [i] as never[]).then(firstValue),
  expected: i,
});
const drizzleExecute = ({ db }: Pool, i: number): Ask => ({
  run: db.execute(sql.raw(`select ${i} as i`)).then(firstValue),
  expected: i,
});
// The root layout's read: a select with no where clause, so no parameters
const drizzleSelect = ({ db }: Pool): Ask => ({
  run: db.select({ key: schema.seasonSettings.key }).from(schema.seasonSettings),
  expected: null,
});
const mixed = (pool: Pool, i: number): Ask =>
  [noParams, withParams, drizzleExecute, drizzleSelect][i % 4](pool, i);

/**
 * A read-only transaction: two queries one after the other, then two at once. It answers with
 * `i` only if all four ran inside the transaction, on one database connection.
 */
const transaction = ({ db }: Pool, i: number): Ask => ({
  run: db.transaction(
    async (tx) => {
      const inside = sql`select pg_backend_pid() as pid, current_setting('transaction_read_only') as ro`;
      const [first] = await tx.execute(inside);
      const [second] = await tx.execute(inside);
      const [a, b] = await Promise.all([
        tx.execute(sql.raw(`select ${i} as i, pg_backend_pid() as pid`)),
        tx.execute(sql`select ${i}::int as i, pg_backend_pid() as pid`),
      ]);
      const rows = [first, second, a[0], b[0]];
      const oneConnection = rows.every((row) => row.pid === first.pid);
      const readOnly = first.ro === 'on' && second.ro === 'on';
      return oneConnection && readOnly && a[0].i === i && b[0].i === i ? i : -1;
    },
    { accessMode: 'read only' }
  ),
  expected: i,
});

const SCENARIOS: [string, (pool: Pool) => Ask[]][] = [
  ['postgres.js, no parameters', (p) => range(BURST).map((i) => noParams(p, i))],
  ['postgres.js, with parameters', (p) => range(BURST).map((i) => withParams(p, i))],
  ['Drizzle db.execute, no parameters', (p) => range(BURST).map((i) => drizzleExecute(p, i))],
  ['Drizzle select with no where', (p) => range(BURST).map(() => drizzleSelect(p))],
  ['all four kinds mixed', (p) => range(BURST).map((i) => mixed(p, i))],
  [
    'transactions while the pool is saturated',
    (p) => [
      ...range(BURST).map((i) => mixed(p, i)),
      ...range(TRANSACTIONS).map((i) => transaction(p, 100 + i)),
    ],
  ],
];

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

async function runScenario(name: string, asks: (pool: Pool) => Ask[]): Promise<boolean> {
  const pool = open();
  // Open every connection first, as on a warm server: the burst then finds them all idle
  await Promise.all(range(POOL_OPTIONS.max).map(() => pool.client.unsafe('select 1')));
  const counts = { ok: 0, wrong: 0, failed: 0 };
  const errors = new Set<string>();
  const all = asks(pool).map(({ run, expected }) =>
    run.then(
      (value) => {
        if (expected === null || value === expected) counts.ok++;
        else counts.wrong++;
      },
      (error: unknown) => {
        counts.failed++;
        errors.add(error instanceof Error ? error.message : String(error));
      }
    )
  );
  await Promise.race([Promise.all(all), new Promise((done) => setTimeout(done, WAIT_MS))]);
  const hung = all.length - counts.ok - counts.wrong - counts.failed;
  // Closing the pool rejects whatever is still waiting; those were already counted as hung
  const settled = { ...counts };
  await pool.close();

  const passed = settled.ok === all.length;
  const problems = [
    hung && `${hung} never finished`,
    settled.wrong && `${settled.wrong} got another query's answer`,
    settled.failed && `${settled.failed} failed (${[...errors].join('; ').slice(0, 160)})`,
  ].filter(Boolean);
  console.log(
    `${passed ? 'ok  ' : 'FAIL'}  ${name.padEnd(42)} ${settled.ok}/${all.length} finished` +
      (problems.length ? `  -  ${problems.join(', ')}` : '')
  );
  return passed;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  console.log(`${label}, max ${POOL_OPTIONS.max}, against ${url.hostname}:${url.port || 5432}`);
  let failures = 0;
  for (const [name, asks] of SCENARIOS) {
    if (!(await runScenario(name, asks))) failures++;
  }
  console.log(failures ? `\n${failures} of ${SCENARIOS.length} scenarios failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
}

void main();
