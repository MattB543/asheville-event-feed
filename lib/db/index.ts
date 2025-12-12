import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import * as schema from './schema';
import { env } from '../config/env';

type DbType = PostgresJsDatabase<typeof schema>;

let _db: DbType | null = null;
let _client: Sql | null = null;

function createDb(): DbType {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }
  // Disable prepare for Supabase transaction pooling (required for serverless)
  _client = postgres(env.DATABASE_URL, { prepare: false });
  return drizzle(_client, { schema });
}

// Lazy initialization - only creates connection when first used
export const db: DbType = new Proxy({} as DbType, {
  get(_target, prop: string | symbol) {
    if (!_db) {
      _db = createDb();
    }
    return Reflect.get(_db, prop);
  },
});
