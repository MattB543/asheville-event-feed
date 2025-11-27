import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { env } from '../config/env';

type DbType = NeonHttpDatabase<typeof schema>;

let _db: DbType | null = null;
let _sql: NeonQueryFunction<false, false> | null = null;

function createDb(): DbType {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }
  _sql = neon(env.DATABASE_URL);
  return drizzle(_sql, { schema });
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
