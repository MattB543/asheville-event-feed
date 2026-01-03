import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';
import { env } from '../config/env';

type DbType = PostgresJsDatabase<typeof schema>;

let _db: DbType | null = null;
let _client: Sql | null = null;

function createDb(): DbType {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }
  // Configure for Supabase transaction pooling (serverless)
  _client = postgres(env.DATABASE_URL, {
    prepare: false, // Required for Supabase transaction mode (pgbouncer)
    max: 5, // Allow concurrent requests with Vercel Fluid compute
    idle_timeout: 20, // Close idle connections after 20s
    connect_timeout: 30, // 30s connection timeout (matches URL param)
  });
  return drizzle(_client, { schema });
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
