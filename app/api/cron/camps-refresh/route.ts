import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { env, isLocalScrapeRuntime } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { CAMPS_TAG } from '@/lib/db/queries/camps';
import { refreshCamps, type RefreshOutcome } from '@/lib/camps/refresh';

export const maxDuration = 800; // ~13 minutes max (Fluid Compute)

/**
 * Kept after the last provider for the import (placing new sites gets the first minute of it),
 * the feed-event sync and the run record.
 */
const FINISH_MS = 120_000;

/**
 * Summer camps refresh (lib/camps/refresh.ts): re-reads the pages of each provider that's due
 * (weekly; daily in January and within 3 days of a registration date), re-extracts with Sol only
 * the ones whose pages or prompt changed, imports those, and syncs the camps' feed events.
 *
 * Runs daily. Each provider's outcome is in the run's cron_job_runs.result.outcomes. Pages only a
 * browser can read fail here (no browser on Vercel) and keep their facts; the nightly local task
 * (scripts/run-local-events.ts -> scripts/camps/refresh.ts) refreshes them, and the WebTrac catalog.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startTime = Date.now();
  let runId: string | null = null;
  try {
    runId = await startCronJob('camps-refresh');
  } catch (trackerErr) {
    console.error(
      '[Camps refresh] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
  }

  // Outside the try so a failed run still records what it had done
  const outcomes: RefreshOutcome[] = [];

  try {
    const result = await refreshCamps({
      apply: true,
      endBy: startTime + maxDuration * 1000 - FINISH_MS,
      browser: isLocalScrapeRuntime(),
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    if (result.imported) revalidateTag(CAMPS_TAG, { expire: 0 });

    const record = { ...result, durationSeconds: Math.round((Date.now() - startTime) / 1000) };
    console.log(
      `[Camps refresh] ${result.checked} of ${result.due} due checked: ${result.unchanged} unchanged, ${result.reExtracted} re-extracted, ${result.deferred} deferred, ${result.failed} failed; ${result.notStarted} not started`
    );
    await completeCronJob(runId, record);
    return NextResponse.json({ success: true, ...record });
  } catch (error) {
    console.error('[Camps refresh] Failed:', error);
    // An import may have committed before the failure
    revalidateTag(CAMPS_TAG, { expire: 0 });
    await failCronJob(runId, error, { outcomes });
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
