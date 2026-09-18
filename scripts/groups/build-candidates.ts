/**
 * Group discovery, final step: assemble the candidate group list.
 *
 * Reads:  data/groups/classified.json   every unit with its verdict (+ evidence for grey units)
 *         data/groups/aliases.json      clusters from the normalization agent: which units are the same group
 *         data/groups/meetup-groups.json
 *         data/groups/reviewed.json     human review decisions, keyed by slug, applied on top of the rules below
 * Writes: data/groups/candidates.json   one entry per candidate group, with status, evidence, aliases,
 *                                       unit indices, event ids, and a Meetup cross-link when one exists
 *
 * Status rules:
 *   - any unit in the cluster was classified `group`            -> status "group"
 *   - all units grey, evidence says group                        -> status "group" (evidence_verdict records why)
 *   - all units grey, evidence says not_group                    -> status "rejected"
 *   - all units grey, evidence unsure or missing                 -> status "grey"
 * A slug listed in reviewed.json overrides whatever the rules produced, and the entry records the call in
 * `review_note`. That file is the only place a human decision survives a rebuild - editing candidates.json
 * directly does not.
 * `evidence_verdict` / `evidence_confidence` are kept on every entry so the human review can second-guess these.
 *
 * Run: npx tsx scripts/groups/build-candidates.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassifiedUnit, Evidence } from './merge-results';

const DIR = join(process.cwd(), 'data', 'groups');

/** Written by the normalization agent. Every group/grey unit index must appear in exactly one cluster. */
export interface AliasCluster {
  name: string;
  kind: string;
  unit_indices: number[];
  /** urlname of the matching Meetup group when the same group also posts on Meetup, else null. */
  meetup_urlname: string | null;
  notes?: string;
}

interface MeetupGroup {
  urlname: string;
  name: string;
  url: string;
  event_count: number;
  future_count: number;
  first_seen: string;
  last_seen: string;
}

export interface Candidate {
  slug: string;
  name: string;
  kind: string;
  status: 'group' | 'grey' | 'rejected';
  classifier_verdicts: Record<string, number>;
  evidence_verdict: Evidence['verdict'] | null;
  evidence_confidence: number | null;
  website: string | null;
  summary: string | null;
  aliases: string[];
  meetup_urlname: string | null;
  meetup_url: string | null;
  sources: string[];
  unit_indices: number[];
  event_ids: string[];
  event_count: number;
  future_count: number;
  first_seen: string;
  last_seen: string;
  cadence: string[];
  notes: string | null;
  /** Why a human overrode the derived status, from reviewed.json. Null when no one has ruled on this one. */
  review_note: string | null;
}

