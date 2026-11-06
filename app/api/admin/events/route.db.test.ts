import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const VISITOR = '22222222-2222-4222-8222-222222222222';
let signedIn: string | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () => Promise.resolve({ data: { user: signedIn ? { id: signedIn } : null } }),
      },
    }),
}));
vi.mock('@/lib/cache/invalidation', () => ({ invalidateEventsCache: () => {} }));

const { GET, POST } = await import('./route');

const post = (body: object) =>
  POST(
    new NextRequest('http://localhost/api/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
const read = (eventId: string) =>
  GET(new NextRequest(`http://localhost/api/admin/events?eventId=${eventId}`));

describe('admin event edits', () => {
  let eventId: string;

  beforeEach(async () => {
    process.env.SUPER_ADMIN = `${ADMIN}, 33333333-3333-4333-8333-333333333333`;
    signedIn = ADMIN;
    await db.execute(sql`TRUNCATE events CASCADE`);
    const [row] = await db
      .insert(events)
      .values({
        sourceId: 'jam',
        source: 'AVL_TODAY',
        title: 'Bluegrass Jam',
        startDate: new Date('2026-11-07T00:00:00Z'),
        url: 'https://example.com/jam',
        price: '$10',
        location: 'Jack of the Wood',
      })
      .returning({ id: events.id });
    eventId = row.id;
  });

  it('turns away signed-out visitors and non-admins', async () => {
    signedIn = null;
    expect((await post({ eventId, hidden: true })).status).toBe(401);
    expect((await read(eventId)).status).toBe(401);
    signedIn = VISITOR;
    expect((await post({ eventId, hidden: true })).status).toBe(403);
    expect((await read(eventId)).status).toBe(403);
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row.hidden).toBe(false);
  });

  it('lets anyone on the admin list in', async () => {
    signedIn = '33333333-3333-4333-8333-333333333333';
    expect((await read(eventId)).status).toBe(200);
  });

  it('records the first value of each edited field, and Undo puts it back', async () => {
    await post({ eventId, edit: { price: '$12' } });
    await post({ eventId, edit: { price: 'Free', title: 'Bluegrass Jam (Upstairs)' } });
    const edited = (await (await read(eventId)).json()) as { values: unknown; edited: unknown };
    expect(edited.values).toEqual({
      title: 'Bluegrass Jam (Upstairs)',
      location: 'Jack of the Wood',
      price: 'Free',
    });
    expect(edited.edited).toEqual(['title', 'price']);

    await post({ eventId, undo: true });
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row.title).toBe('Bluegrass Jam');
    expect(row.price).toBe('$10');
    expect(row.editedFields).toEqual({});
  });

  it('Undo empties a field that was empty before the edit', async () => {
    await db.update(events).set({ price: null }).where(eq(events.id, eventId));
    await post({ eventId, edit: { price: '$12' } });
    await post({ eventId, undo: true });
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row.price).toBeNull();
  });

  it('refuses an empty title', async () => {
    expect((await post({ eventId, edit: { title: '  ' } })).status).toBe(400);
  });

  it('answers a malformed request with 400, not a server error', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      })
    );
    expect(response.status).toBe(400);
  });
});
