import { unstable_cache } from 'next/cache';
import { and, gte, isNull, lte, notIlike, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { liveEvent } from '@/lib/db/liveEvent';
import { getDayBoundariesEastern } from '@/lib/utils/timezone';

// Words that mark a Halloween-season event in a title, matched at the start of a word so
// "Witches" counts and "Switchyard" doesn't; a summary that says "Halloween" counts too
const HALLOWEEN_TITLE =
  '\\m(hallowe|spook|haunt|zombie|costume|ghost|witch|monster|vampire|horror|nosferatu|goth|dracula|creep|seance|séance|masquerade|day of the dead|muertos|trick.or.treat|boo\\M)';

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
    .select({
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
    })
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
        sql`(${events.title} ~* ${HALLOWEEN_TITLE} OR ${events.aiSummary} ~* 'halloween')`,
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
const HALLOWEEN_CACHE_SHAPE = 'v2';

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
