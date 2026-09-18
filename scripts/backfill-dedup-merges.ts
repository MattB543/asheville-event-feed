/**
 * Recover data that dedup discarded before it merged anything but descriptions.
 *
 * Until the `mergeFields` step landed in `lib/utils/deduplication.ts`, dedup
 * picked a winner and soft-deleted the rest, keeping only the longest
 * description. Where the winner's source had no poster and a discarded sibling
 * did - Mountain Xpress listings of venue shows, mostly - the image was lost.
 *
 * Dedup does not record which row a duplicate merged into, so this rematches
 * on exact title + exact start, which is far stricter than the rules that
 * created the group. That means it recovers only the unambiguous cases and can
 * miss some; it cannot pull data across two genuinely different events.
 *
 * This writes straight to the DB, outside any Next.js request, so it cannot
 * call `revalidateTag`. The recovered images appear on the site after the next
 * cron run invalidates the `events` tag - within a few hours.
 *
 * Usage:
 *   npx tsx scripts/backfill-dedup-merges.ts          # dry run
 *   npx tsx scripts/backfill-dedup-merges.ts --apply
 */
import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { hasRealEventImage } from '../lib/utils/eventImages';

interface Candidate {
  live_id: string;
  live_source: string;
  title: string;
  start_date: Date;
  live_image_url: string | null;
  live_price: string | null;
  live_zip: string | null;
  dup_source: string;
  dup_image_url: string | null;
  dup_price: string | null;
  dup_zip: string | null;
}

async function main() {
  const apply = process.argv.includes('--apply');

  // One row per (live event, discarded sibling). Ordered so the chosen sibling
  // is deterministic, matching mergeFields' id ordering.
  const rows = (await db.execute(sql`
    SELECT live.id          AS live_id,
           live.source      AS live_source,
           live.title       AS title,
           live.start_date  AS start_date,
           live.image_url   AS live_image_url,
           live.price       AS live_price,
           live.zip         AS live_zip,
           dead.source      AS dup_source,
           dead.image_url   AS dup_image_url,
           dead.price       AS dup_price,
           dead.zip         AS dup_zip
    FROM events live
    JOIN events dead
      ON dead.title = live.title
     AND dead.start_date = live.start_date
     AND dead.id <> live.id
     AND dead.deduped_at IS NOT NULL
    WHERE live.deduped_at IS NULL
      AND live.dead_at IS NULL
      AND (live.hidden IS NULL OR live.hidden = false)
      AND live.start_date > now()
    ORDER BY live.id, dead.id
  `)) as unknown as Candidate[];

  // Collapse to one update per live event: first sibling (in id order) that
  // fills each gap wins, exactly as mergeFields does going forward.
  const updates = new Map<string, { fields: Record<string, unknown>; note: string[] }>();

  for (const row of rows) {
    const entry = updates.get(row.live_id) ?? { fields: {}, note: [] };

    if (
      entry.fields.imageUrl === undefined &&
      !hasRealEventImage(row.live_image_url) &&
      hasRealEventImage(row.dup_image_url)
    ) {
      entry.fields.imageUrl = row.dup_image_url;
      entry.note.push(`image from ${row.dup_source}`);
    }
    const livePriceMissing = !row.live_price || row.live_price === 'Unknown';
    const dupHasPrice = !!row.dup_price && row.dup_price !== 'Unknown';
    if (entry.fields.price === undefined && livePriceMissing && dupHasPrice) {
      entry.fields.price = row.dup_price;
      entry.note.push(`price ${row.dup_price} from ${row.dup_source}`);
    }
    if (entry.fields.zip === undefined && !row.live_zip?.trim() && row.dup_zip?.trim()) {
      entry.fields.zip = row.dup_zip;
      entry.note.push(`zip ${row.dup_zip} from ${row.dup_source}`);
    }

    if (Object.keys(entry.fields).length > 0) {
      updates.set(row.live_id, entry);
    }
  }

  console.log(
    `Found ${updates.size} live upcoming events with data recoverable from a discarded duplicate.\n`
  );

  const bySource: Record<string, number> = {};
  for (const [id, entry] of updates) {
    const row = rows.find((r) => r.live_id === id)!;
    bySource[row.live_source] = (bySource[row.live_source] || 0) + 1;
    console.log(`  [${row.live_source}] "${row.title.slice(0, 55)}" (${id.slice(0, 8)})`);
    console.log(`      ${entry.note.join('; ')}`);
  }
  console.log();
  console.table(bySource);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write these changes.');
    process.exit(0);
  }

  let applied = 0;
  for (const [id, entry] of updates) {
    await db.update(events).set(entry.fields).where(eq(events.id, id));
    applied++;
  }
  console.log(`\nApplied ${applied} updates.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
