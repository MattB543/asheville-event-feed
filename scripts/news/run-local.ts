/**
 * The local news runner (docs/news/05-v1-plan.md §6.7): ingest with the
 * localOnly sources (Reddit, Buncombe County, Mountain Xpress ...), then the AI
 * pipeline, through the same functions the crons call. Both runs are recorded
 * in cron_job_runs ('news-scrape', 'news-ai'), which also keeps a local AI run
 * and the cron from overlapping.
 *
 * Usage:
 *   npx tsx scripts/news/run-local.ts            # ingest, then one AI run
 *   npx tsx scripts/news/run-local.ts --ai-only  # skip ingest
 *   npx tsx scripts/news/run-local.ts --loop     # repeat the AI run until the backlog is empty
 *
 * Each AI run has the cron's 660s budget. --loop starts another run while
 * articles still need enrichment, embedding or clustering, or stories are still
 * dirty, and stops early if a run makes no progress (an outage, or the lease is
 * held by another run).
 */

import '../../lib/config/env';
import { completeCronJob, failCronJob, startCronJob } from '../../lib/cron/jobTracker';
import { runNewsIngest } from '../../lib/news/ingest';
import { runNewsAi, type NewsAiResult } from '../../lib/news/pipeline';

const AI_RUN_MS = 660_000;
const MAX_LOOPS = 50;

async function ingest(): Promise<void> {
  const runId = await startCronJob('news-scrape');
  try {
    const result = await runNewsIngest({ includeLocalOnly: true });
    await completeCronJob(runId, { ...result });
    console.log(
      `[run-local] Ingest: ${result.inserted} new, ${result.updated} updated, ` +
        `${result.fulltext.fetched} bodies fetched, ${result.failures.scrapers} source failures`
    );
  } catch (error) {
    await failCronJob(runId, error);
    throw error;
  }
}

async function aiRun(): Promise<NewsAiResult> {
  const runId = await startCronJob('news-ai');
  try {
    const result = await runNewsAi({ deadline: Date.now() + AI_RUN_MS, runId });
    await completeCronJob(runId, { ...result });
    return result;
  } catch (error) {
    await failCronJob(runId, error);
    throw error;
  }
}

function progress(r: NewsAiResult): number {
  return (
    r.enriched +
    r.contentFiltered +
    r.aiFailed +
    r.embedded +
    r.clustered.attachedLlm +
    r.clustered.attachedLink +
    r.clustered.newStories +
    r.recomputed +
    r.daysSummarized +
    (r.skipped.byReason.too_old ?? 0)
  );
}

function backlogLeft(r: NewsAiResult): boolean {
  const b = r.backlog;
  return b.needsEnrich > 0 || b.unembedded > 0 || b.unclustered > 0 || b.dirty > 0;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const aiOnly = args.has('--ai-only');
  const loop = args.has('--loop');

  if (!aiOnly) await ingest();

  for (let i = 1; i <= (loop ? MAX_LOOPS : 1); i++) {
    const started = Date.now();
    const result = await aiRun();
    console.log(`[run-local] AI run ${i} took ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(JSON.stringify(result, null, 2));
    if (!loop || !backlogLeft(result)) break;
    if (result.skippedForLease || progress(result) === 0) {
      console.log('[run-local] No progress this run; stopping the loop.');
      break;
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
