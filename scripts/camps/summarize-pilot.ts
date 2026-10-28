/**
 * Camps pilot: per-provider numbers for the report (cards, facts, verification outcomes, flags,
 * time and tokens), for one or both extraction modes.
 *
 * Usage:
 *   npx tsx scripts/camps/summarize-pilot.ts              # both modes -> data/camps/pilot/summary.json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceItems } from '../../lib/camps/verify';
import type { SavedExtraction, SavedVerification } from './run-pilot';

const PILOT_DIR = join(process.cwd(), 'data', 'camps', 'pilot');

interface ProviderSummary {
  key: string;
  cards: number;
  excluded: number;
  facts: number;
  verified: number;
  review: number;
  dropped: number;
  milestones: number;
  milestonesKept: number;
  year2027Facts: number;
  extractMs: number;
  verifyMs: number;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  bundlePages: number;
  flags: Record<string, number>;
  droppedExamples: string[];
}

function summarize(mode: string): ProviderSummary[] {
  const dir = join(PILOT_DIR, 'verified', mode);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const verification = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SavedVerification;
      const saved = JSON.parse(
        readFileSync(join(PILOT_DIR, 'extractions', mode, file), 'utf8')
      ) as SavedExtraction;
      const { extraction, report } = verification;
      const flags: Record<string, number> = {};
      const droppedExamples: string[] = [];
      let milestones = 0;
      let milestonesKept = 0;
      let year2027Facts = 0;

      for (const card of extraction.cards) {
        for (const { field, evidence } of evidenceItems(card)) {
          for (const flag of evidence.check?.flags ?? []) flags[flag] = (flags[flag] ?? 0) + 1;
          if (evidence.year === 2027 && evidence.check?.status !== 'dropped') year2027Facts++;
          if (field === 'registration_milestones') {
            milestones++;
            if (evidence.check?.status !== 'dropped') milestonesKept++;
          }
          if (evidence.check?.status === 'dropped' && droppedExamples.length < 4) {
            droppedExamples.push(
              `${field}: "${evidence.quote.slice(0, 90)}" <${evidence.url}> [${evidence.check.flags.join(',')}]`
            );
          }
        }
      }

      const usage = saved.run.response.usage;
      return {
        key: verification.provider.key,
        cards: extraction.cards.length,
        excluded: extraction.excluded.length,
        facts: report.totals.total,
        verified: report.totals.verified,
        review: report.totals.review,
        dropped: report.totals.dropped,
        milestones,
        milestonesKept,
        year2027Facts,
        extractMs: saved.run.response.ms,
        verifyMs: verification.verifyMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        searches: saved.run.response.searches.length,
        bundlePages: saved.run.bundle?.filter((page) => page.chars > 0).length ?? 0,
        flags,
        droppedExamples,
      };
    });
}

function totals(rows: ProviderSummary[]) {
  const sum = (pick: (row: ProviderSummary) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    providers: rows.length,
    cards: sum((row) => row.cards),
    facts: sum((row) => row.facts),
    verified: sum((row) => row.verified),
    review: sum((row) => row.review),
    dropped: sum((row) => row.dropped),
    milestones: sum((row) => row.milestones),
    milestonesKept: sum((row) => row.milestonesKept),
    year2027Facts: sum((row) => row.year2027Facts),
    inputTokens: sum((row) => row.inputTokens),
    outputTokens: sum((row) => row.outputTokens),
    searches: sum((row) => row.searches),
    extractSeconds: Math.round(sum((row) => row.extractMs) / 1000),
    verifySeconds: Math.round(sum((row) => row.verifyMs) / 1000),
  };
}

const result: Record<string, unknown> = {};
for (const mode of ['bundle', 'search']) {
  const rows = summarize(mode);
  if (rows.length === 0) continue;
  result[mode] = { totals: totals(rows), providers: rows };
  console.log(`\n=== ${mode}: ${JSON.stringify(totals(rows))}`);
  for (const row of rows) {
    console.log(
      `${row.key.padEnd(28)} cards ${String(row.cards).padStart(2)}  facts ${String(row.facts).padStart(3)}  ✓${String(row.verified).padStart(3)} ?${String(row.review).padStart(2)} ✗${String(row.dropped).padStart(2)}  ms ${row.milestonesKept}/${row.milestones}  2027:${row.year2027Facts}  ${Math.round(row.extractMs / 1000)}s ${row.inputTokens}/${row.outputTokens} tok ${row.searches} srch ${row.bundlePages} pg  ${Object.entries(
        row.flags
      )
        .map(([flag, count]) => `${flag}:${count}`)
        .join(' ')}`
    );
  }
}
writeFileSync(join(PILOT_DIR, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
