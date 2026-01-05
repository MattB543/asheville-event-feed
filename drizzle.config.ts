import { defineConfig } from 'drizzle-kit';
import { env } from './lib/config/env';

// Prefer DIRECT db connection (5432) for migrations/introspection,
// not the pooler (6543), if you're currently using pooler.
function getDirectDatabaseUrl(): string {
  const url = env.DATABASE_URL;
  // Replace pooler port (6543) with direct port (5432)
  return url.replace(/:6543\//, ':5432/');
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: getDirectDatabaseUrl(),
  },
  schemaFilter: 'public',
});
