import { unstable_cache } from 'next/cache';
import { and, gte, ilike, inArray, isNull, lte, notIlike, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { liveEvent } from '@/lib/db/liveEvent';
import { getDayBoundariesEastern } from '@/lib/utils/timezone';
import type { Holiday } from './config';

// What the page shows of an event, shared by the automatic picks and the hand-added ones
const HOLIDAY_COLUMNS = {
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

export type HolidayEvent = Awaited<ReturnType<typeof getHolidayEvents>>[number];

/** `all` for a holiday with one view; Halloween splits into After dark (`wild`) and Family */
export type HolidayAudience = 'all' | 'wild' | 'family';

/**
 * A holiday's events between two instants, best first. Halloween's After dark is ranked by
 * how weird each one is and leaves family events out; its Family view is only those.
 */
export async function getHolidayEvents(
  holiday: Holiday,
  from: Date,
  to: Date,
  audience: HolidayAudience
) {
  const family = sql`'Family' = ANY(COALESCE(${events.tags}, '{}'))`;
  return db
    .select(HOLIDAY_COLUMNS)
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
        sql`(${holiday.tag} = ANY(COALESCE(${events.tags}, '{}'))
          OR (COALESCE(cardinality(${events.tags}), 0) = 0 AND ${events.title} ~* ${holiday.titleWords}))`,
        holiday.minScore === undefined ? undefined : gte(events.score, holiday.minScore),
        audience === 'family' ? family : audience === 'wild' ? sql`NOT ${family}` : undefined
      )
    )
    .orderBy(
      ...(audience === 'wild' ? [sql`${events.scoreAshevilleWeird} DESC NULLS LAST`] : []),
      sql`${events.score} DESC NULLS LAST`,
      events.startDate,
      // Ties can't trade places across the per-day and poster cutoffs
      events.id
    )
    .limit(300);
}

// Bump when the cached rows' shape or the filter changes: Vercel's data cache survives deploys
const HOLIDAY_CACHE_SHAPE = 'v5';

/**
 * From the start of `today` (Eastern) through `lastDay`, cached per day and view. The
 * scrape job's `events` invalidation refreshes it, so new events show after each scrape.
 */
export async function getCachedHolidayEvents(
  holiday: Holiday,
  today: string,
  lastDay: string,
  audience: HolidayAudience
): Promise<HolidayEvent[]> {
  const rows = await unstable_cache(
    () =>
      getHolidayEvents(
        holiday,
        getDayBoundariesEastern(today).start,
        getDayBoundariesEastern(lastDay).end,
        audience
      ),
    ['holiday-events', HOLIDAY_CACHE_SHAPE, holiday.key, today, lastDay, audience],
    { tags: ['events'], revalidate: 3600 }
  )();
  // A cache hit comes back through JSON, dates as strings
  return rows.map((row) => ({ ...row, startDate: new Date(row.startDate) }));
}

/** Live events by id, for the ones an admin added to the wall by hand */
export async function getEventsForWall(ids: string[]): Promise<HolidayEvent[]> {
  if (ids.length === 0) return [];
  return db
    .select(HOLIDAY_COLUMNS)
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
