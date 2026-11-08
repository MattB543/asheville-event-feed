import { and, eq, or, sql } from 'drizzle-orm';
import { db } from './index';
import { events } from './schema';
import { liveEvent } from './liveEvent';
import { mergeFields, type DuplicateGroup, type MergedFields } from '@/lib/utils/deduplication';
import { editedList } from '@/lib/events/edits';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** What a dedup pass saw of a row when it judged it. */
interface JudgedRow {
  id: string;
  title: string;
  startDate: Date;
}

/**
 * Dedup judges a snapshot of the table and writes later, and a scrape can change
 * a row in between: a reschedule clears its `dedupedAt` so it is judged again.
 * A write therefore applies only to a row that is still live, still eligible for
 * dedup and still has the title and start time it was judged on. A row that
 * changed is left for the next pass.
 */
function unchangedSince(row: JudgedRow) {
  return and(
    eq(events.id, row.id),
    eq(events.title, row.title),
    eq(events.startDate, row.startDate),
    liveEvent,
    sql`${events.dedupSkip} IS NOT TRUE`
  )!;
}

/**
 * Returns the ids actually soft-deleted. A row an admin edited is never removed: the copy left
 * behind wouldn't have the correction, and a visible duplicate beats losing it.
 */
async function softDeleteUnchanged(
  writer: Tx | typeof db,
  rows: JudgedRow[],
  dedupedAt: Date
): Promise<string[]> {
  if (rows.length === 0) return [];
  const removed = await writer
    .update(events)
    .set({ dedupedAt })
    .where(and(or(...rows.map(unchangedSince)), sql`${events.editedFields} = '{}'::jsonb`))
    .returning({ id: events.id });
  return removed.map((r) => r.id);
}

/**
 * Soft-delete a rule-based duplicate group's losers and merge their salvaged
 * fields into its winner, in one transaction. Skipped whole when the winner
 * changed since it was judged (its losers may no longer match it). The merge is
 * recomputed from the winner as it is now and only the losers actually removed,
 * so a loser left alone donates nothing and a value written to the winner
 * mid-run isn't overwritten. Returns what was merged, if anything.
 */
export async function applyDuplicateGroup(
  group: DuplicateGroup,
  dedupedAt: Date
): Promise<{ removed: number; merged?: MergedFields }> {
  return db.transaction(async (tx) => {
    const [keeper] = await tx
      .select({
        id: events.id,
        title: events.title,
        organizer: events.organizer,
        location: events.location,
        startDate: events.startDate,
        price: events.price,
        description: events.description,
        createdAt: events.createdAt,
        source: events.source,
        zip: events.zip,
        imageUrl: events.imageUrl,
        interestedCount: events.interestedCount,
        goingCount: events.goingCount,
        editedFields: events.editedFields,
      })
      .from(events)
      .where(unchangedSince(group.keep))
      .for('update');
    if (!keeper) return { removed: 0 };

    const removedIds = new Set(await softDeleteUnchanged(tx, group.remove, dedupedAt));
    const merged = mergeFields(
      keeper,
      group.remove.filter((e) => removedIds.has(e.id))
    );
    // A field an admin edited stays as they left it, even emptied
    for (const field of editedList(keeper.editedFields)) {
      if (merged && field in merged) delete merged[field as keyof MergedFields];
    }
    if (!merged || Object.keys(merged).length === 0) return { removed: removedIds.size };
    await tx.update(events).set(merged).where(eq(events.id, keeper.id));
    return { removed: removedIds.size, merged };
  });
}

/** Soft-delete duplicates the AI dedup found (it names no winner). One UPDATE, so no transaction. */
export async function softDeleteDuplicates(rows: JudgedRow[], dedupedAt: Date): Promise<number> {
  return (await softDeleteUnchanged(db, rows, dedupedAt)).length;
}
