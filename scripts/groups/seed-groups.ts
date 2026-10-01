/**
 * Group directory, step 10: sync data/groups/directory.json into the `groups` table, then report how
 * many live events each group matches.
 *
 * Sync, in one transaction: rows are keyed by `directory_key`. New groups are inserted, changed groups
 * are updated (every field except `hidden`, which is the moderation switch and never touched here; and
 * `updated_at` is bumped only for rows that actually changed, since the sitemap uses it), and rows
 * whose directory_key is no longer in the file are deleted. The dry run prints the same plan without
 * writing.
 *
 * Coverage + parity: every live event is matched to a group twice -
 *   1. full scan: all live events, keyed in JS with eventMatchKey (the definition of membership);
 *   2. the SQL prefilter the /groups pages use (lib/db/queries/groups.ts), then confirmed in JS.
 * The per-group counts must be identical. On top of that, every live row's SQL-normalized organizer /
 * urlname is compared with the JS one, which proves the prefilter can never drop a matching event
 * (whether the page asks for one group or all of them). Any difference exits non-zero.
 *
 * Scripts write outside Next.js and cannot call revalidateTag, so /groups pages pick the change up
 * when their cache expires (within an hour) or after the next scrape invalidates the `events` tag.
 *
 * Usage:
 *   npx tsx scripts/groups/seed-groups.ts           # dry run: sync plan + coverage/parity report
 *   npx tsx scripts/groups/seed-groups.ts --apply   # write, then the same report
 */
import '../../lib/config/env';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventMatchKey, meetupUrlname, normalizeOrganizer } from '../../lib/groups/matchKeys';
import { fetchCandidateEvents } from '../../lib/db/queries/groups';
import { getStartOfTodayEastern } from '../../lib/utils/timezone';
import type { Directory, DirectoryGroup } from './build-directory';

const DIRECTORY = join(process.cwd(), 'data', 'groups', 'directory.json');

const LIVE = `hidden IS NOT TRUE AND deduped_at IS NULL AND dead_at IS NULL`;
// The per-row normalization check below compares these with the JS key functions. They mirror the
// organizer / urlname expressions inside the pages' prefilter (lib/db/queries/groups.ts); the
// prefilter itself is exercised directly through fetchCandidateEvents.
const SQL_ORGANIZER = `lower(btrim(coalesce(organizer, ''), E' \\t\\r\\n\\u00a0'))`;
const SQL_URLNAME = `split_part(url, '/', 4)`;

/** The columns the seed owns, in DB naming. */
const FIELDS = [
  'slug',
  'name',
  'description',
  'category',
  'website',
  'meetup_url',
  'schedule',
  'home_base',
  'match_keys',
] as const;
type Field = (typeof FIELDS)[number];
type GroupRow = { directory_key: string } & Pick<DirectoryGroup, Field>;

interface EventRow {
  id: string;
  title: string;
  organizer: string | null;
  source: string;
  url: string;
  start_date: Date;
}

