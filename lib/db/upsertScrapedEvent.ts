import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from './index';
import { events } from './schema';
import type { ScrapedEvent } from '@/lib/scrapers/types';
import type { LockedField } from '@/lib/events/edits';
import { FACEBOOK_CDN_LIKE, FACEBOOK_COPY_LIKE } from '@/lib/utils/eventImages';

/** Saves one scraped event by its URL. `inserted` is false when the URL was already stored. */
export async function upsertScrapedEvent(event: ScrapedEvent): Promise<{ inserted: boolean }> {
  // A different title on an existing URL is a different event there
  // (Mountain Xpress reuses event URLs; AVL Today links shared by
  // several listings rotate). Everything learned about the old one -
  // its description, price, image, AI enrichment, verification and
  // dead-link verdicts - is dropped so the new one is shown and
  // processed afresh. Manual moderation (hidden, score overrides)
  // stays. Date changes alone don't count: rolling events move their
  // date every run.
  // An admin-edited title is compared as the source had it.
  const newEvent = sql`COALESCE(${events.editedFields} ->> 'title', ${events.title}) IS DISTINCT FROM ${event.title}::text`;
  const unlessNewEvent = (column: AnyPgColumn, fresh: SQL = sql`NULL`) =>
    sql`CASE WHEN ${newEvent} THEN ${fresh} ELSE ${column} END`;
  // A duplicate verdict was about the old title and start time. When either
  // changes (a reschedule, or a new event on the URL), the row is live again
  // and this run's dedup pass judges it afresh; if it still matches a row, it
  // is removed again. Otherwise a rescheduled event stays hidden behind a
  // stale copy that never moved.
  const dedupStale = sql`${newEvent} OR ${events.startDate} IS DISTINCT FROM ${event.startDate.toISOString()}::timestamptz`;
  // A field an admin edited stays as they left it, until a new event takes the URL
  const unlessEdited = (field: LockedField, column: AnyPgColumn, scraped: SQL) =>
    sql`CASE WHEN NOT (${newEvent}) AND ${events.editedFields} -> ${field}::text IS NOT NULL THEN ${column} ELSE ${scraped} END`;
  const [row] = await db
    .insert(events)
    .values({
      sourceId: event.sourceId,
      source: event.source,
      title: event.title,
      description: event.description,
      startDate: event.startDate,
      location: event.location,
      zip: event.zip,
      organizer: event.organizer,
      price: event.price,
      url: event.url,
      imageUrl: event.imageUrl,
      tags: [], // Empty tags - AI job will populate
      interestedCount: event.interestedCount,
      goingCount: event.goingCount,
      timeUnknown: event.timeUnknown || false,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: events.url,
      set: {
        title: unlessEdited('title', events.title, sql`${event.title}::text`),
        // Keep the longer description — the verify cron fills thin
        // descriptions, so a raw re-scrape must not overwrite that with
        // shorter text
        description: sql`CASE WHEN ${newEvent} OR length(coalesce(${event.description ?? null}::text, '')) > length(coalesce(${events.description}, '')) THEN ${event.description ?? null}::text ELSE ${events.description} END`,
        startDate: event.startDate,
        // Moves with startDate, so a placeholder time never reads as a real one (or
        // the reverse). Many scrapers never set it; their undefined keeps the row's value.
        timeUnknown: sql`COALESCE(${event.timeUnknown ?? null}::boolean, ${events.timeUnknown})`,
        location: unlessEdited(
          'location',
          events.location,
          sql`COALESCE(NULLIF(trim(${event.location ?? null}::text), ''), ${events.location})`
        ),
        zip: sql`COALESCE(NULLIF(trim(${event.zip ?? null}::text), ''), ${events.zip})`,
        organizer: sql`COALESCE(NULLIF(trim(${event.organizer ?? null}::text), ''), ${events.organizer})`,
        // Don't let a null/Unknown scrape clobber a verified price
        price: unlessEdited(
          'price',
          events.price,
          sql`CASE WHEN ${newEvent} THEN ${event.price ?? null}::text WHEN NULLIF(trim(${event.price ?? null}::text), '') IS NULL OR lower(trim(${event.price ?? null}::text)) = 'unknown' THEN COALESCE(${events.price}, ${event.price ?? null}::text) ELSE ${event.price ?? null}::text END`
        ),
        imageUrl: unlessEdited(
          'imageUrl',
          events.imageUrl,
          // Our copy of a Facebook image outlasts the fresh Facebook link, which expires in weeks
          sql`CASE WHEN ${newEvent} THEN NULLIF(trim(${event.imageUrl ?? null}::text), '') WHEN ${events.imageUrl} LIKE ${FACEBOOK_COPY_LIKE} AND ${event.imageUrl ?? null}::text LIKE ${FACEBOOK_CDN_LIKE} THEN ${events.imageUrl} ELSE COALESCE(NULLIF(trim(${event.imageUrl ?? null}::text), ''), ${events.imageUrl}) END`
        ),
        interestedCount: event.interestedCount,
        goingCount: event.goingCount,
        lastSeenAt: new Date(),
        // Tags are otherwise NOT updated on conflict - preserves AI-generated tags
        tags: unlessNewEvent(events.tags, sql`'{}'::text[]`),
        aiSummary: unlessNewEvent(events.aiSummary),
        embedding: unlessNewEvent(events.embedding),
        score: unlessNewEvent(events.score),
        scoreRarity: unlessNewEvent(events.scoreRarity),
        scoreUnique: unlessNewEvent(events.scoreUnique),
        scoreMagnitude: unlessNewEvent(events.scoreMagnitude),
        scoreReason: unlessNewEvent(events.scoreReason),
        scoreAshevilleWeird: unlessNewEvent(events.scoreAshevilleWeird),
        scoreSocial: unlessNewEvent(events.scoreSocial),
        aiAttempts: unlessNewEvent(events.aiAttempts, sql`0`),
        aiNextAttemptAt: unlessNewEvent(events.aiNextAttemptAt),
        lastVerifiedAt: unlessNewEvent(events.lastVerifiedAt),
        verifyAttempts: unlessNewEvent(events.verifyAttempts, sql`0`),
        verifyNextAttemptAt: unlessNewEvent(events.verifyNextAttemptAt),
        // The scraper just saw this URL live with a new event on it
        deadAt: unlessNewEvent(events.deadAt),
        dedupedAt: sql`CASE WHEN ${dedupStale} THEN NULL ELSE ${events.dedupedAt} END`,
        editedFields: sql`CASE WHEN ${newEvent} THEN '{}'::jsonb ELSE ${events.editedFields} END`,
      },
    })
    // xmax = 0 only for a freshly inserted row; on the update path it holds
    // the locking transaction id. Costs no extra round trip.
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return { inserted: row?.inserted ?? false };
}
