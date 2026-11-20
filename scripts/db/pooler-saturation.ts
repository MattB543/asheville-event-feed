/**
 * Asks the database for more at once than the pool has connections, and checks that every
 * query finishes with its own answer. Read-only and small: a full run makes about 120 one-row
 * reads plus 4 read-only transactions. Every scenario ends after 8 seconds at most and then
 * closes its connections.
 *
 *   npx tsx scripts/db/pooler-saturation.ts           # the app's client
 *   npx tsx scripts/db/pooler-saturation.ts --plain   # postgres.js as it was before the fix
 *
 * Through Supabase's transaction pooler (port 6543) the plain client's queries go unanswered:
 * see onePerConnection in lib/db/index.ts. Exits 1 when a query is unanswered, fails or gets
 * another's answer.
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

// There is no max_pipeline mode: with 0, postgres.js sends BEGIN and then refuses the
// transaction, which leaves it open on the live database until the connection closes
const plain = process.argv.includes('--plain');
const label = plain ? 'plain postgres.js' : "the app's client (one query per connection)";

function open() {
  const raw = postgres(process.env.DATABASE_URL!, POOL_OPTIONS);
  const client = plain ? raw : onePerConnection(raw);
  return { client, db: drizzle(client, { schema }), close: () => raw.end({ timeout: 1 }) };
}
type Pool = ReturnType<typeof open>;

/** One query and the number it should answer with */
type Ask = { run: Promise<unknown>; expected: number };

const firstValue = (rows: unknown): unknown => Object.values((rows as object[])[0] ?? {})[0];

const noParams = ({ client }: Pool, i: number): Ask => ({
  run: client.unsafe(`select ${i} as i`).then(firstValue),
  expected: i,
});
const withParams = ({ client }: Pool, i: number): Ask => ({
  run: client.unsafe('select $1::int as i', [i]).then(firstValue),
  expected: i,
});
const drizzleExecute = ({ db }: Pool, i: number): Ask => ({
  run: db.execute(sql.raw(`select ${i} as i`)).then(firstValue),
  expected: i,
});
// Like the root layout's read: a Drizzle select on season_settings with no where clause, so no
// parameters. The count makes it one row whatever the table holds; `i` is this query's own.
const drizzleSelect = ({ db }: Pool, i: number): Ask => ({
  run: db
    .select({ i: sql<number>`${sql.raw(String(i))}`, seasons: sql<number>`count(*)::int` })
    .from(schema.seasonSettings)
    .then(firstValue),
  expected: i,
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
  ['Drizzle select with no where', (p) => range(BURST).map((i) => drizzleSelect(p, i))],
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
  const opened = open();
  const counts = { ok: 0, wrong: 0, failed: 0 };
  const errors = new Set<string>();
  const note = (error: unknown) =>
    errors.add(error instanceof Error ? error.message : String(error));
  let total = 0;
  let started = true;
  // Set when the scenario ends: closing the pool rejects whatever is still waiting, and those
  // count as unanswered, not failed
  let over = false;

  const work = async () => {
    // Open every connection first, as on a warm server: the burst then finds them all idle
    await Promise.all(range(POOL_OPTIONS.max).map(() => opened.client.unsafe('select 1')));
    const all = asks(opened).map(({ run, expected }) =>
      run.then(
        (value) => {
          if (over) return;
          if (value === expected) counts.ok++;
          else counts.wrong++;
        },
        (error: unknown) => {
          if (over) return;
          counts.failed++;
          note(error);
        }
      )
    );
    total = all.length;
    await Promise.all(all);
  };

  // The time limit covers the warm-up too: a connection that opens and then never answers
  // must not keep the script, or its connections to the database, open
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise((done) => (timer = setTimeout(done, WAIT_MS)));
  try {
    await Promise.race([
      work().catch((error: unknown) => {
        if (over) return;
        started = false;
        note(error);
      }),
      limit,
    ]);
  } finally {
    over = true;
    clearTimeout(timer);
    await opened.close();
  }

  const unanswered = total - counts.ok - counts.wrong - counts.failed;
  const failures = [...errors].join('; ').slice(0, 160);
  const passed = total > 0 && counts.ok === total;
  const problems = [
    !started && `could not start (${failures})`,
    started && !total && `warm-up unanswered after ${WAIT_MS / 1000} seconds`,
    unanswered && `${unanswered} unanswered after ${WAIT_MS / 1000} seconds`,
    counts.wrong && `${counts.wrong} got another query's answer`,
    counts.failed && `${counts.failed} failed (${failures})`,
  ].filter(Boolean);
  console.log(
    `${passed ? 'ok  ' : 'FAIL'}  ${name.padEnd(42)} ${counts.ok}/${total} answered` +
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
