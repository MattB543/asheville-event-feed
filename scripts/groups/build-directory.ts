/**
 * Group directory, step 9: build the final directory from the research pass. Pure - no DB.
 *
 * Reads:  data/groups/research/input/batch-NN.json     the records the research agents were given
 *         data/groups/research/results/batch-NN.json   one verdict + listing per record
 *         data/groups/research/links/results + links/fill/results   website, format, networking
 *         data/groups/directory-overrides.json         final human calls on top of the research
 *         data/groups/candidates.json                  unit indices + Meetup link for every c: record
 *         data/groups/units.json                       (title, organizer) of every unit
 * Writes: data/groups/directory.json                   one entry per group, seeded into the DB by
 *                                                      scripts/groups/seed-groups.ts
 *
 * Rules:
 *   - Verdict: the research `verdict`; then the links pass removes `remote_only` groups and settles
 *     business-networking groups (`networking: keep | cut`); then overrides `reject` / `keep` win.
 *   - Website: the links pass's answer when it checked the record (the fill-in pass beats the first
 *     pass), else research's.
 *   - Merges: override `merge` edges (source -> main) plus research `duplicate_of` edges, except research
 *     edges that touch a key mentioned in override `merge` (either side) or listed in `not_duplicates`.
 *     Each key resolves to its root; a merged source contributes its match keys only (its listing text is
 *     dropped). Fails on cycles, unknown targets, or a rejected root with kept members.
 *   - Match keys (lib/groups/matchKeys.ts): a candidate gets seriesKey(title, organizer) for each of its
 *     units, plus meetupKey(meetup_urlname) when it has one; a Meetup record gets meetupKey(urlname).
 *   - Slug: the candidate slug for c: keys, cleanTitle(name) for m: keys, `edits[key].slug` wins;
 *     collisions get -2, -3.
 *   - `directory_key` is the root's research key - the group's stable identity across rebuilds.
 *   - `edits[key]` field overrides are applied last.
 * Exits non-zero on any validation failure, without writing.
 *
 * Run: npx tsx scripts/groups/build-directory.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_CATEGORIES, isGroupCategory } from '../../lib/groups/categories';
import { meetupKey, seriesKey } from '../../lib/groups/matchKeys';
import { cleanTitle } from '../../lib/utils/slugify';

const DIR = join(process.cwd(), 'data', 'groups');
const RESEARCH = join(DIR, 'research');
const MAX_DESCRIPTION = 240;

interface InputRecord {
  key: string;
  type: 'candidate' | 'meetup';
  name: string;
  meetup_url: string | null;
}

interface ResearchResult {
  key: string;
  verdict: 'keep' | 'reject';
  reject_reason: string | null;
  duplicate_of: string | null;
  name: string;
  description: string | null;
  category: string;
  website: string | null;
  schedule: string | null;
  home_base: string | null;
}

interface LinkResult {
  key: string;
  website: string | null;
  format: 'in_person' | 'hybrid' | 'remote_only' | 'unclear';
  networking: 'keep' | 'cut' | null;
}

interface Candidate {
  slug: string;
  unit_indices: number[];
  meetup_urlname: string | null;
}

interface Unit {
  index: number;
  title: string;
  organizer: string | null;
}

const EDITABLE = [
  'slug',
  'name',
  'description',
  'category',
  'website',
  'meetup_url',
  'schedule',
  'home_base',
] as const;
type Editable = (typeof EDITABLE)[number];

interface Overrides {
  reject: Record<string, string>;
  keep: Record<string, string>;
  merge: Record<string, string>;
  not_duplicates: Record<string, string>;
  edits: Record<string, Partial<Record<Editable, string | null>>>;
}

export interface DirectoryGroup {
  directory_key: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  website: string | null;
  meetup_url: string | null;
  schedule: string | null;
  home_base: string | null;
  match_keys: string[];
  merged_from: string[];
}

export interface Directory {
  generated_at: string;
  count: number;
  groups: DirectoryGroup[];
}

/** Entries of an overrides section, minus "_comment"-style keys. */
function entries<T>(section: Record<string, T> | undefined): [string, T][] {
  return Object.entries(section ?? {}).filter(([k]) => !k.startsWith('_'));
}

function text(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function readBatches<T>(dir: string, field: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^batch-\d+\.json$/.test(f))
    .sort()
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, T[]>)[field]);
}

