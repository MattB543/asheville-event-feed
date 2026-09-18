/**
 * Group discovery, step 1: build the inputs for the classification agents.
 *
 * Writes:
 *   data/groups/meetup-groups.json       every Meetup group we hold events for, straight from the DB (no AI needed)
 *   data/groups/units.json               one row per repeated (normalized title, organizer) "unit" across all other sources
 *   data/groups/buckets/bucket-NN.json   the same rows split into buckets of BUCKET_SIZE for one agent each
 *
 * A unit is a series: the same title from the same organizer seen at least MIN_COUNT times. Singletons
 * (~10.8k of them as of Sep 2026) are deliberately left out for now, since most one-offs are not groups.
 *
 * Buckets are sorted by organizer then title, so an organizer's series land in the same bucket and the
 * agent classifying them sees them together (e.g. every Asheville on Bikes ride, which are really many clubs).
 *
 * Run:  npx tsx scripts/groups/build-buckets.ts
 * Then: one Opus agent per bucket writes data/groups/results/bucket-NN.json (see data/groups/README.md)
 */
import '../../lib/config/env';
import postgres from 'postgres';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BUCKET_SIZE = 200;
const MIN_COUNT = 2;
const DESCRIPTION_CHARS = 600;
const OUT = join(process.cwd(), 'data', 'groups');
const LIVE = `deduped_at IS NULL AND dead_at IS NULL AND hidden = false`;

const MONTHS =
  'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
const DATE_AFTER_MONTH = new RegExp(
  `\\b(${MONTHS})\\.?\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s*\\d{4})?\\b`,
  'g'
);