function same(a: GroupRow[Field], b: GroupRow[Field]): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    );
  }
  return (a ?? null) === (b ?? null);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const directory = JSON.parse(readFileSync(DIRECTORY, 'utf8')) as Directory;
  const file: GroupRow[] = directory.groups.map((g) => ({
    directory_key: g.directory_key,
    slug: g.slug,
    name: g.name,
    description: g.description,
    category: g.category,
    website: g.website,
    meetup_url: g.meetup_url,
    schedule: g.schedule,
    home_base: g.home_base,
    match_keys: g.match_keys,
  }));
  if (file.length !== directory.count)
    throw new Error('directory.json count does not match groups');

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  let failed = false;

  try {
    // --- Sync plan.
    const existing = (await sql.unsafe(
      `SELECT id::text, directory_key, ${FIELDS.join(', ')} FROM groups`
    )) as unknown as (GroupRow & { id: string })[];
    const byKey = new Map(existing.map((r) => [r.directory_key, r]));
    const fileKeys = new Set(file.map((g) => g.directory_key));

    const inserts = file.filter((g) => !byKey.has(g.directory_key));
    const updates: { row: GroupRow; changed: Field[] }[] = [];
    for (const g of file) {
      const current = byKey.get(g.directory_key);
      if (!current) continue;
      const changed = FIELDS.filter((f) => !same(g[f], current[f]));
      if (changed.length) updates.push({ row: g, changed });
    }
    const deletes = existing.filter((r) => !fileKeys.has(r.directory_key));

    console.log(
      `${apply ? 'APPLY' : 'DRY RUN'}: directory.json has ${file.length} groups (generated ${directory.generated_at}); table has ${existing.length}`
    );
    console.log(
      `  inserts ${inserts.length}, updates ${updates.length}, deletes ${deletes.length}, unchanged ${file.length - inserts.length - updates.length}`
    );
    const show = 15;
    for (const g of inserts.slice(0, show)) console.log(`  + ${g.slug} (${g.directory_key})`);
    if (inserts.length > show) console.log(`  + ... and ${inserts.length - show} more`);
    for (const u of updates.slice(0, show))
      console.log(`  ~ ${u.row.slug} (${u.row.directory_key}): ${u.changed.join(', ')}`);
    if (updates.length > show) console.log(`  ~ ... and ${updates.length - show} more`);
    for (const r of deletes) console.log(`  - ${r.slug} (${r.directory_key})`);

    // --- Write.
    if (apply && (inserts.length || updates.length || deletes.length)) {
      const upserts = [...inserts, ...updates.map((u) => u.row)];
      const slugMoves = updates
        .filter((u) => u.changed.includes('slug'))
        .map((u) => u.row.directory_key);
      await sql.begin(async (tx) => {
        if (deletes.length)
          await tx.unsafe(`DELETE FROM groups WHERE directory_key = ANY($1::text[])`, [
            deletes.map((r) => r.directory_key),
          ]);
        // Park changing slugs first so two groups swapping slugs can't trip the unique constraint.
        if (slugMoves.length)
          await tx.unsafe(
            `UPDATE groups SET slug = '~reseed-' || id::text WHERE directory_key = ANY($1::text[])`,
            [slugMoves]
          );
        // One statement for every row. The JSON goes in as text: a bare $1::jsonb makes postgres.js
        // JSON-encode the string a second time.
        if (upserts.length)
          await tx.unsafe(
            `INSERT INTO groups (directory_key, ${FIELDS.join(', ')})
             SELECT directory_key, ${FIELDS.join(', ')}
             FROM jsonb_to_recordset($1::text::jsonb) AS r(
               directory_key text, slug text, name text, description text, category text,
               website text, meetup_url text, schedule text, home_base text, match_keys text[])
             ON CONFLICT (directory_key) DO UPDATE SET
               ${FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')},
               updated_at = now()`,
            [JSON.stringify(upserts)]
          );
      });

      // Read back: the table must now equal the file.
      const after = (await sql.unsafe(
        `SELECT directory_key, ${FIELDS.join(', ')} FROM groups`
      )) as unknown as GroupRow[];
      const afterByKey = new Map(after.map((r) => [r.directory_key, r]));
      const mismatched = file.filter((g) => {
        const r = afterByKey.get(g.directory_key);
        return !r || FIELDS.some((f) => !same(g[f], r[f]));
      });
      console.log(
        `  wrote: table now has ${after.length} rows; ${mismatched.length} differ from directory.json`
      );
      if (after.length !== file.length || mismatched.length) failed = true;
    } else if (apply) {
      console.log('  nothing to write');
    } else {
      console.log('  (dry run - nothing written; re-run with --apply)');
    }

    // --- Coverage + parity.
    const groupOf = new Map<string, string>();
    for (const g of file) for (const k of g.match_keys) groupOf.set(k, g.directory_key);

    const all = (await sql.unsafe(
      `SELECT id::text, title, organizer, source, url, start_date,
              ${SQL_ORGANIZER} AS sql_organizer, ${SQL_URLNAME} AS sql_urlname
       FROM events WHERE ${LIVE}`
    )) as unknown as (EventRow & { sql_organizer: string; sql_urlname: string })[];

    // The pages' "upcoming" cutoff, so these counts match what /groups shows.
    const cutoff = getStartOfTodayEastern().getTime();
    const scanCount = new Map<string, number>();
    const upcomingCount = new Map<string, number>();
    const normalizationDiffs: { matched: boolean; row: (typeof all)[number]; js: string | null }[] =
      [];
    for (const e of all) {
      const key = eventMatchKey(e);
      const group = key ? groupOf.get(key) : undefined;
      if (group) {
        scanCount.set(group, (scanCount.get(group) ?? 0) + 1);
        if (new Date(e.start_date).getTime() >= cutoff)
          upcomingCount.set(group, (upcomingCount.get(group) ?? 0) + 1);
      }
      const js = e.source === 'MEETUP' ? meetupUrlname(e.url) : normalizeOrganizer(e.organizer);
      const sqlValue = e.source === 'MEETUP' ? e.sql_urlname : e.sql_organizer;
      if (js !== sqlValue) normalizationDiffs.push({ matched: !!group, row: e, js });
    }

    // The exact query the /groups pages run, not a copy of it.
    const prefiltered = await fetchCandidateEvents([...groupOf.keys()]);
    const prefilterCount = new Map<string, number>();
    for (const e of prefiltered) {
      const key = eventMatchKey(e);
      const group = key ? groupOf.get(key) : undefined;
      if (group) prefilterCount.set(group, (prefilterCount.get(group) ?? 0) + 1);
    }

    const matched = [...scanCount.values()].reduce((a, b) => a + b, 0);
    console.log(
      `\nCoverage: ${all.length} live events; ${matched} match a group; ${scanCount.size} of ${file.length} groups have live events`
    );
    console.log(`Prefilter: ${prefiltered.length} candidate rows from the pages' query`);

    console.log('\nLive events per group (live / upcoming):');
    const sorted = [...file].sort(
      (a, b) =>
        (scanCount.get(b.directory_key) ?? 0) - (scanCount.get(a.directory_key) ?? 0) ||
        a.slug.localeCompare(b.slug)
    );
    for (const g of sorted) {
      const n = scanCount.get(g.directory_key) ?? 0;
      if (n)
        console.log(
          `  ${String(n).padStart(5)} / ${String(upcomingCount.get(g.directory_key) ?? 0).padStart(3)}  ${g.slug}`
        );
    }

    const zero = sorted.filter((g) => !scanCount.has(g.directory_key));
    console.log(`\nGroups with zero live events (${zero.length}):`);
    for (const g of zero) console.log(`  ${g.slug} (${g.directory_key})`);

    const differing = file.filter(
      (g) => (scanCount.get(g.directory_key) ?? 0) !== (prefilterCount.get(g.directory_key) ?? 0)
    );
    const matchedDiffs = normalizationDiffs.filter((d) => d.matched);
    console.log(
      `\nParity: ${differing.length} groups where full scan != SQL prefilter; ${normalizationDiffs.length} live rows whose SQL normalization differs from JS (${matchedDiffs.length} of them in a group)`
    );
    for (const g of differing)
      console.log(
        `  ${g.slug}: full scan ${scanCount.get(g.directory_key) ?? 0}, prefilter ${prefilterCount.get(g.directory_key) ?? 0}`
      );
    for (const d of normalizationDiffs.slice(0, 20))
      console.log(
        `  ${d.matched ? 'IN GROUP ' : ''}${d.row.source} ${d.row.id}: js ${JSON.stringify(d.js)} vs sql ${JSON.stringify(d.row.source === 'MEETUP' ? d.row.sql_urlname : d.row.sql_organizer)}`
      );
    // Any normalization difference fails, matched or not: an unmatched row today can be a group's
    // event tomorrow, and the prefilter would silently drop it.
    if (differing.length || normalizationDiffs.length) failed = true;
    console.log(failed ? '\nFAILED' : '\nOK');

    if (apply)
      console.log(
        '\n/groups pages refresh within an hour (their cache revalidates hourly; scripts cannot call revalidateTag).'
      );
  } finally {
    await sql.end();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
