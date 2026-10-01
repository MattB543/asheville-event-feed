import { NextResponse } from 'next/server';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { formatDuration } from '@/lib/utils/cron';
import { acquireNewsAiLease, runNewsAi } from '@/lib/news/pipeline';

export const maxDuration = 800;

/** No model call starts after this, leaving time for the last writes and the run record. */
const RUN_BUDGET_MS = 660_000;

// News AI cron (docs/news/05-v1-plan.md §6.2)
//
// Enriches new articles, embeds and clusters them into stories, recomputes
// changed stories, then Top and the daily summaries. Ingest is
// /api/cron/news-scrape. scripts/news/run-local.ts runs the same pipeline
// locally; the lease (this run's cron_job_runs row) keeps the two from
// overlapping.
//
// Schedule: every 3 hours at :55 (cron: "55 */3 * * *")
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    console.warn('[NewsAI] Auth failed: invalid or missing CRON_SECRET');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const jobStartTime = Date.now();
  let runId: string | null;
  try {
    runId = await acquireNewsAiLease();
  } catch (error) {
    // No row means no lease: running anyway could overlap another run.
    console.error(
      '[NewsAI] Could not take the lease; not running:',
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
  if (!runId) {
    console.warn('[NewsAI] Another news-ai run holds the lease; skipping');
    return NextResponse.json({ success: true, skipped: 'another news-ai run holds the lease' });
  }

  try {
    const result = await runNewsAi({ deadline: jobStartTime + RUN_BUDGET_MS });
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
