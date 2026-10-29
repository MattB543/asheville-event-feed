/**
 * Camps extraction v2 (docs/camps/04-v2-plan.md §3): one file per provider in
 * data/camps/extractions/<key>.json. Sol + web search over a bundle of the provider's own pages, or
 * for WebTrac providers the deterministic catalog parser.
 *
 * Resumable: a provider whose saved file was made with the current prompt and schema
 * (`EXTRACTION_FINGERPRINT`) is skipped unless --force, so a changed prompt or schema re-extracts
 * instead of silently reusing an old file. WebTrac cards are rebuilt every run from the cached
 * catalog (no model call; refresh the cache with scripts/camps/read-webtrac.ts).
 *
 * Re-extraction hands Sol the program names in the provider's previous file, so its camp keys
 * don't drift between runs.
 *
 * Usage:
 *   npx tsx scripts/camps/extract.ts                                    # data/camps/providers.json
 *   npx tsx scripts/camps/extract.ts --providers data/camps/pilot/providers.json
 *   npx tsx scripts/camps/extract.ts --only ymca-wnc,lutheridge --force   # spends tokens
 */
import '../../lib/config/env';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CampCard, Provider } from '../../lib/camps/contract';
import {
  EXTRACTION_FINGERPRINT,
  extractProvider,
  type SavedExtraction,
} from '../../lib/camps/extract';
import { createPageTextFetcher } from '../../lib/camps/fetchPageText';
import { webTracExtraction, type WebTracCatalog } from '../../lib/camps/webtrac';
import { getTodayStringEastern } from '../../lib/utils/timezone';

const CAMPS_DIR = join(process.cwd(), 'data', 'camps');
const OUT_DIR = join(CAMPS_DIR, 'extractions');
const PILOT_PROVIDERS = join(CAMPS_DIR, 'pilot', 'providers.json');
// Written by scripts/camps/read-webtrac.ts.
const WEBTRAC_CACHE = join(CAMPS_DIR, 'pilot', 'webtrac.json');
const CONCURRENCY = 6;

/** A providers.json entry: a discovery `Provider`, or a pilot row without the discovery fields. */
type ProviderEntry = Omit<Provider, 'area' | 'discovered_by' | 'status'> &
  Partial<Pick<Provider, 'area' | 'discovered_by' | 'status'>>;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function loadProviders(path: string): Promise<Provider[]> {
  const json = JSON.parse(await readFile(path, 'utf8')) as
    | ProviderEntry[]
    | { providers: ProviderEntry[] };
  const entries = Array.isArray(json) ? json : json.providers;
  return entries.map((entry) => ({
    key: entry.key,
    name: entry.name,
    urls: entry.urls,
    area: entry.area ?? null,
    ...(entry.hint && { hint: entry.hint }),
    ...(entry.webtrac && { webtrac: true }),
    discovered_by: entry.discovered_by ?? ['pilot'],
    status: entry.status ?? 'ok',
    ...(entry.status_reason && { status_reason: entry.status_reason }),
  }));
}

async function readSaved(path: string): Promise<SavedExtraction | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8')) as SavedExtraction;
}

function confidenceMix(cards: CampCard[]): string {
  const count = (level: string) => cards.filter((card) => card.confidence === level).length;
  return `${count('high')} high / ${count('medium')} medium / ${count('low')} low`;
}

async function main() {
  const force = process.argv.includes('--force');
  const only = arg('--only')?.split(',');
  let providersPath = arg('--providers') ?? join(CAMPS_DIR, 'providers.json');
  if (!arg('--providers') && !existsSync(providersPath)) {
    console.log(`No ${providersPath} yet; using the pilot providers.`);
    providersPath = PILOT_PROVIDERS;
  }

  const providers = await loadProviders(providersPath);
  const selected = only ? providers.filter((provider) => only.includes(provider.key)) : providers;
  await mkdir(OUT_DIR, { recursive: true });

  const today = getTodayStringEastern();
  const fetcher = createPageTextFetcher();
  let catalog: WebTracCatalog | null = null;
  const started = Date.now();
  const failed: string[] = [];
  const done: SavedExtraction[] = [];
  let skipped = 0;
  let next = 0;

  async function worker() {
    while (next < selected.length) {
      const provider = selected[next++];
      const path = join(OUT_DIR, `${provider.key}.json`);
      try {
        const previous = await readSaved(path);
        let saved: SavedExtraction;
        if (provider.webtrac) {
          const webtrac = (catalog ??= JSON.parse(
            await readFile(WEBTRAC_CACHE, 'utf8')
          ) as WebTracCatalog);
          saved = {
            provider,
            extractedAt: new Date().toISOString(),
            fingerprint: `webtrac:${webtrac.readAt}`,
            sourceHash: createHash('sha256').update(JSON.stringify(webtrac.rows)).digest('hex'),
            response: null,
            bundle: null,
            extraction: webTracExtraction(webtrac, provider),
          };
        } else if (!force && previous?.fingerprint === EXTRACTION_FINGERPRINT) {
          skipped++;
          continue;
        } else {
          console.log(`> ${provider.key}: extracting...`);
          const run = await extractProvider(provider, today, {
            fetcher,
            existingPrograms: previous?.extraction.cards.map((card) => card.name) ?? [],
          });
          saved = {
            provider,
            extractedAt: new Date().toISOString(),
            fingerprint: EXTRACTION_FINGERPRINT,
            sourceHash: run.sourceHash,
            response: run.response,
            bundle: run.bundle,
            extraction: run.extraction,
          };
        }
        await writeFile(path, JSON.stringify(saved, null, 2) + '\n');
        done.push(saved);

        const { cards } = saved.extraction;
        const rows = cards.reduce((sum, card) => sum + card.sessions.length, 0);
        const dates = cards.reduce((sum, card) => sum + card.registration.length, 0);
        const response = saved.response;
        console.log(
          `✓ ${provider.key}: ${cards.length} cards (${confidenceMix(cards)}), ${rows} rows, ${dates} registration dates` +
            (response
              ? `; ${Math.round(response.ms / 1000)}s, ${response.usage.inputTokens} in / ${response.usage.outputTokens} out, ${response.searches.length} searches`
              : '; WebTrac catalog')
        );
      } catch (error) {
        failed.push(provider.key);
        console.error(
          `✗ ${provider.key}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await fetcher.close();

  const cards = done.flatMap((saved) => saved.extraction.cards);
  const responses = done.flatMap((saved) => (saved.response ? [saved.response] : []));
  const sum = (pick: (response: (typeof responses)[number]) => number) =>
    responses.reduce((total, response) => total + pick(response), 0);
  console.log(
    `\n${done.length} extracted, ${skipped} skipped (current fingerprint), ${failed.length} failed; ` +
      `${cards.length} cards (${confidenceMix(cards)}); ` +
      `${sum((r) => r.usage.inputTokens)} in / ${sum((r) => r.usage.outputTokens)} out tokens, ` +
      `${sum((r) => r.searches.length)} searches, ${Math.round(sum((r) => r.ms) / 1000)}s model time, ` +
      `${Math.round((Date.now() - started) / 1000)}s wall`
  );
  // Their previous files (if any) are still on disk: say so, and fail the run.
  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(', ')} (previous files kept)`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
