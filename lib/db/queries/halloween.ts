import { and, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { liveEvent } from '@/lib/db/liveEvent';

// Words that mark a Halloween-season event in a title; a summary that says
// "Halloween" counts too, since titles like "AFTER DARK" don't
const HALLOWEEN_TITLE =
  'hallowe|spook|haunt|zombie|costume|ghost|witch|monster|vampire|horror|nosferatu|\\mgoth|dracula|creep|seance|séance|masquerade|day of the dead|muertos|trick.or.treat|\\mboo\\M';

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
        sql`(${events.title} ~* ${HALLOWEEN_TITLE} OR ${events.aiSummary} ~* 'halloween')`,
        audience === 'family' ? family : sql`NOT ${family}`
      )
    )
    .orderBy(
      ...(audience === 'family' ? [] : [sql`${events.scoreAshevilleWeird} DESC NULLS LAST`]),
      sql`${events.score} DESC NULLS LAST`,
      events.startDate
    )
    .limit(300);
}
