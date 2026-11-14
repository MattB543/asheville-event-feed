import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './index';
import { events } from './schema';
import { upsertScrapedEvent } from './upsertScrapedEvent';
import type { ScrapedEvent } from '@/lib/scrapers/types';

const URL = 'https://example.com/events/bluegrass-jam';
const scraped = (over: Partial<ScrapedEvent> = {}): ScrapedEvent => ({
  sourceId: 'bluegrass-jam',
  source: 'AVL_TODAY',
  title: 'Bluegrass Jam',
  description: 'Bring an instrument.',
  startDate: new Date('2026-11-07T00:00:00Z'),
  location: 'Jack of the Wood, Asheville, NC',
  price: '$10',
  url: URL,
  imageUrl: 'https://example.com/poster.jpg',
  ...over,
});
const stored = async () => (await db.select().from(events).where(eq(events.url, URL)))[0];

describe('saving a scraped event', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE events CASCADE`);
  });

  it('inserts a new URL, then updates it on the next scrape', async () => {
    expect(await upsertScrapedEvent(scraped())).toEqual({ inserted: true });
    expect(await upsertScrapedEvent(scraped({ location: 'New Venue' }))).toEqual({
      inserted: false,
    });
    expect((await stored()).location).toBe('New Venue');
  });

  it('keeps a known price when the source drops to Unknown, and the longer description', async () => {
    await upsertScrapedEvent(scraped({ description: 'A long, full description of the jam.' }));
    await upsertScrapedEvent(scraped({ price: 'Unknown', description: 'Short.' }));
    const row = await stored();
    expect(row.price).toBe('$10');
    expect(row.description).toBe('A long, full description of the jam.');
  });

  it('keeps what an admin edited through later scrapes', async () => {
    await upsertScrapedEvent(scraped());
    await db
      .update(events)
      .set({
        title: 'Bluegrass Jam (Upstairs)',
        price: 'Free',
        editedFields: { title: 'Bluegrass Jam', price: '$10' },
      })
      .where(eq(events.url, URL));

    await upsertScrapedEvent(scraped({ price: '$12', location: 'Moved Venue' }));
    const row = await stored();
    expect(row.title).toBe('Bluegrass Jam (Upstairs)');
    expect(row.price).toBe('Free');
    expect(row.location).toBe('Moved Venue');
    expect(row.editedFields).toEqual({ title: 'Bluegrass Jam', price: '$10' });
  });

  it('treats a new title on the URL as a new event: edits and AI work are dropped', async () => {
    await upsertScrapedEvent(scraped());
    await db
      .update(events)
      .set({
        title: 'Edited',
        editedFields: { title: 'Bluegrass Jam' },
        tags: ['Live Music'],
        score: 20,
      })
      .where(eq(events.url, URL));

    await upsertScrapedEvent(scraped({ title: 'Open Mic Night', price: '$5' }));
    const row = await stored();
    expect(row.title).toBe('Open Mic Night');
    expect(row.price).toBe('$5');
    expect(row.editedFields).toEqual({});
    expect(row.tags).toEqual([]);
    expect(row.score).toBeNull();
  });

  it('keeps our copy of a Facebook image over the fresh Facebook link', async () => {
    const fb = 'https://scontent-atl3-2.xx.fbcdn.net/v/poster.jpg?oe=6A000000';
    const copy = 'https://x.supabase.co/storage/v1/object/public/event-images/facebook/1.jpg?v=1';
    await upsertScrapedEvent(scraped({ imageUrl: fb }));
    await db.update(events).set({ imageUrl: copy }).where(eq(events.url, URL));

    await upsertScrapedEvent(scraped({ imageUrl: fb.replace('poster', 'fresh') }));
    expect((await stored()).imageUrl).toBe(copy);
    // A new event on the URL brings its own image
    await upsertScrapedEvent(scraped({ title: 'Open Mic Night', imageUrl: fb }));
    expect((await stored()).imageUrl).toBe(fb);
  });

  it('lets a rescheduled duplicate be judged again', async () => {
    await upsertScrapedEvent(scraped());
    await db.update(events).set({ dedupedAt: new Date() }).where(eq(events.url, URL));

    await upsertScrapedEvent(scraped());
    expect((await stored()).dedupedAt).not.toBeNull();

    await upsertScrapedEvent(scraped({ startDate: new Date('2026-11-14T00:00:00Z') }));
    expect((await stored()).dedupedAt).toBeNull();
  });
});
