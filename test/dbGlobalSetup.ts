import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { assertTestDatabase, TEST_DATABASE_URL } from './database';

/** Creates the test database if needed and brings its tables up to the schema, once per run. */
export default async function setup() {
  assertTestDatabase(TEST_DATABASE_URL);
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);

  const admin = postgres({ ...connection(url), database: 'postgres' });
  try {
    const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    // template0: a machine's template1 can carry extensions (PostGIS) the schema push trips over
    if (!exists) await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
  } finally {
    await admin.end();
  }

  const testDb = postgres(TEST_DATABASE_URL);
  try {
    await testDb`CREATE EXTENSION IF NOT EXISTS vector`;
  } finally {
    await testDb.end();
  }

  execFileSync('npx', ['drizzle-kit', 'push', '--force', '--config', 'drizzle.test.config.ts'], {
    stdio: 'pipe',
  });
}

function connection(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
  };
}
