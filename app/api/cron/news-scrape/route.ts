import { NextResponse } from 'next/server';
import { env, isLocalScrapeRuntime } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { formatDuration } from '@/lib/utils/cron';
import { runNewsIngest } from '@/lib/news/ingest';

export const maxDuration = 300;

/** Everything (scrape, upsert, full text) stops by here, leaving time to record the run. */
const RUN_BUDGET_MS = 270_000;

// News ingest cron (docs/news/05-v1-plan.md §6.1)
//
// Scrapes every news source into news_articles and fetches full text for new
// articles. AI enrichment, clustering and summaries are /api/cron/news-ai.
// localOnly sources (Mountain Xpress, Buncombe County) are skipped on Vercel and
// refreshed by scripts/news/run-local.ts.
//
// Schedule: every 3 hours at :40 (cron: "40 */3 * * *")
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    console.warn('[NewsScrape] Auth failed: invalid or missing CRON_SECRET');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const jobStartTime = Date.now();
  let runId: string | null = null;
  try {
    runId = await startCronJob('news-scrape');
  } catch (trackerErr) {
    console.error(
      '[NewsScrape] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
  }

  try {
    const result = await runNewsIngest({
      includeLocalOnly: isLocalScrapeRuntime(),
      deadline: jobStartTime + RUN_BUDGET_MS,
    });
    const totalDuration = Date.now() - jobStartTime;
    console.log(`[NewsScrape] JOB COMPLETE in ${formatDuration(totalDuration)}`);

    await completeCronJob(runId, { ...result });

    return NextResponse.json({ success: true, duration: totalDuration, stats: result });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error(
      `[NewsScrape] JOB FAILED after ${formatDuration(totalDuration)}:`,
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    );

    await failCronJob(runId, error);

    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
