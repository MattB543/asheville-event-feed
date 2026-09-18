/**
 * Group discovery helper: dump the full event records behind one or more units so an evidence
 * agent can read complete descriptions, locations, prices and dates instead of the 600-char snippet.
 *
 * Run: npx tsx scripts/groups/show-units.ts <index> [<index> ...]
 *      npx tsx scripts/groups/show-units.ts 412 413 --max 5     (full detail for the 5 most recent events per unit)
 */
import '../../lib/config/env';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Unit } from './build-buckets';

const DEFAULT_MAX_DETAILED = 4;

async function main() {
  const args = process.argv.slice(2);
  const maxFlag = args.indexOf('--max');
  const maxDetailed = maxFlag >= 0 ? Number(args[maxFlag + 1]) : DEFAULT_MAX_DETAILED;
  const indices = args
    .filter((_, i) => !(i === maxFlag || i === maxFlag + 1))
    .map(Number)
    .filter((n) => Number.isInteger(n));
  if (!indices.length) {
    console.error('usage: npx tsx scripts/groups/show-units.ts <index> [<index> ...] [--max N]');
    process.exit(1);
  }

  const { units } = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'groups', 'units.json'), 'utf8')
  ) as {
    units: Unit[];
  };
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  for (const index of indices) {
    const unit = units[index];
    if (!unit || unit.index !== index) {
      console.log(`\n##### unit ${index}: not found\n`);
      continue;
    }
    const rows = await sql.unsafe(
      `SELECT id::text, source, title, start_date, location, zip, organizer, price, url, tags, ai_summary, description,
              interested_count, going_count
       FROM events WHERE id = ANY($1::uuid[]) ORDER BY start_date DESC`,
      [unit.event_ids ?? []]
    );

    console.log(`\n${'#'.repeat(100)}`);
    console.log(`##### unit ${index}: "${unit.title}"  organizer: ${unit.organizer ?? '(none)'}`);
    console.log(
      `##### ${unit.count} events, ${unit.cadence} (median gap ${unit.median_gap_days}d), ${unit.first_seen} -> ${unit.last_seen}, sources ${unit.sources.join(', ')}`
    );
    console.log(
      `##### all dates: ${rows
        .map((r) => new Date(r.start_date).toISOString().slice(0, 10))
        .reverse()
        .join(' ')}`
    );

    const titles = new Set(rows.map((r) => r.title));
    if (titles.size > 1)
      console.log(`##### title variants: ${[...titles].map((t) => JSON.stringify(t)).join(' | ')}`);
    const locations = new Set(rows.map((r) => r.location).filter(Boolean));
    console.log(`##### locations: ${[...locations].join(' | ') || '(none)'}`);
    const prices = new Set(rows.map((r) => r.price).filter(Boolean));
    console.log(`##### prices: ${[...prices].join(' | ') || '(none)'}`);
    const tags = new Set(rows.flatMap((r) => r.tags ?? []));
    console.log(`##### tags: ${[...tags].join(', ') || '(none)'}`);

    for (const r of rows.slice(0, maxDetailed)) {
      console.log(`\n--- ${new Date(r.start_date).toISOString()}  [${r.source}]  ${r.url}`);
      if (r.interested_count || r.going_count)
        console.log(
          `    facebook: ${r.interested_count ?? 0} interested, ${r.going_count ?? 0} going`
        );
      if (r.ai_summary) console.log(`    summary: ${r.ai_summary}`);
      const desc = (r.description ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
      console.log(`    description: ${desc || '(none)'}`);
    }
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