function main() {
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);
  const bail = () => {
    if (!problems.length) return;
    console.error(`${problems.length} problem(s); directory.json not written:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  };

  // --- Load.
  const inputs = readBatches<InputRecord>(join(RESEARCH, 'input'), 'records');
  const results = readBatches<ResearchResult>(join(RESEARCH, 'results'), 'results');
  const overrides = JSON.parse(
    readFileSync(join(DIR, 'directory-overrides.json'), 'utf8')
  ) as Overrides;
  const candidates = new Map(
    (
      JSON.parse(readFileSync(join(DIR, 'candidates.json'), 'utf8')) as { candidates: Candidate[] }
    ).candidates.map((c) => [c.slug, c])
  );
  const units = new Map(
    (JSON.parse(readFileSync(join(DIR, 'units.json'), 'utf8')) as { units: Unit[] }).units.map(
      (u) => [u.index, u]
    )
  );

  // --- Every input record has exactly one result, and vice versa.
  const input = new Map<string, InputRecord>();
  for (const r of inputs) {
    if (input.has(r.key)) fail(`input: duplicate key ${r.key}`);
    input.set(r.key, r);
  }
  const research = new Map<string, ResearchResult>();
  for (const r of results) {
    if (research.has(r.key)) fail(`results: duplicate key ${r.key}`);
    if (!input.has(r.key)) fail(`results: ${r.key} is not an input record`);
    if (r.verdict !== 'keep' && r.verdict !== 'reject')
      fail(`results: ${r.key} has verdict "${r.verdict}"`);
    research.set(r.key, r);
  }
  for (const key of input.keys()) if (!research.has(key)) fail(`results: no result for ${key}`);

  // --- Overrides only name real records.
  const known = (section: string, key: string) => {
    if (!research.has(key)) fail(`overrides.${section}: unknown key ${key}`);
  };
  for (const [k] of entries(overrides.reject)) known('reject', k);
  for (const [k] of entries(overrides.keep)) known('keep', k);
  for (const [k] of entries(overrides.not_duplicates)) known('not_duplicates', k);
  for (const [k, v] of entries(overrides.edits)) {
    known('edits', k);
    for (const field of Object.keys(v))
      if (!(EDITABLE as readonly string[]).includes(field))
        fail(`overrides.edits: ${k} edits unknown field "${field}"`);
  }
  for (const [s, t] of entries(overrides.merge)) {
    known('merge', s);
    known('merge', t);
  }
  for (const [k] of entries(overrides.reject))
    if (k in (overrides.keep ?? {})) fail(`overrides: ${k} is in both reject and keep`);
  bail();

  // --- Links pass, in precedence order: each later pass redid records the one before it could not
  // search (fill: the first pass hit the session's WebSearch cap; fill2: fill's search helper was
  // throttled), so the latest result for a key wins.
  const links = new Map<string, LinkResult>();
  for (const dir of [
    join(RESEARCH, 'links', 'results'),
    join(RESEARCH, 'links', 'fill', 'results'),
    join(RESEARCH, 'links', 'fill2', 'results'),
  ])
    for (const l of readBatches<LinkResult>(dir, 'results')) links.set(l.key, l);
  for (const [key, l] of links) {
    if (!research.has(key)) fail(`links: unknown key ${key}`);
    if (!['in_person', 'hybrid', 'remote_only', 'unclear'].includes(l.format))
      fail(`links: ${key} has format "${l.format}"`);
    if (l.website && !/^https?:\/\//.test(l.website)) fail(`links: ${key} website "${l.website}"`);
  }
  bail();

  // --- Verdicts: research, then the links pass, then overrides.
  const kept = new Map<string, boolean>();
  for (const [key, r] of research) kept.set(key, r.verdict === 'keep');
  const linkRemovals: string[] = [];
  const networkingKeeps: string[] = [];
  for (const [key, l] of links) {
    if (l.format === 'remote_only' || l.networking === 'cut') {
      if (kept.get(key))
        linkRemovals.push(
          `${key} (${l.format === 'remote_only' ? 'remote only' : 'networking cut'})`
        );
      kept.set(key, false);
    } else if (l.networking === 'keep') {
      if (!kept.get(key)) networkingKeeps.push(key);
      kept.set(key, true);
    }
  }
  for (const [k] of entries(overrides.reject)) kept.set(k, false);
  for (const [k] of entries(overrides.keep)) kept.set(k, true);

  // --- Merge edges: overrides first, then research edges that don't touch an override or not_duplicates key.
  const edges = new Map<string, { target: string; from: 'override' | 'research' }>();
  const inOverrideMerge = new Set<string>();
  for (const [s, t] of entries(overrides.merge)) {
    edges.set(s, { target: t, from: 'override' });
    inOverrideMerge.add(s);
    inOverrideMerge.add(t);
  }
  const notDuplicates = new Set(entries(overrides.not_duplicates).map(([k]) => k));
  const ignoredResearchEdges: string[] = [];
  for (const r of research.values()) {
    if (!r.duplicate_of) continue;
    const edge = `${r.key} -> ${r.duplicate_of}`;
    if (
      inOverrideMerge.has(r.key) ||
      inOverrideMerge.has(r.duplicate_of) ||
      notDuplicates.has(r.key) ||
      notDuplicates.has(r.duplicate_of)
    ) {
      ignoredResearchEdges.push(edge);
      continue;
    }
    if (!research.has(r.duplicate_of)) fail(`research: ${edge} points at an unknown key`);
    edges.set(r.key, { target: r.duplicate_of, from: 'research' });
  }
  for (const [s, { target }] of edges) if (s === target) fail(`merge: ${s} points at itself`);
  bail();

  const rootOf = new Map<string, string>();
  for (const key of research.keys()) {
    const path = [key];
    let at = key;
    while (edges.has(at)) {
      at = edges.get(at)!.target;
      if (path.includes(at)) {
        fail(`merge: cycle ${[...path, at].join(' -> ')}`);
        break;
      }
      path.push(at);
    }
    rootOf.set(key, at);
  }
  bail();

  const membersOf = new Map<string, string[]>();
  for (const [key, root] of rootOf) {
    if (key === root) continue;
    if (!membersOf.has(root)) membersOf.set(root, []);
    membersOf.get(root)!.push(key);
  }
  const notes: string[] = [];
  for (const [root, members] of membersOf) {
    members.sort();
    const keptMembers = members.filter((m) => kept.get(m));
    if (!kept.get(root) && keptMembers.length)
      fail(`merge: rejected root ${root} has kept members ${keptMembers.join(', ')}`);
    if (kept.get(root))
      for (const m of members.filter((m) => !kept.get(m)))
        notes.push(`rejected ${m} is merged into kept ${root}; its match keys go to ${root}`);
  }
  bail();

  // --- Match keys per research record.
  function recordKeys(key: string): string[] {
    const urlname = key.startsWith('m:') ? key.slice(2) : null;
    if (urlname) return [meetupKey(urlname)];
    const c = candidates.get(key.slice(2));
    if (!c) {
      fail(`${key}: no candidate with slug "${key.slice(2)}" in candidates.json`);
      return [];
    }
    const keys: string[] = [];
    for (const i of c.unit_indices) {
      const u = units.get(i);
      if (!u) fail(`${key}: unit ${i} is not in units.json`);
      else keys.push(seriesKey(u.title, u.organizer));
    }
    if (c.meetup_urlname) keys.push(meetupKey(c.meetup_urlname));
    return keys;
  }

  // --- Build one group per kept root.
  const roots = [...research.keys()].filter((k) => rootOf.get(k) === k && kept.get(k)).sort();
  const groups: DirectoryGroup[] = roots.map((key) => {
    const r = research.get(key)!;
    const members = membersOf.get(key) ?? [];
    const matchKeys = [...new Set([key, ...members].flatMap(recordKeys))].sort();
    const meetupUrl =
      text(input.get(key)!.meetup_url) ??
      members.map((m) => text(input.get(m)!.meetup_url)).find((u) => u) ??
      null;
    return {
      directory_key: key,
      slug: '', // assigned below
      name: text(r.name) ?? '',
      description: text(r.description),
      category: r.category,
      website: links.has(key) ? text(links.get(key)!.website) : text(r.website),
      meetup_url: meetupUrl,
      schedule: text(r.schedule),
      home_base: text(r.home_base),
      match_keys: matchKeys,
      merged_from: members,
    };
  });
  for (const [k] of entries(overrides.edits))
    if (!roots.includes(k)) fail(`overrides.edits: ${k} is not a surviving group`);
  bail();

  // --- Slugs: explicit edits first (they must not collide), then the rest in directory_key order.
  const editsFor = (key: string) => overrides.edits?.[key] ?? {};
  const used = new Set<string>();
  const baseSlug = (g: DirectoryGroup): string => {
    const explicit = text(editsFor(g.directory_key).slug);
    if (explicit) return explicit;
    if (g.directory_key.startsWith('c:')) return candidates.get(g.directory_key.slice(2))!.slug;
    return cleanTitle(g.name).replace(/-+$/, '');
  };
  const ordered = [...groups].sort(
    (a, b) =>
      Number(!text(editsFor(a.directory_key).slug)) -
        Number(!text(editsFor(b.directory_key).slug)) ||
      a.directory_key.localeCompare(b.directory_key)
  );
  const renamedSlugs: string[] = [];
  for (const g of ordered) {
    const base = baseSlug(g);
    if (!base) {
      fail(`${g.directory_key}: name "${g.name}" gives an empty slug (add edits.slug)`);
      continue;
    }
    let slug = base;
    if (used.has(slug)) {
      if (text(editsFor(g.directory_key).slug))
        fail(`${g.directory_key}: edits.slug "${slug}" collides with another edits.slug`);
      let n = 2;
      while (used.has(`${base}-${n}`)) n++;
      slug = `${base}-${n}`;
      renamedSlugs.push(`${g.directory_key}: ${base} -> ${slug}`);
    }
    used.add(slug);
    g.slug = slug;
  }

  // --- Field edits last.
  for (const g of groups) {
    const e = editsFor(g.directory_key);
    for (const field of EDITABLE) {
      if (field === 'slug' || !(field in e)) continue;
      const value = text(e[field]);
      if (field === 'name' || field === 'category') g[field] = value ?? '';
      else g[field] = value;
    }
  }

  // --- Validate.
  const slugs = new Map<string, string>();
  const directoryKeys = new Set<string>();
  const owner = new Map<string, string>();
  for (const g of groups) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(g.slug)) fail(`${g.directory_key}: bad slug "${g.slug}"`);
    if (slugs.has(g.slug))
      fail(`slug "${g.slug}" is used by ${slugs.get(g.slug)} and ${g.directory_key}`);
    slugs.set(g.slug, g.directory_key);
    if (directoryKeys.has(g.directory_key)) fail(`duplicate directory_key ${g.directory_key}`);
    directoryKeys.add(g.directory_key);
    if (!g.name) fail(`${g.directory_key}: empty name`);
    if (!isGroupCategory(g.category)) fail(`${g.directory_key}: unknown category "${g.category}"`);
    if (g.description && g.description.length > MAX_DESCRIPTION)
      fail(
        `${g.directory_key}: description is ${g.description.length} chars (max ${MAX_DESCRIPTION})`
      );
    if (!g.match_keys.length) fail(`${g.directory_key}: no match keys`);
    for (const k of g.match_keys) {
      if (owner.has(k)) fail(`match key "${k}" is owned by ${owner.get(k)} and ${g.directory_key}`);
      owner.set(k, g.directory_key);
    }
  }
  bail();

  // --- Write.
  groups.sort((a, b) => a.slug.localeCompare(b.slug));
  const directory: Directory = {
    generated_at: new Date().toISOString(),
    count: groups.length,
    groups,
  };
  writeFileSync(join(DIR, 'directory.json'), JSON.stringify(directory, null, 2) + '\n');

  // --- Report.
  const researchRejects = [...research.values()].filter((r) => r.verdict === 'reject').length;
  const overrideRejects = entries(overrides.reject).filter(
    ([k]) => research.get(k)!.verdict === 'keep'
  ).length;
  const overrideKeeps = entries(overrides.keep).filter(
    ([k]) => research.get(k)!.verdict === 'reject'
  ).length;
  const absorbed = [...membersOf.entries()].filter(([root]) => kept.get(root));

  console.log(`Research records:   ${research.size}`);
  console.log(
    `Rejected:           ${[...kept.values()].filter((v) => !v).length} (${researchRejects} by research, ${overrideRejects} more by overrides; ${overrideKeeps} research rejects kept by overrides)`
  );
  console.log(
    `Merged away:        ${absorbed.reduce((n, [, m]) => n + m.length, 0)} records into ${absorbed.length} groups`
  );
  for (const [root, members] of absorbed)
    for (const m of members)
      console.log(`                      ${m} -> ${root} (${edges.get(m)?.from})`);
  for (const k of linkRemovals) console.log(`Removed by links:   ${k}`);
  for (const k of networkingKeeps) console.log(`Networking kept:    ${k}`);
  for (const e of ignoredResearchEdges) console.log(`Ignored research edge: ${e}`);
  for (const n of notes) console.log(`Note: ${n}`);
  for (const s of renamedSlugs) console.log(`Slug collision:     ${s}`);
  console.log(`Groups:             ${groups.length}`);
  for (const c of GROUP_CATEGORIES)
    console.log(`  ${c.label.padEnd(26)} ${groups.filter((g) => g.category === c.value).length}`);
  console.log(`Match keys:         ${owner.size}`);
  console.log(
    `Links:              ${groups.filter((g) => g.website).length} websites, ${groups.filter((g) => g.meetup_url).length} Meetup pages, ${groups.filter((g) => !g.website && !g.meetup_url).length} with neither`
  );
  console.log(`Wrote:              ${join(DIR, 'directory.json')}`);
}

main();
