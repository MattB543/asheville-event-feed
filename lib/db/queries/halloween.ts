import { unstable_cache } from 'next/cache';
import { and, gte, ilike, inArray, isNull, lte, notIlike, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { liveEvent } from '@/lib/db/liveEvent';
import { getDayBoundariesEastern } from '@/lib/utils/timezone';

// An event is on the page when it has the "Halloween" tag, which the AI gives it when
// enriching (and `scripts/tag-halloween.ts` backfills), so the page and its "See all"
// link (`tagsInclude=Halloween`) cover the same events. Until the AI has tagged a new
// event, these title words stand in, matched at the start of a word so "Witches" counts
// and "Switchyard" doesn't
const HALLOWEEN_TITLE =
  '\\m(hallowe|spook|haunt|zombie|costume|ghost|witch|monster|vampire|horror|nosferatu|goth|dracula|creep|seance|séance|masquerade|day of the dead|muertos|trick.or.treat|boo\\M)';

// What the page shows of an event, shared by the automatic picks and the hand-added ones
const HALLOWEEN_COLUMNS = {
  id: events.id,
  title: events.title,
  startDate: events.startDate,
  timeUnknown: events.timeUnknown,
  location: events.location,
  organizer: events.organizer,
  price: events.price,
  imageUrl: events.imageUrl,
  tags: events.tags,
  aiSummary: events.aiSummary,
};

export type HalloweenEvent = Awaited<ReturnType<typeof getHalloweenEvents>>[number];

export type HalloweenAudience = 'wild' | 'family';

/**
 * Halloween events between two instants. The default is the strange and the
 * after-dark, wildest first, with family events left out; `family` is the reverse,
 * only family events, best-scored first.
 */
export async function getHalloweenEvents(from: Date, to: Date, audience: HalloweenAudience) {
  const family = sql`'Family' = ANY(COALESCE(${events.tags}, '{}'))`;
  return db
    .select(HALLOWEEN_COLUMNS)
    .from(events)
    .where(
      and(
        liveEvent,
        gte(events.startDate, from),
        lte(events.startDate, to),
        // In person only, as in the feed and Top 30
        or(
          isNull(events.location),
          and(notIlike(events.location, '%online%'), notIlike(events.location, '%virtual%'))
        ),
        sql`('Halloween' = ANY(COALESCE(${events.tags}, '{}'))
          OR (COALESCE(cardinality(${events.tags}), 0) = 0 AND ${events.title} ~* ${HALLOWEEN_TITLE}))`,
        audience === 'family' ? family : sql`NOT ${family}`
      )
    )
    .orderBy(
      ...(audience === 'family' ? [] : [sql`${events.scoreAshevilleWeird} DESC NULLS LAST`]),
      sql`${events.score} DESC NULLS LAST`,
      events.startDate,
      // Ties can't trade places across the per-day and poster cutoffs
      events.id
    )
    .limit(300);
}

// Bump when the cached rows' shape or the filter changes: Vercel's data cache survives deploys
const HALLOWEEN_CACHE_SHAPE = 'v3';

/**
 * From the start of `today` (Eastern) through Oct 31, cached per day and view. The
 * scrape job's `events` invalidation refreshes it, so new events show after each scrape.
 */
export async function getCachedHalloweenEvents(
  today: string,
  audience: HalloweenAudience
): Promise<HalloweenEvent[]> {
  const rows = await unstable_cache(
    () =>
      getHalloweenEvents(
        getDayBoundariesEastern(today).start,
        getDayBoundariesEastern(`${today.slice(0, 4)}-10-31`).end,
        audience
      ),
    ['halloween-events', HALLOWEEN_CACHE_SHAPE, today, audience],
    { tags: ['events'], revalidate: 3600 }
  )();
  // A cache hit comes back through JSON, dates as strings
  return rows.map((row) => ({ ...row, startDate: new Date(row.startDate) }));
}

/** Live events by id, for the ones an admin added to the wall by hand */
export async function getEventsForWall(ids: string[]): Promise<HalloweenEvent[]> {
  if (ids.length === 0) return [];
  return db
    .select(HALLOWEEN_COLUMNS)
    .from(events)
    .where(and(liveEvent, inArray(events.id, ids)));
}

/** Admin search: live events between two instants whose title has the words typed */
export async function searchEventsBetween(query: string, from: Date, to: Date) {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return [];
  return db
    .select({
      id: events.id,
      title: events.title,
      startDate: events.startDate,
      location: events.location,
    })
    .from(events)
    .where(
      and(
        liveEvent,
        gte(events.startDate, from),
        lte(events.startDate, to),
        ...words.map((word) => ilike(events.title, `%${word.replace(/[%_\\]/g, '\\$&')}%`))
      )
    )
    .orderBy(events.startDate)
    .limit(12);
}
