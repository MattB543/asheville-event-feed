import { env } from '../lib/config/env';
import { GET as aiCron } from '../app/api/cron/ai/route';

async function main() {
  if (!env.CRON_SECRET) {
    console.error('CRON_SECRET not set in .env');
    process.exit(1);
  }

  const request = new Request('http://localhost/api/cron/ai', {
    headers: {
      authorization: `Bearer ${env.CRON_SECRET}`,
    },
  });

  const response = await aiCron(request);
  const text = await response.text();
  console.log(text);
}

main().catch((error) => {
  console.error('AI cron failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
