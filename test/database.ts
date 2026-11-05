/**
 * The database the `*.db.test.ts` tests write to. Everything that touches it checks the name
 * first: lib/config/env.ts lets .env override DATABASE_URL, so a test could otherwise land on the
 * local copy of the site's data.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/avlgo_test';

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run database tests against "${name}": its name must end in _test`);
  }
}
