/**
 * Turn poster extractions into events.
 *
 * Shared by the upload route (safe path) and the admin approve action
 * (deferred path). Idempotent: an extraction whose `outcome` is already set is
 * left alone, so a failed or partial run can simply be re-run.
 *
 * The bias is deliberately toward inserting. A rare duplicate gets soft-deleted
 * by the existing dedup crons, but a poster event that was wrongly matched to
 * an existing row is silently lost.
 */

import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, posterExtractions, posterUploads } from '@/lib/db/schema';
import { generateEmbedding } from '@/lib/ai/embedding';
import { findSimilarByEmbedding, type SimilarEvent } from '@/lib/db/similaritySearch';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { countSharedTitleWords } from '@/lib/utils/deduplication';
import { isNonNCEvent } from '@/lib/utils/geo';
import { generateEventSlug } from '@/lib/utils/slugify';
import { getDayBoundariesEastern, getStartOfTodayEastern } from '@/lib/utils/timezone';
import { getVenueForEvent } from '@/lib/utils/venues';

export type PromotionOutcome =
  | 'created'
  | 'matched_existing'
  | 'skipped_no_date'
  | 'skipped_past'
  | 'skipped_non_nc'
  | 'failed';

export interface PromotedExtraction {
  extractionId: string;
  title: string;
  startDate: Date | null;
  outcome: PromotionOutcome;
  eventId: string | null;
  eventSlug: string | null;
}

export interface PromoteExtractionsResult {
  uploadId: string;
  extractions: PromotedExtraction[];
  /** Rows this call inserted an event for (excludes rows skipped as already-processed) */
  createdCount: number;
}

// Poster event URLs are the unique key in the events table, so they must be
// identical no matter which environment ran the pipeline. Never derive this
// from NEXT_PUBLIC_SITE_URL.
const POSTER_EVENT_URL_ORIGIN = 'https://avlgo.com';

// Candidate retrieval only - a hit here is not proof of duplication, it just
// narrows the field for the explicit confirmation checks below.
const CANDIDATE_MIN_SIMILARITY = 0.75;
const CANDIDATE_LIMIT = 8;
/** Similarity high enough to confirm a duplicate on its own */
const CONFIRM_SIMILARITY = 0.9;
/** Similarity that corroborates a same-venue candidate with no title overlap */
const VENUE_CONFIRM_SIMILARITY = 0.85;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How many extractions may be promoted at once (each can wait on an embedding call) */
const PROMOTION_CONCURRENCY = 4;

type ExtractionRow = typeof posterExtractions.$inferSelect;

/** Eastern-time YYYY-MM-DD key, matching the dedup helpers' day grouping. */
function easternDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Find an existing live event that this extraction is a duplicate of.
 *
 * Embedding search retrieves candidates; a candidate is only accepted when it
 * lands on the same Eastern date AND corroborates through title overlap, venue,
 * or a very high similarity score.
 */
