/**
 * Group discovery, step 3: merge the per-bucket agent results back onto the units.
 *
 * Reads:  data/groups/units.json, data/groups/results/bucket-*.json, data/groups/evidence/*.json (optional)
 * Writes: data/groups/classified.json  every unit with its verdict (and evidence when present)
 *         data/groups/grey.json        distinct grey group names with their units - input for the evidence pass
 *
 * Fails loudly if any unit is missing a verdict, classified twice, or has an invalid verdict/kind combination,
 * so a bad bucket can be re-run on its own before anything downstream reads it.
 *
 * Run: npx tsx scripts/groups/merge-results.ts
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Unit } from './build-buckets';

const DIR = join(process.cwd(), 'data', 'groups');

const GROUP_KINDS = new Set([
  'club',
  'support_or_recovery',
  'spiritual_community',
  'social_group',
  'civic_or_advocacy',
  'arts_collective',
]);
const NON_GROUP_KINDS = new Set([
  'hosted_series',
  'performance',
  'class_or_workshop',
  'institution_program',
  'exhibition_or_attraction',
  'market_or_festival',
  'promo_or_special',
  'business_service',
  'other',
]);
const VERDICTS = new Set(['group', 'grey', 'not_group']);

export interface Verdict {
  index: number;
  verdict: 'group' | 'grey' | 'not_group';
  kind: string;
  group_name: string | null;
  name_source: 'title' | 'organizer' | 'description' | 'inferred' | null;
  other_groups: string[];
  reason: string;
}

/** Written by the Sonnet evidence agents, one file per grey group (see grey.json). */
export interface Evidence {
  group_name: string;
  /** The group's real name when the web turned up something different from the classifier's label. */
  canonical_name: string | null;
  unit_indices: number[];
  verdict: 'group' | 'not_group' | 'still_unsure';
  confidence: number;
  website: string | null;
  summary: string;
  evidence: Array<{ source: 'web' | 'events'; url: string | null; note: string }>;
}

export type ClassifiedUnit = Unit & Verdict & { evidence?: Evidence };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function main() {
  const { units } = JSON.parse(readFileSync(join(DIR, 'units.json'), 'utf8')) as { units: Unit[] };
  const resultsDir = join(DIR, 'results');
  const files = readdirSync(resultsDir)
    .filter((f) => /^bucket-\d+\.json$/.test(f))
    .sort();

  const verdicts = new Map<number, Verdict>();
  const problems: string[] = [];
  for (const file of files) {
    const { rows } = JSON.parse(readFileSync(join(resultsDir, file), 'utf8')) as {
      rows: Verdict[];
    };
    for (const r of rows) {
      const where = `${file} index ${r.index}`;
      if (verdicts.has(r.index)) problems.push(`${where}: classified twice`);
      if (!VERDICTS.has(r.verdict)) problems.push(`${where}: bad verdict "${r.verdict}"`);
      const isGroupKind = GROUP_KINDS.has(r.kind);
      const isNonGroupKind = NON_GROUP_KINDS.has(r.kind);
      if (!isGroupKind && !isNonGroupKind) problems.push(`${where}: bad kind "${r.kind}"`);
      if (r.verdict === 'group' && !isGroupKind)
        problems.push(`${where}: group verdict with non-group kind "${r.kind}"`);
      if (r.verdict === 'not_group' && !isNonGroupKind)
        problems.push(`${where}: not_group verdict with group kind "${r.kind}"`);
      if (r.verdict !== 'not_group' && !r.group_name)
        problems.push(`${where}: ${r.verdict} without group_name`);
      if (r.verdict === 'not_group' && r.group_name)
        problems.push(`${where}: not_group with group_name "${r.group_name}"`);
      verdicts.set(r.index, { ...r, other_groups: r.other_groups ?? [] });
    }
  }
  const missing = units.filter((u) => !verdicts.has(u.index)).map((u) => u.index);
  if (missing.length)
    problems.push(
      `${missing.length} units have no verdict: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '...' : ''}`
    );
  const unknown = [...verdicts.keys()].filter((i) => i < 0 || i >= units.length);
  if (unknown.length) problems.push(`verdicts for unknown indices: ${unknown.join(', ')}`);

  if (problems.length) {
    console.error(`${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // Optional evidence from the Sonnet pass, keyed by unit index.
  const evidenceDir = join(DIR, 'evidence');
  const evidenceByIndex = new Map<number, Evidence>();
  let evidenceFiles = 0;
  if (existsSync(evidenceDir)) {
    for (const f of readdirSync(evidenceDir).filter((f) => f.endsWith('.json'))) {
      const ev = JSON.parse(readFileSync(join(evidenceDir, f), 'utf8')) as Evidence;
      evidenceFiles++;
      for (const i of ev.unit_indices) evidenceByIndex.set(i, ev);
    }
  }

  const classified: ClassifiedUnit[] = units.map((u) => {
    const v = verdicts.get(u.index)!;
    const ev = evidenceByIndex.get(u.index);
    return ev ? { ...u, ...v, evidence: ev } : { ...u, ...v };
  });

  // Grey groups, one entry per distinct name, for the evidence pass.
  const greyByName = new Map<string, ClassifiedUnit[]>();
  for (const c of classified) {
    if (c.verdict !== 'grey') continue;
    const key = c.group_name!.trim().toLowerCase();
    const list = greyByName.get(key);
    if (list) list.push(c);
    else greyByName.set(key, [c]);
  }
  const grey = [...greyByName.values()]
    .map((list) => ({
      group_name: list[0].group_name!,
      slug: slugify(list[0].group_name!),
      unit_indices: list.map((c) => c.index),
      kinds: [...new Set(list.map((c) => c.kind))],
      events: list.reduce((n, c) => n + c.count, 0),
      has_evidence: list.some((c) => c.evidence),
    }))
    .sort((a, b) => b.events - a.events);

  const now = new Date().toISOString();
  writeFileSync(
    join(DIR, 'classified.json'),
    JSON.stringify({ generated_at: now, units: classified }, null, 2)
  );
  writeFileSync(
    join(DIR, 'grey.json'),
    JSON.stringify({ generated_at: now, groups: grey }, null, 2)
  );

  const byVerdict: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const c of classified) {
    byVerdict[c.verdict] = (byVerdict[c.verdict] ?? 0) + 1;
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  }
  const groupNames = new Set(
    classified.filter((c) => c.verdict === 'group').map((c) => c.group_name!.trim().toLowerCase())
  );

  console.log(`Units classified:   ${classified.length} across ${files.length} bucket files`);
  console.log(`By verdict:         ${JSON.stringify(byVerdict)}`);
  console.log(`By kind:            ${JSON.stringify(byKind)}`);
  console.log(`Distinct names:     ${groupNames.size} group, ${grey.length} grey`);
  console.log(`Evidence files:     ${evidenceFiles} (covering ${evidenceByIndex.size} units)`);
  console.log(`Wrote:              classified.json, grey.json`);
}

main();
