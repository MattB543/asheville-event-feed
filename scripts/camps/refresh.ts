/**
 * Summer camps refresh, run locally: the same code as /api/cron/camps-refresh (lib/camps/refresh.ts),
 * with the headless browser rung Vercel lacks, so it can also check pages only a browser can read.
 *
 * Dry run by default: reads and hashes each due provider's pages and says which would be
 * re-extracted; calls no model and writes nothing. --apply re-extracts the changed providers with
 * Sol, imports them, records each check, syncs the camps' feed events, and saves each new extraction
 * to data/camps/extractions/<key>.json like scripts/camps/extract.ts.
 *
 * Usage:
 *   npx tsx scripts/camps/refresh.ts --dry-run --limit 5
 *   npx tsx scripts/camps/refresh.ts --only ymca-wnc,lutheridge   # due or not
 *   npx tsx scripts/camps/refresh.ts --no-browser                  # read pages as Vercel does
 *   npx tsx scripts/camps/refresh.ts --apply [--minutes 60]
 */
import '../../lib/config/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { refreshCamps, type RefreshOutcome } from '../../lib/camps/refresh';

const OUT_DIR = join(process.cwd(), 'data', 'camps', 'extractions');
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
  const limit = arg('--limit') ? Number(arg('--limit')) : undefined;
  const minutes = Number(arg('--minutes') ?? DEFAULT_MINUTES);

  console.log(`${apply ? 'APPLY' : 'DRY RUN (no model calls, no writes)'}`);
  const result = await refreshCamps({
    apply,
    endBy: Date.now() + minutes * 60_000,
    browser: !process.argv.includes('--no-browser'),
    limit,
    only: arg('--only')?.split(','),
    onOutcome: (o) =>
      console.log(
        `${MARK[o.outcome]} ${o.key}: ${o.outcome}${o.reason ? ` (${o.reason.slice(0, 300)})` : ''}` +
          `; ${o.pages} pages, ${(o.ms / 1000).toFixed(1)}s${o.hot ? ', due daily' : ''}` +
          (o.cards !== undefined ? `, ${o.cards} cards` : '')
      ),
    onExtracted: async (saved) => {
      await mkdir(OUT_DIR, { recursive: true });
      await writeFile(
        join(OUT_DIR, `${saved.provider.key}.json`),
        JSON.stringify(saved, null, 2) + '\n'
      );
    },
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
  if (result.imported)
    console.log(
      "Cache tag 'camps': scripts can't revalidate it, so /camps shows this within the hour."
    );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