async function findExistingEvent(
  extraction: ExtractionRow,
  startDate: Date
): Promise<SimilarEvent | null> {
  const embedding = await generateEmbedding(
    `${extraction.title} - ${extraction.description ?? ''}`
  );

  // No embedding means no candidate retrieval. Fall through to inserting
  // rather than blocking the poster on an AI outage.
  if (!embedding) {
    console.warn(`[Posters] No embedding for extraction ${extraction.id}; skipping match step`);
    return null;
  }

  const dateKey = easternDateKey(startDate);
  const { start, end } = getDayBoundariesEastern(dateKey);

  const candidates = await findSimilarByEmbedding(embedding, {
    minSimilarity: CANDIDATE_MIN_SIMILARITY,
    // findSimilarByEmbedding ignores its declared futureOnly/orderBy options,
    // so the window has to be passed explicitly.
    startDate: new Date(start.getTime() - DAY_MS),
    endDate: new Date(end.getTime() + DAY_MS),
    limit: CANDIDATE_LIMIT,
  });

  if (candidates.length === 0) return null;

  // ...and it does not filter soft-deleted or hidden rows either.
  const liveRows = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        inArray(
          events.id,
          candidates.map((candidate) => candidate.id)
        ),
        isNull(events.dedupedAt),
        isNull(events.deadAt),
        or(isNull(events.hidden), eq(events.hidden, false))
      )
    );
  const liveIds = new Set(liveRows.map((row) => row.id));

  const posterVenue = getVenueForEvent(extraction.organizer, extraction.location, extraction.title);

  for (const candidate of candidates) {
    if (!liveIds.has(candidate.id)) continue;
    if (easternDateKey(candidate.startDate) !== dateKey) continue;

    const sharedTitleWords = countSharedTitleWords(extraction.title, candidate.title);
    const candidateVenue = getVenueForEvent(
      candidate.organizer,
      candidate.location,
      candidate.title
    );
    const sameVenue = Boolean(posterVenue) && posterVenue === candidateVenue;
    // Venue alone is too weak: two different shows at the same room on the same
    // night would collapse into one and the poster's event would be discarded.
    const venueConfirms =
      sameVenue && (sharedTitleWords >= 1 || candidate.similarity >= VENUE_CONFIRM_SIMILARITY);

    if (sharedTitleWords >= 2 || venueConfirms || candidate.similarity >= CONFIRM_SIMILARITY) {
      console.log(
        `[Posters] Extraction ${extraction.id} matched event ${candidate.id} ` +
          `(similarity ${candidate.similarity.toFixed(3)}, shared words ${sharedTitleWords}, same venue ${sameVenue})`
      );
      return candidate;
    }
  }

  return null;
}

async function promoteOne(
  extraction: ExtractionRow,
  publicImageUrl: string
): Promise<{ outcome: PromotionOutcome; eventId: string | null; created: boolean }> {
  const startDate = extraction.startDate;

  if (!startDate) {
    return { outcome: 'skipped_no_date', eventId: null, created: false };
  }

  if (startDate < getStartOfTodayEastern()) {
    return { outcome: 'skipped_past', eventId: null, created: false };
  }

  // Cleanup's non-NC pass applies this same predicate to these same immutable
  // fields, so anything that passes here passes forever.
  if (isNonNCEvent(extraction.title, extraction.location)) {
    return { outcome: 'skipped_non_nc', eventId: null, created: false };
  }

  const match = await findExistingEvent(extraction, startDate);
  if (match) {
    return { outcome: 'matched_existing', eventId: match.id, created: false };
  }

  const [inserted] = await db
    .insert(events)
    .values({
      sourceId: `poster:${extraction.id}`,
      source: 'POSTER',
      title: extraction.title,
      description: extraction.description,
      location: extraction.location,
      organizer: extraction.organizer,
      price: extraction.price,
      startDate,
      timeUnknown: extraction.timeUnknown,
      url: `${POSTER_EVENT_URL_ORIGIN}/posters?p=${extraction.id}`,
      // Must be populated at insert time - the AI cron's Images Pass stamps the
      // site default onto anything with an empty imageUrl.
      imageUrl: publicImageUrl,
      tags: [], // AI cron populates these
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: events.url,
      set: { lastSeenAt: new Date() },
    })
    .returning({ id: events.id });

  return { outcome: 'created', eventId: inserted?.id ?? null, created: true };
}

/**
 * Promote every not-yet-processed extraction on an upload into events.
 *
 * The upload must already be published - poster events are inserted with the
 * public image URL, and there is no second pass to fill it in later.
 */
