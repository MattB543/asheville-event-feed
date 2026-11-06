import { defineConfig } from '@playwright/test';

const PORT = 3100;
// Its own database, filled by test/browser/prepare.ts; the vitest suite empties avlgo_test
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/avlgo_browser_test';

export default defineConfig({
  testDir: 'test/browser',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The Chrome already installed, so nothing is downloaded
    channel: 'chrome',
    // What CI keeps when a test fails
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // A production build, which can run beside your own `npm run dev`
    command: `npx tsx test/browser/prepare.ts && npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 10 * 60_000,
    reuseExistingServer: false,
    env: { TEST_DATABASE_URL },
  },
});
