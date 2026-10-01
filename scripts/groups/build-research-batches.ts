/**
 * Group directory, step 7: build the inputs for the final research pass.
 *
 * One record per group we intend to list: every approved or grey candidate from candidates.json, plus
 * every Meetup group in the live DB (Meetup groups were auto-approved and never reviewed). A candidate
 * that names a meetup_urlname absorbs that Meetup group, so it appears once.
 *
 * Each record carries fresh context from the live DB (matched by the same keys the directory will use:
 * Meetup urlname, or the candidate's (normalized title, organizer) unit keys) so the research agents
 * see what the group is doing now, not the Sep 18 snapshot.
 *
 * Writes:
 *   data/groups/research/input/batch-NN.json   ~BATCH_SIZE records each, one Sonnet agent per file
 *   data/groups/research/index.json            key + name + type for every record (cross-batch duplicate checks)
 *
 * Run:  npx tsx scripts/groups/build-research-batches.ts
 */
import '../../lib/config/env';
import postgres from 'postgres';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTitle } from '../../lib/groups/matchKeys';

const BATCH_SIZE = 38;
const DESCRIPTION_CHARS = 500;
const DIR = join(process.cwd(), 'data', 'groups');
const OUT = join(DIR, 'research');
const LIVE = `deduped_at IS NULL AND dead_at IS NULL AND hidden = false`;

// Rejected candidates whose rejection was never a human call and is inconsistent with an approved sibling.
const RECHECK_REJECTED = new Set(['weaverville-library-teen-dungeons-dragons']);
const CONFLICTS = new Set([
  'open-electric-jam-ft-the-king-street-house-band',
  'pack-memorial-library-teen-dungeons-dragons',
]);
const SHOP_RIDES = new Set([
  'liberty-bicycles-urban-cruise-ride',
  'liberty-bicycles-thursday-mtb-ride',
  'liberty-bicycles-slow-cial-gravel-ride',
  'liberty-bicycles-slow-cial-mtb-ride',
  'motion-makers-women-s-mountain-bike-ride',
  'motion-makers-no-drop-mtb-ride',
  'youngblood-bicycles-thursday-road-ride',
  'gravelo-workshop-group-ride',
]);

const unitKey = (title: string, organizer: string | null) =>
  `${normalizeTitle(title)} ${(organizer ?? '').trim().toLowerCase()}`;

function clean(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > DESCRIPTION_CHARS ? `${text.slice(0, DESCRIPTION_CHARS)}...` : text;
}

function top(values: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v && v.trim()) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v, c]) => `${v} (${c})`);
}

interface EventRow {
  id: string;
  title: string;
  organizer: string | null;
  location: string | null;
  source: string;
  url: string;
  start_date: Date;
  description: string | null;
  ai_summary: string | null;
}

interface Candidate {
  slug: string;
  name: string;
  kind: string;
  status: string;
  evidence_verdict: string | null;
  website: string | null;
  summary: string | null;
  aliases: string[];
  meetup_urlname: string | null;
  sources: string[];
  unit_indices: number[];
  event_ids: string[];
  cadence: string[];
  notes: string | null;
  review_note: string | null;
}

