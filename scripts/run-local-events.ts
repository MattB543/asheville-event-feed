/**
 * The nightly local events run (scripts/scheduled-local.ps1 -Job events): scrape
 * only the sources Vercel can't (the localOnly scrapers + Facebook, via
 * /api/cron/scrape?only=local), and rerun Facebook standalone when the in-scrape
 * pass comes up short. Everything else - the other scrapers, AI enrichment, the
 * dedup that follows - is left to the Vercel crons. The local-scrape-enrich
 * skill's top-100 duplicate review needs judgement and is not run here.
 *
 * Calls the route handler directly (it only uses NextResponse, and cache
 * invalidation is try/caught), so no dev server is needed. The run is recorded
 * in cron_job_runs as a 'scrape' run with result.onlyLocal = true.
 *
 * Then the summer camps refresh (scripts/camps/refresh.ts --apply --webtrac):
 * the camp pages only a browser can read, whatever the daily Vercel run left
 * due, and the weekly WebTrac catalog re-read. It gets what's left of the
 * task's hour and records its own 'camps-refresh' run (result.local = true). It
 * saves no files, so the checkout stays clean.
 *
 * Usage: npx tsx scripts/run-local-events.ts
 */

import { spawnSync } from 'child_process';
import * as path from 'path';
import { env } from '../lib/config/env';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { GET as scrapeCron } from '../app/api/cron/scrape/route';

// A healthy in-scrape Facebook pass keeps ~150-200; a stalled one keeps a dozen.
const FB_RERUN_BELOW = 100;
// scheduled-local.ps1 stops the task after an hour. The camps refresh gets the rest, less time
// for its import, feed sync and run record, and is skipped when that leaves too little.
const TASK_LIMIT_MINUTES = 60;
const CAMPS_FINISH_MINUTES = 8;
const CAMPS_MIN_MINUTES = 15;

type ScrapeStats = {
  inserted?: number;
  updated?: number;
  duplicatesRemoved?: number;
  insertedBySource?: Record<string, number>;
  scrapers?: { name: string; ok: boolean; events: number; error?: string }[];
};

async function main() {
  // Under `next dev` (the skill's path) a stray rejection inside one scraper is
  // logged and the scrape carries on; plain Node would kill the whole run.
  process.on('unhandledRejection', (reason) => {
    console.error('[run-local-events] Unhandled rejection (continuing):', reason);
  });

  if (!env.CRON_SECRET) throw new Error('CRON_SECRET not set in .env');
  // Same check as the skill's preflight: fail fast if schema.ts is ahead of the DB.
  await db.select().from(events).limit(1);

  const started = Date.now();
  const response = await scrapeCron(
    new Request('http://localhost/api/cron/scrape?only=local', {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    })
  );
  const body = (await response.json()) as {
    success?: boolean;
    error?: string;
    stats?: ScrapeStats;
  };
  if (!response.ok || !body.success || !body.stats) {
    throw new Error(`Scrape failed (HTTP ${response.status}): ${body.error ?? 'no error message'}`);
  }

  const stats = body.stats;
  const scrapers = stats.scrapers ?? [];
  console.log(
    `[run-local-events] Scrape took ${Math.round((Date.now() - started) / 1000)}s: ` +
      `${stats.inserted} new, ${stats.updated} updated, ${stats.duplicatesRemoved} dupes removed`
  );
  console.log(`[run-local-events] New by source: ${JSON.stringify(stats.insertedBySource ?? {})}`);
  for (const s of scrapers) {
    console.log(
      `[run-local-events]   ${s.name}: ${s.ok ? `${s.events} events` : `FAILED ${s.error}`}`
    );
  }

  const fb = scrapers.find((s) => s.name === 'Facebook');
  if (fb && fb.events < FB_RERUN_BELOW) {
    console.log(`[run-local-events] Facebook kept only ${fb.events}; rerunning it standalone`);
    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
    const rerun = spawnSync(process.execPath, [tsx, 'scripts/run-facebook-local.ts'], {
      stdio: 'inherit',
    });
    console.log(`[run-local-events] Standalone Facebook exited ${rerun.status}`);
  }

  const campsOk = runCampsRefresh(started);
  process.exit(scrapers.some((s) => !s.ok) || !campsOk ? 1 : 0);
}

/** False when the camps refresh failed; its own cron_job_runs row has the detail. */
function runCampsRefresh(taskStarted: number): boolean {
  const minutes = Math.floor(
    TASK_LIMIT_MINUTES - CAMPS_FINISH_MINUTES - (Date.now() - taskStarted) / 60_000
  );
  if (minutes < CAMPS_MIN_MINUTES) {
    console.log(`[run-local-events] Camps refresh skipped: only ${minutes} min left tonight`);
    return true;
  }
  console.log(`[run-local-events] Camps refresh, ${minutes} min`);
  const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
  const camps = spawnSync(
    process.execPath,
    [
      tsx,
      'scripts/camps/refresh.ts',
      '--apply',
      '--webtrac',
      '--no-save',
      '--minutes',
      String(minutes),
    ],
    { stdio: 'inherit' }
  );
  console.log(`[run-local-events] Camps refresh exited ${camps.status}`);
  return camps.status === 0;
}

main().catch((err) => {
  console.error('[run-local-events] FAILED:', err);
  process.exit(1);
});
