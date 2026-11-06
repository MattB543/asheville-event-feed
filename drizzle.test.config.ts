import { defineConfig } from 'drizzle-kit';
import { assertTestDatabase, TEST_DATABASE_URL } from './test/database';

// Builds the test database's tables from the schema; never reads .env
assertTestDatabase(TEST_DATABASE_URL);

export default defineConfig({
  schema: './lib/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: TEST_DATABASE_URL },
  schemaFilter: 'public',
});
