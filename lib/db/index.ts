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

type Params = postgres.ParameterOrJSON<never>[];
// postgres.js's query options plus `onexecute`, the hook sql.begin() uses to keep a
// transaction's connection. It isn't in the library's types or docs, so
// lib/db/onePerConnection.db.test.ts checks that it still works.
type QueryOptions = postgres.UnsafeQueryOptions & { onexecute?: () => boolean };

// Returning false makes postgres.js count the connection as full once it has this query, so
// the next one waits for a free connection. max_pipeline can't do this: 1 still lets a second
// query in, and 0 skips this same hook for begin(), which breaks every transaction.
const NO_SECOND_QUERY: QueryOptions = { onexecute: () => false };

/**
 * Gives each connection one query at a time, for the calls Drizzle makes: `unsafe` and
 * `begin`. When every connection is busy, postgres.js writes the next query to one that is
 * still waiting for an answer (a query with bind parameters refuses that, one with none
 * accepts it). Through Supabase's transaction pooler, two queries written together got one
 * answer: the other was still unanswered when the test gave up, and because postgres.js
 * matches answers to queries in order, a later query's answer can then go to the wrong one
 * (measured 2026-11-20, scripts/db/pooler-saturation.ts).
 *
 * Not a general postgres.js wrapper. A tagged-template query (client`select 1`), `reserve()`
 * and cancelling a query that is waiting inside a transaction are not handled, and a nested
 * transaction is refused: postgres.js sends SAVEPOINT itself, where this can't reach it.
 * Nothing in the app does any of these.
 */
export function onePerConnection<T extends Sql | TransactionSql>(client: T): T {
  return new Proxy(client, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      if (prop === 'unsafe') {
        // As in postgres.js, the second argument may be the options
        return (query: string, params: Params | QueryOptions = [], options: QueryOptions = {}) =>
          Array.isArray(params)
            ? target.unsafe(query, params, { ...options, ...NO_SECOND_QUERY })
            : target.unsafe(query, [], { ...params, ...NO_SECOND_QUERY });
      }
      // A transaction's queries go through the client its callback is given
      if (prop === 'begin') {
        const begin = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const callback = args.pop() as (tx: TransactionSql) => unknown;
          return begin(...args, (tx: TransactionSql) => callback(onePerConnection(tx)));
        };
      }
      if (prop === 'savepoint') {
        return () => {
          throw new Error('Nested transactions are not supported: see onePerConnection');
        };
      }
      return value;
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
