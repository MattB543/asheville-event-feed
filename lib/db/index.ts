import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import * as schema from './schema';
import { env } from '../config/env';

type DbType = PostgresJsDatabase<typeof schema>;

let _db: DbType | null = null;
let _client: Sql | null = null;

// Configured for Supabase transaction pooling (serverless)
export const POOL_OPTIONS = {
  prepare: false, // Required for Supabase transaction mode (pgbouncer)
  max: 5, // Allow concurrent requests with Vercel Fluid compute
  idle_timeout: 20, // Close idle connections after 20s
  connect_timeout: 30, // 30s connection timeout (matches URL param)
};

// Makes postgres.js report a connection as full once it has a query, so the next query waits
// for a free connection. It is the hook sql.begin() uses to keep a transaction's connection;
// it isn't in the library's types or docs, so lib/db/onePerConnection.db.test.ts checks that
// it still works. max_pipeline can't do this: 1 still lets a second query in, and 0 skips
// this same hook for begin(), which breaks every transaction.
const NO_SECOND_QUERY = { onexecute: () => false } as object;

type Callback = (tx: TransactionSql) => unknown;

/**
 * Gives each connection one query at a time. When every connection is busy, postgres.js
 * writes the next query to one that is still waiting for an answer (a query with bind
 * parameters refuses that, one with none accepts it). Supabase's transaction pooler answers
 * only the first query of two that reach it together and drops the other without an error:
 * that query never finishes, and each later query on the connection gets the answer meant
 * for the one after it (measured 2026-11-20, scripts/db/pooler-saturation.ts).
 *
 * Covers what Drizzle calls: `unsafe`, `begin` and `savepoint`. A tagged-template query
 * (client`select 1`) or `reserve()` on the wrapped client is not covered.
 */
export function onePerConnection<T extends Sql | TransactionSql>(client: T): T {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'unsafe') {
        return (query: string, params: never[] = [], options: object = {}) =>
          target.unsafe(query, params, { ...options, ...NO_SECOND_QUERY });
      }
      // A transaction's queries go through the client its callback is given
      if (prop === 'begin' || prop === 'savepoint') {
        const start = Reflect.get(target, prop) as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const callback = args.pop() as Callback;
          return start(...args, (tx: TransactionSql) => callback(onePerConnection(tx)));
        };
      }
      return Reflect.get(target, prop) as unknown;
    },
  });
}

function createDb(): DbType {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }
  _client = postgres(env.DATABASE_URL, POOL_OPTIONS);
  return drizzle(onePerConnection(_client), { schema });
}

// Lazy initialization - only creates connection when first used
export const db: DbType = new Proxy({} as DbType, {
  get(_target, prop: string | symbol) {
    if (!_db) {
      _db = createDb();
    }
    return Reflect.get(_db, prop) as DbType[keyof DbType];
  },
});

/** Closes the connection pool, so a process that is done with the database can exit. */
export async function closeDb(): Promise<void> {
  await _client?.end();
  _client = null;
  _db = null;
}