async function main() {
  const candidates = (
    JSON.parse(readFileSync(join(DIR, 'candidates.json'), 'utf8')) as { candidates: Candidate[] }
  ).candidates.filter(
    (c) => c.status === 'group' || c.status === 'grey' || RECHECK_REJECTED.has(c.slug)
  );
  const units = (
    JSON.parse(readFileSync(join(DIR, 'units.json'), 'utf8')) as {
      units: { index: number; title: string; organizer: string | null }[];
    }
  ).units;
  const unitByIndex = new Map(units.map((u) => [u.index, u]));

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const rows = (await sql.unsafe(`
    SELECT id::text, title, organizer, location, source, url, start_date, description, ai_summary
    FROM events WHERE ${LIVE} ORDER BY start_date`)) as unknown as EventRow[];
  await sql.end();

  const byId = new Map(rows.map((r) => [r.id, r]));
  const byMeetup = new Map<string, EventRow[]>();
  const byKey = new Map<string, EventRow[]>();
  for (const r of rows) {
    if (r.source === 'MEETUP') {
      const urlname = r.url.split('/')[3];
      if (!byMeetup.has(urlname)) byMeetup.set(urlname, []);
      byMeetup.get(urlname)!.push(r);
    } else {
      const k = unitKey(r.title, r.organizer);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(r);
    }
  }

  const now = Date.now();
  function context(events: EventRow[]) {
    const sorted = [...new Map(events.map((e) => [e.id, e])).values()].sort(
      (a, b) => a.start_date.getTime() - b.start_date.getTime()
    );
    const recent = [...sorted].reverse();
    const longest = recent
      .slice(0, 15)
      .reduce<
        string | null
      >((best, e) => (e.description && e.description.length > (best?.length ?? 0) ? e.description : best), null);
    return {
      event_count: sorted.length,
      future_count: sorted.filter((e) => e.start_date.getTime() >= now).length,
      first_seen: sorted[0]?.start_date.toISOString().slice(0, 10) ?? null,
      last_seen: sorted.at(-1)?.start_date.toISOString().slice(0, 10) ?? null,
      sources: [...new Set(sorted.map((e) => e.source))],
      organizers: top(
        sorted.map((e) => e.organizer),
        3
      ),
      locations: top(
        sorted.map((e) => e.location),
        3
      ),
      sample_titles: [...new Set(recent.map((e) => e.title))].slice(0, 6),
      sample_urls: [...new Set(recent.map((e) => e.url))].slice(0, 3),
      latest_ai_summary: recent.find((e) => e.ai_summary)?.ai_summary ?? null,
      description_excerpt: clean(longest),
    };
  }

  const absorbedMeetup = new Set<string>();
  const records: Record<string, unknown>[] = [];

  for (const c of candidates) {
    const events: EventRow[] = [];
    for (const id of c.event_ids) {
      const e = byId.get(id);
      if (e) events.push(e);
    }
    for (const i of c.unit_indices) {
      const u = unitByIndex.get(i);
      if (u) events.push(...(byKey.get(unitKey(u.title, u.organizer)) ?? []));
    }
    if (c.meetup_urlname) {
      absorbedMeetup.add(c.meetup_urlname);
      events.push(...(byMeetup.get(c.meetup_urlname) ?? []));
    }
    const flags: string[] = [];
    if (c.status === 'grey') flags.push('grey_unresolved');
    if (CONFLICTS.has(c.slug)) flags.push('classifier_vs_evidence_conflict');
    if (SHOP_RIDES.has(c.slug)) flags.push('shop_hosted_ride');
    if (RECHECK_REJECTED.has(c.slug)) flags.push('previously_rejected_recheck');
    records.push({
      key: `c:${c.slug}`,
      type: 'candidate',
      current_status: c.status,
      flags,
      name: c.name,
      kind: c.kind,
      aliases: c.aliases,
      notes: c.notes,
      known_website: c.website,
      known_summary: c.summary,
      meetup_url: c.meetup_urlname ? `https://www.meetup.com/${c.meetup_urlname}/` : null,
      cadence: c.cadence,
      ...context(events),
    });
  }

  for (const [urlname, events] of byMeetup) {
    if (absorbedMeetup.has(urlname)) continue;
    const ctx = context(events);
    records.push({
      key: `m:${urlname}`,
      type: 'meetup',
      current_status: 'auto_approved_unreviewed',
      flags: [],
      name:
        top(
          events.map((e) => e.organizer),
          1
        )[0]?.replace(/ \(\d+\)$/, '') ?? urlname,
      meetup_url: `https://www.meetup.com/${urlname}/`,
      ...ctx,
    });
  }

  if (existsSync(join(OUT, 'input'))) rmSync(join(OUT, 'input'), { recursive: true });
  mkdirSync(join(OUT, 'input'), { recursive: true });
  mkdirSync(join(OUT, 'results'), { recursive: true });

  // Interleave candidates and Meetup groups so every batch has a similar mix of work.
  const sortedRecords = records.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const batchCount = Math.ceil(sortedRecords.length / BATCH_SIZE);
  const batches: Record<string, unknown>[][] = Array.from({ length: batchCount }, () => []);
  sortedRecords.forEach((r, i) => batches[i % batchCount].push(r));
  batches.forEach((b, i) =>
    writeFileSync(
      join(OUT, 'input', `batch-${String(i + 1).padStart(2, '0')}.json`),
      JSON.stringify({ batch: i + 1, records: b }, null, 2)
    )
  );
  writeFileSync(
    join(OUT, 'index.json'),
    JSON.stringify(
      sortedRecords.map((r) => ({ key: r.key, name: r.name, type: r.type })),
      null,
      2
    )
  );

  console.log(
    `Records: ${records.length} (${candidates.length} candidates, ${records.length - candidates.length} Meetup groups; ${absorbedMeetup.size} Meetup groups absorbed by candidates)`
  );
  console.log(`Batches: ${batchCount} x ~${BATCH_SIZE} -> ${join(OUT, 'input')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
