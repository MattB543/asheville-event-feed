import { and, desc, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { liveEvent } from '@/lib/db/liveEvent';

// Words that mark a Halloween-season event in a title; a summary that says
// "Halloween" counts too, since titles like "AFTER DARK" don't
const HALLOWEEN_TITLE =
  'hallowe|spook|haunt|zombie|costume|ghost|witch|monster|vampire|horror|nosferatu|\\mgoth|dracula|creep|seance|séance|masquerade|day of the dead|muertos|trick.or.treat|\\mboo\\M';

export type HalloweenEvent = Awaited<ReturnType<typeof getHalloweenEvents>>[number];

/**
 * Halloween events between two instants, weirdest first. Family events are left
 * out: the page is for the strange and the after-dark, not trick-or-treating.
 */
export async function getHalloweenEvents(from: Date, to: Date) {
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
      weird: events.scoreAshevilleWeird,
    })
    .from(events)
    .where(
      and(
        liveEvent,
        gte(events.startDate, from),
        lte(events.startDate, to),
        sql`(${events.title} ~* ${HALLOWEEN_TITLE} OR ${events.aiSummary} ~* 'halloween')`,
        sql`NOT ('Family' = ANY(COALESCE(${events.tags}, '{}')))`
      )
    )
    .orderBy(
      sql`${events.scoreAshevilleWeird} DESC NULLS LAST`,
      desc(events.score),
      events.startDate
    )
    .limit(300);
}
