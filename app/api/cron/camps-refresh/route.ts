import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { env, isLocalScrapeRuntime } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { CAMPS_TAG } from '@/lib/db/queries/camps';
import { refreshCamps, type RefreshOutcome } from '@/lib/camps/refresh';
import { campsModelConfigured } from '@/lib/camps/responses';

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
 *
 * Matt keeps re-extraction on his PC (2026-11-19), and Vercel has no key for the camps model, so
 * here the run only reads and compares: unchanged providers are marked checked, changed ones are
 * 'deferred' and stay due for the local task. Before that it tried to re-extract them, failed each
 * with "AZURE_OPENAI_API_KEY is not set" and still reported success.
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
      extract: isLocalScrapeRuntime() && campsModelConfigured(),
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    // An unchanged check moves the pages' "last checked" too
    if (result.imported || result.unchanged > 0) revalidateTag(CAMPS_TAG, { expire: 0 });

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
