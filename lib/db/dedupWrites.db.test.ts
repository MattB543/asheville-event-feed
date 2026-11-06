import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './index';
import { events } from './schema';
import { applyDuplicateGroup } from './dedupWrites';

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
});
