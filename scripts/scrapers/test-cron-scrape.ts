import 'dotenv/config';

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function main() {
  console.log('Testing /api/cron/scrape endpoint...\n');

  if (!CRON_SECRET) {
    console.error('CRON_SECRET not set in .env');
    process.exit(1);
  }

  const url = `${BASE_URL}/api/cron/scrape`;
  console.log(`URL: ${url}`);
  console.log(`Auth: Bearer ${CRON_SECRET.substring(0, 4)}...`);
  console.log('\nStarting request (this may take a few minutes)...\n');

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min timeout

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const duration = Date.now() - startTime;
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s\n`);

    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
