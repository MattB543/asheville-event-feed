import { afterAll } from 'vitest';
import '../lib/config/env';
import { assertTestDatabase, TEST_DATABASE_URL } from './database';

// After env.ts has loaded .env, which would otherwise point the app at the local copy
process.env.DATABASE_URL = TEST_DATABASE_URL;
assertTestDatabase(process.env.DATABASE_URL);

afterAll(async () => {
  const { closeDb } = await import('../lib/db');
  await closeDb();
});