export async function promoteExtractions(uploadId: string): Promise<PromoteExtractionsResult> {
  const [upload] = await db
    .select({ id: posterUploads.id, publicImageUrl: posterUploads.publicImageUrl })
    .from(posterUploads)
    .where(eq(posterUploads.id, uploadId))
    .limit(1);

  if (!upload) {
    throw new Error(`Poster upload ${uploadId} not found`);
  }

  if (!upload.publicImageUrl) {
    throw new Error(`Poster upload ${uploadId} has no public image URL; publish it first`);
  }

  const rows = await db
    .select()
    .from(posterExtractions)
    .where(eq(posterExtractions.uploadId, uploadId))
    .orderBy(asc(posterExtractions.ordinal), asc(posterExtractions.createdAt));

  const publicImageUrl = upload.publicImageUrl;

  const promoted = new Map<string, PromotedExtraction>();
  const pending: ExtractionRow[] = [];

  for (const row of rows) {
    // Idempotency: a settled outcome is final. 'failed' is not settled - it is
    // usually a transient AI or DB error, so a rerun gets to try again.
    if (row.outcome && row.outcome !== 'failed') {
      promoted.set(row.id, {
        extractionId: row.id,
        title: row.title,
        startDate: row.startDate,
        outcome: row.outcome as PromotionOutcome,
        eventId: row.eventId,
        eventSlug: null,
      });
      continue;
    }
    pending.push(row);
  }

  // Counted at insert time, not at write-back time, so a later failure cannot
  // leave the feed cache stale on top of events that really do exist.
  let createdCount = 0;

  const promoteRow = async (row: ExtractionRow): Promise<void> => {
    let outcome: PromotionOutcome;
    let eventId: string | null = null;

    try {
      const result = await promoteOne(row, publicImageUrl);
      outcome = result.outcome;
      eventId = result.eventId;
      if (result.created) createdCount++;
    } catch (error) {
      console.error(`[Posters] Failed to promote extraction ${row.id}:`, error);
      outcome = 'failed';
    }

    try {
      await db
        .update(posterExtractions)
        .set({ outcome, eventId })
        .where(eq(posterExtractions.id, row.id));
    } catch (error) {
      // The event (if any) exists; only the bookkeeping failed. A rerun redoes
      // this row, and the insert's onConflictDoUpdate makes that a no-op.
      console.error(`[Posters] Failed to record outcome for extraction ${row.id}:`, error);
    }

    promoted.set(row.id, {
      extractionId: row.id,
      title: row.title,
      startDate: row.startDate,
      outcome,
      eventId,
      eventSlug: null,
    });
  };

  try {
    // Bounded concurrency: each row can spend up to the embedding timeout
    // (30s), so 20 rows in strict series could outlast any request budget.
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(PROMOTION_CONCURRENCY, pending.length) },
      async () => {
        while (cursor < pending.length) {
          const row = pending[cursor++];
          await promoteRow(row);
        }
      }
    );
    await Promise.all(workers);
  } finally {
    if (createdCount > 0) {
      invalidateEventsCache();
    }
  }

  // Rebuild in the original ordinal order - the workers finish out of order.
  const ordered = rows
    .map((row) => promoted.get(row.id))
    .filter((item): item is PromotedExtraction => item !== undefined);

  await attachEventSlugs(ordered);

  return { uploadId, extractions: ordered, createdCount };
}

/**
 * Fill in `eventSlug` for every promoted row that landed on an event. Slugs
 * come from the event's own title/date, which differ from the extraction's for
 * `matched_existing` rows.
 */
async function attachEventSlugs(promoted: PromotedExtraction[]): Promise<void> {
  const eventIds = promoted.map((item) => item.eventId).filter((id): id is string => id !== null);

  if (eventIds.length === 0) return;

  const rows = await db
    .select({ id: events.id, title: events.title, startDate: events.startDate })
    .from(events)
    .where(inArray(events.id, eventIds));

  const slugById = new Map(
    rows.map((row) => [row.id, generateEventSlug(row.title, row.startDate, row.id)])
  );

  for (const item of promoted) {
    if (item.eventId) {
      item.eventSlug = slugById.get(item.eventId) ?? null;
    }
  }
}
