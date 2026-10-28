/**
 * Camps pilot, steps 1-2: extract each pilot provider with Sol + web_search, then verify every
 * quote against the cited page with our own fetcher.
 *
 * Resumable: an extraction already saved in data/camps/pilot/extractions/ is reused unless
 * --force; verification always re-runs (it is cheap and the pages may have changed).
 *
 * Usage:
 *   npx tsx scripts/camps/run-pilot.ts                       # every provider
 *   npx tsx scripts/camps/run-pilot.ts --only ymca-wnc,lutheridge
 *   npx tsx scripts/camps/run-pilot.ts --force               # re-extract (spends tokens)
 *   npx tsx scripts/camps/run-pilot.ts --verify-only         # never call the model
 *   npx tsx scripts/camps/run-pilot.ts --mode search         # web search only (default: bundle)
 *
 * Each mode writes to its own folders (extractions/<mode>/, verified/<mode>/) so they can be compared.
 */
import '../../lib/config/env';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractProvider,
  type ExtractionMode,
  type ExtractionRun,
  type ProviderInput,
} from '../../lib/camps/extract';
import { createPageTextFetcher } from '../../lib/camps/fetchPageText';
import type { Extraction } from '../../lib/camps/types';
import { verifyExtraction, type VerifyReport } from '../../lib/camps/verify';
import { getTodayStringEastern } from '../../lib/utils/timezone';

const PILOT_DIR = join(process.cwd(), 'data', 'camps', 'pilot');
const CONCURRENCY = 4;

export interface PilotProvider extends ProviderInput {
  webtrac?: boolean;
  covers: string[];
}

export interface SavedExtraction {
  provider: PilotProvider;
  extractedAt: string;
  run: ExtractionRun;
}

export interface SavedVerification {
  provider: PilotProvider;
  verifiedAt: string;
  verifyMs: number;
  extraction: Extraction;
  report: VerifyReport;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const force = process.argv.includes('--force');
  const verifyOnly = process.argv.includes('--verify-only');
  const only = arg('--only')?.split(',');
  const mode = (arg('--mode') ?? 'bundle') as ExtractionMode;
  const EXTRACTIONS = join(PILOT_DIR, 'extractions', mode);
  const VERIFIED = join(PILOT_DIR, 'verified', mode);

  const { providers } = JSON.parse(await readFile(join(PILOT_DIR, 'providers.json'), 'utf8')) as {
    providers: PilotProvider[];
  };
  const selected = only ? providers.filter((p) => only.includes(p.key)) : providers;
  await mkdir(EXTRACTIONS, { recursive: true });
  await mkdir(VERIFIED, { recursive: true });

  const today = getTodayStringEastern();
  const fetcher = createPageTextFetcher();
  let next = 0;

  async function worker() {
    while (next < selected.length) {
      const provider = selected[next++];
      const extractionPath = join(EXTRACTIONS, `${provider.key}.json`);
      try {
        let saved: SavedExtraction;
        if (existsSync(extractionPath) && !force) {
          saved = JSON.parse(await readFile(extractionPath, 'utf8')) as SavedExtraction;
        } else if (verifyOnly) {
          console.log(`- ${provider.key}: no extraction saved, skipped (--verify-only)`);
          continue;
        } else {
          console.log(`> ${provider.key}: extracting (${mode})...`);
          const run = await extractProvider(provider, today, { mode, fetcher });
          saved = { provider, extractedAt: new Date().toISOString(), run };
          await writeFile(extractionPath, JSON.stringify(saved, null, 2) + '\n');
        }

        // Verify a copy, so the saved extraction stays exactly what the model returned.
        const extraction = structuredClone(saved.run.extraction);
        const started = Date.now();
        const report = await verifyExtraction(extraction, { fetcher, seedUrls: provider.urls });
        const verification: SavedVerification = {
          provider,
          verifiedAt: new Date().toISOString(),
          verifyMs: Date.now() - started,
          extraction,
          report,
        };
        await writeFile(
          join(VERIFIED, `${provider.key}.json`),
          JSON.stringify(verification, null, 2) + '\n'
        );

        const { totals } = report;
        const usage = saved.run.response.usage;
        console.log(
          `✓ ${provider.key}: ${extraction.cards.length} cards, ${totals.total} facts ` +
            `(${totals.verified} verified, ${totals.review} review, ${totals.dropped} dropped); ` +
            `${Math.round(saved.run.response.ms / 1000)}s, ${usage.inputTokens} in / ${usage.outputTokens} out, ` +
            `${saved.run.response.searches.length} searches`
        );
      } catch (error) {
        console.error(
          `✗ ${provider.key}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await fetcher.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
