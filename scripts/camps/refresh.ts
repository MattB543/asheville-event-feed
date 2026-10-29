/**
 * Summer camps refresh, run locally: the same code as /api/cron/camps-refresh (lib/camps/refresh.ts),
 * with the headless browser rung Vercel lacks, so it can also check pages only a browser can read,
 * and (--webtrac) the weekly re-read of the WebTrac catalog. The nightly local task runs it from
 * scripts/run-local-events.ts.
 *
 * Dry run by default: reads and hashes each due provider's pages and says which would be
 * re-extracted; calls no model and writes nothing. --apply re-extracts the changed providers with
 * Sol, imports them, records each check, syncs the camps' feed events, records the run in
 * cron_job_runs (job 'camps-refresh', result.local = true), and saves each new extraction to
 * data/camps/extractions/<key>.json like scripts/camps/extract.ts (and a re-read catalog to
 * data/camps/pilot/webtrac.json) unless --no-save.
 *
 * Usage:
 *   npx tsx scripts/camps/refresh.ts --dry-run --limit 5
 *   npx tsx scripts/camps/refresh.ts --only ymca-wnc,lutheridge   # due or not
 *   npx tsx scripts/camps/refresh.ts --no-browser                  # read pages as Vercel does
 *   npx tsx scripts/camps/refresh.ts --apply [--minutes 60] [--webtrac] [--no-save]
 */
import '../../lib/config/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeCronJob, failCronJob, startCronJob } from '../../lib/cron/jobTracker';
import { refreshCamps, type RefreshOutcome } from '../../lib/camps/refresh';

const CAMPS_DIR = join(process.cwd(), 'data', 'camps');
const OUT_DIR = join(CAMPS_DIR, 'extractions');
// Read by scripts/camps/extract.ts, which rebuilds the WebTrac cards from it
const WEBTRAC_CACHE = join(CAMPS_DIR, 'pilot', 'webtrac.json');
const DEFAULT_MINUTES = 60;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const MARK: Record<RefreshOutcome['outcome'], string> = {
  unchanged: '=',
  changed: '~',
  're-extracted': '✓',
  deferred: '…',
  failed: '✗',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const save = apply && !process.argv.includes('--no-save');
  const limit = arg('--limit') ? Number(arg('--limit')) : undefined;
  const minutes = Number(arg('--minutes') ?? DEFAULT_MINUTES);

  console.log(`${apply ? 'APPLY' : 'DRY RUN (no model calls, no writes)'}`);
  const started = Date.now();
  let runId: string | null = null;
  if (apply) {
    runId = await startCronJob('camps-refresh').catch((error) => {
      console.error(`Failed to start the cron job tracker: ${String(error)}`);
      return null;
    });
  }

  const outcomes: RefreshOutcome[] = [];
  try {
    const result = await refreshCamps({
      apply,
      endBy: started + minutes * 60_000,
      browser: !process.argv.includes('--no-browser'),
      limit,
      only: arg('--only')?.split(','),
      webtrac: process.argv.includes('--webtrac'),
      onOutcome: (o) => {
        outcomes.push(o);
        console.log(
          `${MARK[o.outcome]} ${o.key}: ${o.outcome}${o.reason ? ` (${o.reason.slice(0, 300)})` : ''}` +
            `; ${o.pages} pages, ${(o.ms / 1000).toFixed(1)}s${o.hot ? ', due daily' : ''}` +
            (o.cards !== undefined ? `, ${o.cards} cards` : '')
        );
      },
      ...(save && {
        onExtracted: async (saved) => {
          await mkdir(OUT_DIR, { recursive: true });
          await writeFile(
            join(OUT_DIR, `${saved.provider.key}.json`),
            JSON.stringify(saved, null, 2) + '\n'
          );
        },
        onWebTracCatalog: async (catalog) => {
          await writeFile(WEBTRAC_CACHE, JSON.stringify(catalog, null, 2) + '\n');
        },
      }),
    });

    console.log(
      `\n${result.eligible} providers refreshable, ${result.due} due; checked ${result.checked}: ` +
        `${result.unchanged} unchanged, ${apply ? `${result.reExtracted} re-extracted` : `${result.changed} changed`}, ` +
        `${result.deferred} deferred, ${result.failed} failed; ${result.notStarted} not started`
    );
    if (result.feedEvents) {
      const { created, updated, removed } = result.feedEvents;
      console.log(`Feed events: ${created} created, ${updated} updated, ${removed} hidden`);
    }
    if (apply && (result.imported || result.unchanged > 0))
      console.log(
        "Cache tag 'camps': scripts can't revalidate it, so /camps shows this within the hour."
      );
    await completeCronJob(runId, {
      ...result,
      local: true,
      durationSeconds: Math.round((Date.now() - started) / 1000),
    });
  } catch (error) {
    await failCronJob(runId, error, { outcomes, local: true });
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
