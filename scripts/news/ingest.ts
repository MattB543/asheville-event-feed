/**
 * Run the news ingest locally, localOnly sources included, and record it in
 * cron_job_runs as 'news-scrape' just like the cron does.
 *
 * Usage:
 *   npx tsx scripts/news/ingest.ts
 *
 * scripts/news/run-local.ts runs ingest and then the AI pipeline; this one only
 * refreshes articles, with no AI spend.
 */

import '../../lib/config/env';
import { completeCronJob, failCronJob, startCronJob } from '../../lib/cron/jobTracker';
import { runNewsIngest } from '../../lib/news/ingest';

async function main() {
  const runId = await startCronJob('news-scrape');
  try {
    const result = await runNewsIngest({ includeLocalOnly: true });
    await completeCronJob(runId, { ...result });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await failCronJob(runId, error);
    throw error;
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
