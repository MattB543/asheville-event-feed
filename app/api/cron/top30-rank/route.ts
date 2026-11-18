import { NextResponse } from 'next/server';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { isAzureAIEnabled } from '@/lib/ai/provider-clients';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { RANKED_CATEGORIES, rankTop30Category, saveTop30Ranking } from '@/lib/top30/headToHead';

export const maxDuration = 600; // Each list: up to two AI attempts of 180s

// The daily head-to-head pass for the Top 30 "Meet people" and "Asheville weird" lists
// (lib/top30/headToHead.ts). A list that fails keeps the order it had.
//
// Schedule: daily at 08:45 UTC (cron: "45 8 * * *"), after the AI dedup at 08:00
export async function GET(request: Request) {
  if (!verifyAuthToken(request.headers.get('authorization'), env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!isAzureAIEnabled()) {
    return NextResponse.json({ success: true, skipped: true, reason: 'Azure AI not configured' });
  }

  let runId: string | null = null;
  try {
    runId = await startCronJob('top30-rank');
  } catch (trackerErr) {
    console.error('[Top30Rank] Failed to start cron job tracker:', trackerErr);
  }

  const result: Record<string, unknown> = {};
  const errors: string[] = [];
  await Promise.all(
    RANKED_CATEGORIES.map(async (category) => {
      try {
        const ranking = await rankTop30Category(category);
        const saved = await saveTop30Ranking(ranking);
        result[category] = {
          candidates: ranking.candidates,
          ranked: ranking.ranked.length,
          savedRows: saved,
          new: ranking.ranked.filter((entry) => entry.previousRank === null).length,
          top10: ranking.ranked.slice(0, 10).map((entry) => entry.title),
        };
      } catch (error) {
        console.error(`[Top30Rank] ${category} failed:`, error);
        errors.push(`${category}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );
  if (errors.length < RANKED_CATEGORIES.length) invalidateEventsCache();

  if (errors.length > 0) {
    await failCronJob(runId, new Error(errors.join('; ')), result);
    return NextResponse.json({ success: false, errors, ...result }, { status: 500 });
  }
  await completeCronJob(runId, result);
  return NextResponse.json({ success: true, ...result });
}
