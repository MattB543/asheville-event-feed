import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './index';
import { events } from './schema';
import { applyDuplicateGroup, softDeleteDuplicates } from './dedupWrites';

const START = new Date('2026-11-07T00:00:00Z');

async function insert(url: string, values: Partial<typeof events.$inferInsert>) {
  const [row] = await db
    .insert(events)
    .values({
      sourceId: url,
      source: 'AVL_TODAY',
      title: 'Bluegrass Jam',
      startDate: START,
      url,
      ...values,
    })
    .returning();
  return row;
}

describe('merging a duplicate into the row that stays', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE events CASCADE`);
  });

  it('fills gaps, except fields an admin edited', async () => {
    // The admin cleared a wrong price; the copy being removed still has one
    const keep = await insert('https://example.com/a', {
      price: null,
      location: null,
      editedFields: { price: '$99' },
    });
    const remove = await insert('https://example.com/b', {
      price: '$15',
      location: 'Jack of the Wood',
    });

    await applyDuplicateGroup({ keep, remove: [remove], method: 'test' }, new Date());

    const [row] = await db.select().from(events).where(eq(events.id, keep.id));
    expect(row.price).toBeNull();
    expect(row.location).toBe('Jack of the Wood');
  });

  it('never removes a row an admin edited, and takes nothing from it', async () => {
    const keep = await insert('https://example.com/a', { price: null });
    const edited = await insert('https://example.com/b', {
      price: 'Free',
      editedFields: { price: '$10' },
    });
    const plain = await insert('https://example.com/c', { location: 'Jack of the Wood' });

    const result = await applyDuplicateGroup(
      { keep, remove: [edited, plain], method: 'test' },
      new Date()
    );

    expect(result.removed).toBe(1);
    const stored = async (id: string) =>
      (await db.select().from(events).where(eq(events.id, id)))[0];
    expect((await stored(edited.id)).dedupedAt).toBeNull();
    expect((await stored(plain.id)).dedupedAt).not.toBeNull();
    const kept = await stored(keep.id);
    expect(kept.price).toBeNull();
    expect(kept.location).toBe('Jack of the Wood');
  });

  it('leaves an edited row alone when the AI dedup names it', async () => {
    const edited = await insert('https://example.com/a', { editedFields: { price: '$10' } });
    const plain = await insert('https://example.com/b', {});

    expect(await softDeleteDuplicates([edited, plain], new Date())).toBe(1);
    const [row] = await db.select().from(events).where(eq(events.id, edited.id));
    expect(row.dedupedAt).toBeNull();
  });
});