/** data/groups/reviewed.json: slug -> decision. Keys starting with "_" are comments. */
type Reviewed = Record<string, { status: Candidate['status']; note: string }>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function main() {
  const { units } = JSON.parse(readFileSync(join(DIR, 'classified.json'), 'utf8')) as {
    units: ClassifiedUnit[];
  };
  const { clusters } = JSON.parse(readFileSync(join(DIR, 'aliases.json'), 'utf8')) as {
    clusters: AliasCluster[];
  };
  const { groups: meetupGroups } = JSON.parse(
    readFileSync(join(DIR, 'meetup-groups.json'), 'utf8')
  ) as {
    groups: MeetupGroup[];
  };
  const meetupByUrlname = new Map(meetupGroups.map((g) => [g.urlname, g]));

  // --- Validate the alias map covers every group/grey unit exactly once.
  const eligible = new Set(units.filter((u) => u.verdict !== 'not_group').map((u) => u.index));
  const seen = new Map<number, string>();
  const problems: string[] = [];
  for (const c of clusters) {
    if (!c.name?.trim())
      problems.push(`cluster with empty name (units ${c.unit_indices.join(', ')})`);
    if (c.meetup_urlname && !meetupByUrlname.has(c.meetup_urlname))
      problems.push(`"${c.name}": unknown meetup_urlname "${c.meetup_urlname}"`);
    for (const i of c.unit_indices) {
      if (!eligible.has(i)) problems.push(`"${c.name}": unit ${i} is not a group/grey unit`);
      if (seen.has(i)) problems.push(`unit ${i} is in both "${seen.get(i)}" and "${c.name}"`);
      seen.set(i, c.name);
    }
  }
  const missing = [...eligible].filter((i) => !seen.has(i));
  if (missing.length)
    problems.push(
      `${missing.length} group/grey units are in no cluster: ${missing.slice(0, 30).join(', ')}${missing.length > 30 ? '...' : ''}`
    );
  if (problems.length) {
    console.error(`${problems.length} problem(s) in aliases.json:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const byIndex = new Map(units.map((u) => [u.index, u]));
  const usedSlugs = new Set<string>();

  const candidates: Candidate[] = clusters.map((c) => {
    const members = c.unit_indices.map((i) => byIndex.get(i)!);
    const verdicts: Record<string, number> = {};
    for (const m of members) verdicts[m.verdict] = (verdicts[m.verdict] ?? 0) + 1;

    // Evidence: prefer the highest-confidence file among the cluster's units (they usually share one).
    const evidence =
      members
        .map((m) => m.evidence)
        .filter((e): e is Evidence => !!e)
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;

    let status: Candidate['status'];
    if (verdicts.group) status = 'group';
    else if (evidence?.verdict === 'group') status = 'group';
    else if (evidence?.verdict === 'not_group') status = 'rejected';
    else status = 'grey';

    const aliases = [
      ...new Set(members.map((m) => m.group_name!).filter((n) => n && n !== c.name)),
    ];
    if (evidence?.canonical_name && evidence.canonical_name !== c.name)
      aliases.push(evidence.canonical_name);

    let slug = slugify(c.name);
    if (usedSlugs.has(slug)) {
      let n = 2;
      while (usedSlugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    usedSlugs.add(slug);

    const meetup = c.meetup_urlname ? meetupByUrlname.get(c.meetup_urlname)! : null;
    const eventIds = [...new Set(members.flatMap((m) => m.event_ids ?? []))];

    return {
      slug,
      name: c.name,
      kind: c.kind,
      status,
      classifier_verdicts: verdicts,
      evidence_verdict: evidence?.verdict ?? null,
      evidence_confidence: evidence?.confidence ?? null,
      website: evidence?.website ?? null,
      summary: evidence?.summary ?? null,
      aliases,
      meetup_urlname: meetup?.urlname ?? null,
      meetup_url: meetup?.url ?? null,
      sources: [...new Set(members.flatMap((m) => m.sources))].sort(),
      unit_indices: [...c.unit_indices].sort((a, b) => a - b),
      event_ids: eventIds,
      event_count: eventIds.length,
      future_count: members.reduce((n, m) => n + m.future_count, 0),
      first_seen: members.map((m) => m.first_seen).sort()[0],
      last_seen: members
        .map((m) => m.last_seen)
        .sort()
        .at(-1)!,
      cadence: [...new Set(members.map((m) => m.cadence))],
      notes: c.notes ?? null,
      review_note: null,
    };
  });

  const reviewed = JSON.parse(readFileSync(join(DIR, 'reviewed.json'), 'utf8')) as Reviewed;
  const reviewedSlugs = new Set(Object.keys(reviewed).filter((k) => !k.startsWith('_')));
  for (const c of candidates) {
    const decision = reviewed[c.slug];
    if (!decision || c.slug.startsWith('_')) continue;
    c.status = decision.status;
    c.review_note = decision.note;
    reviewedSlugs.delete(c.slug);
  }
  // A slug that no longer exists means a cluster was renamed or dropped - the decision is silently lost, so say so.
  for (const slug of reviewedSlugs)
    console.warn(`reviewed.json: no candidate matches slug "${slug}"`);

  candidates.sort((a, b) => a.status.localeCompare(b.status) || b.event_count - a.event_count);

  writeFileSync(
    join(DIR, 'candidates.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), candidates }, null, 2)
  );

  const byStatus: Record<string, number> = {};
  const byStatusEvidence: Record<string, number> = {};
  for (const c of candidates) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const k = `${c.status}/${c.evidence_verdict ?? 'no-evidence'}`;
    byStatusEvidence[k] = (byStatusEvidence[k] ?? 0) + 1;
  }
  const withMeetup = candidates.filter((c) => c.meetup_urlname).length;
  console.log(
    `Candidates:         ${candidates.length} from ${clusters.length} clusters over ${eligible.size} units`
  );
  console.log(`By status:          ${JSON.stringify(byStatus)}`);
  console.log(`Status/evidence:    ${JSON.stringify(byStatusEvidence)}`);
  const overridden = candidates.filter((c) => c.review_note).length;
  console.log(`Linked to Meetup:   ${withMeetup}`);
  console.log(`Human overrides:    ${overridden}`);
  console.log(`Wrote:              candidates.json`);
}

main();