/** Lowercase, drop dates, keep only [a-z0-9] tokens, so "Trivia Night 9/17" and "Trivia Night - Sept 24th" collapse. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(DATE_AFTER_MONTH, ' ')
    .replace(/\b20\d\d\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanDescription(raw: string | null): string | null {
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
  return text.length > DESCRIPTION_CHARS
    ? text.slice(0, DESCRIPTION_CHARS).trimEnd() + '...'
    : text;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function cadenceLabel(medianGapDays: number | null): string {
  if (medianGapDays === null) return 'unknown';
  if (medianGapDays < 0.5) return 'multiple-per-day';
  if (medianGapDays <= 1.5) return 'daily';
  if (medianGapDays <= 8) return 'weekly';
  if (medianGapDays <= 16) return 'biweekly';
  if (medianGapDays <= 35) return 'monthly';
  return 'sparse';
}

const day = (d: Date) => d.toISOString().slice(0, 10);

interface EventRow {
  id: string;
  title: string;
  organizer: string | null;
  source: string;
  start_date: Date;
  ai_summary: string | null;
  description: string | null;
  url: string;
}

export interface Unit {
  index: number;
  title: string;
  organizer: string | null;
  sources: string[];
  count: number;
  future_count: number;
  cadence: string;
  median_gap_days: number | null;
  first_seen: string;
  last_seen: string;
  summary: string | null;
  description: string | null;
  url: string;
  /** Only in units.json, not in the bucket files - the agents don't need them. */
  event_ids?: string[];
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const now = new Date();

  // --- Meetup groups: the organizer IS the group, and the urlname is the second path segment of every event URL.
  const meetupGroups = await sql.unsafe(`
    SELECT split_part(url, '/', 4) AS urlname,
      mode() WITHIN GROUP (ORDER BY organizer) AS name,
      count(*)::int AS event_count,
      count(*) FILTER (WHERE start_date >= now())::int AS future_count,
      min(start_date)::date::text AS first_seen,
      max(start_date)::date::text AS last_seen,
      (array_agg(DISTINCT title))[1:5] AS sample_titles,
      (array_agg(description ORDER BY start_date DESC) FILTER (WHERE description IS NOT NULL))[1] AS latest_description,
      array_agg(id::text ORDER BY start_date) AS event_ids
    FROM events
    WHERE ${LIVE} AND source = 'MEETUP'
    GROUP BY 1 ORDER BY event_count DESC`);

  const meetupOut = meetupGroups.map((g) => ({
    urlname: g.urlname,
    name: g.name,
    url: `https://www.meetup.com/${g.urlname}/`,
    event_count: g.event_count,
    future_count: g.future_count,
    first_seen: g.first_seen,
    last_seen: g.last_seen,
    sample_titles: g.sample_titles,
    description: cleanDescription(g.latest_description),
    event_ids: g.event_ids,
  }));

  // --- Everything else, grouped in JS by (normalized title, organizer).
  const rows = (await sql.unsafe(`
    SELECT id::text, title, organizer, source, start_date, ai_summary, description, url
    FROM events WHERE ${LIVE} AND source <> 'MEETUP'
    ORDER BY start_date`)) as unknown as EventRow[];
  await sql.end();

  const groups = new Map<string, EventRow[]>();
  for (const r of rows) {
    const key = `${normalizeTitle(r.title)} ${(r.organizer ?? '').trim().toLowerCase()}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const units: Unit[] = [];
  for (const list of groups.values()) {
    if (list.length < MIN_COUNT) continue;
    // list is already ordered by start_date ascending
    const latest = list[list.length - 1];
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      gaps.push((list[i].start_date.getTime() - list[i - 1].start_date.getTime()) / 86_400_000);
    }
    const medianGap = median(gaps);
    const longestDescription = list.reduce<string | null>(
      (best, r) =>
        r.description && r.description.length > (best?.length ?? 0) ? r.description : best,
      null
    );
    const latestSummary = [...list].reverse().find((r) => r.ai_summary)?.ai_summary ?? null;
    units.push({
      index: -1,
      title: latest.title.trim(),
      organizer: latest.organizer?.trim() || null,
      sources: [...new Set(list.map((r) => r.source))].sort(),
      count: list.length,
      future_count: list.filter((r) => r.start_date >= now).length,
      cadence: cadenceLabel(medianGap),
      median_gap_days: medianGap === null ? null : Math.round(medianGap * 10) / 10,
      first_seen: day(list[0].start_date),
      last_seen: day(latest.start_date),
      summary: latestSummary,
      description: cleanDescription(longestDescription),
      url: latest.url,
      event_ids: list.map((r) => r.id),
    });
  }

  units.sort(
    (a, b) =>
      (a.organizer ?? '').localeCompare(b.organizer ?? '', 'en', { sensitivity: 'base' }) ||
      a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
  );
  units.forEach((u, i) => (u.index = i));

  // --- Write everything.
  mkdirSync(OUT, { recursive: true });
  const bucketsDir = join(OUT, 'buckets');
  if (existsSync(bucketsDir)) rmSync(bucketsDir, { recursive: true });
  mkdirSync(bucketsDir);

  writeFileSync(
    join(OUT, 'meetup-groups.json'),
    JSON.stringify({ generated_at: now.toISOString(), groups: meetupOut }, null, 2)
  );
  writeFileSync(
    join(OUT, 'units.json'),
    JSON.stringify(
      { generated_at: now.toISOString(), min_count: MIN_COUNT, bucket_size: BUCKET_SIZE, units },
      null,
      2
    )
  );

  const bucketCount = Math.ceil(units.length / BUCKET_SIZE);
  for (let b = 0; b < bucketCount; b++) {
    const name = `bucket-${String(b + 1).padStart(2, '0')}`;
    const slice = units
      .slice(b * BUCKET_SIZE, (b + 1) * BUCKET_SIZE)
      .map(({ event_ids: _omit, ...rest }) => rest);
    // One row per line (still valid JSON) so an agent can read a whole bucket in one pass.
    const body = `{"bucket":"${name}","rows":[\n${slice.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
    writeFileSync(join(bucketsDir, `${name}.json`), body);
  }

  const eventsCovered = units.reduce((n, u) => n + u.count, 0);
  console.log(`Meetup groups:      ${meetupOut.length}`);
  console.log(`Non-Meetup events:  ${rows.length}`);
  console.log(
    `Repeated units:     ${units.length} (covering ${eventsCovered} events; ${groups.size - units.length} singletons skipped)`
  );
  console.log(`Buckets:            ${bucketCount} x ${BUCKET_SIZE} -> ${bucketsDir}`);
  const byCadence = units.reduce<Record<string, number>>(
    (acc, u) => ((acc[u.cadence] = (acc[u.cadence] ?? 0) + 1), acc),
    {}
  );
  console.log(`By cadence:         ${JSON.stringify(byCadence)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
