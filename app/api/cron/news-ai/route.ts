import { NextResponse } from 'next/server';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { formatDuration } from '@/lib/utils/cron';
import { runNewsAi } from '@/lib/news/pipeline';

export const maxDuration = 800;

/** No model call starts after this, leaving time for the last writes and the run record. */
const RUN_BUDGET_MS = 660_000;

// News AI cron (docs/news/05-v1-plan.md §6.2)
//
// Enriches new articles, embeds and clusters them into stories, recomputes
// changed stories, then Top and the daily summaries. Ingest is
// /api/cron/news-scrape. scripts/news/run-local.ts runs the same pipeline
// locally; the cron_job_runs record keeps the two from overlapping.
//
// Schedule: every 3 hours at :55 (cron: "55 */3 * * *")
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    console.warn('[NewsAI] Auth failed: invalid or missing CRON_SECRET');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const jobStartTime = Date.now();
  let runId: string | null = null;
  try {
    runId = await startCronJob('news-ai');
  } catch (trackerErr) {
    console.error(
      '[NewsAI] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
  }

  try {
    const result = await runNewsAi({ deadline: jobStartTime + RUN_BUDGET_MS, runId });
    const totalDuration = Date.now() - jobStartTime;
    console.log(`[NewsAI] JOB COMPLETE in ${formatDuration(totalDuration)}`);

    await completeCronJob(runId, { ...result });

    return NextResponse.json({ success: true, duration: totalDuration, stats: result });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error(
      `[NewsAI] JOB FAILED after ${formatDuration(totalDuration)}:`,
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    );

    await failCronJob(runId, error);

    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
