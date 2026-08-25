import { db } from '@/lib/db';
import { events, posterExtractions, posterUploads } from '@/lib/db/schema';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { generateEventSlug } from '@/lib/utils/slugify';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';

/** How many published uploads the /posters feed renders (no pagination for MVP). */
export const POSTER_FEED_LIMIT = 30;

/** How many flagged uploads the moderation queue loads at once. */
export const POSTER_REVIEW_LIMIT = 50;

/** How many recent failures the moderation page shows for debugging. */
export const POSTER_FAILED_LIMIT = 20;

/** How many uploads the moderation page's unfiltered "all" view loads. */
export const POSTER_ALL_LIMIT = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PosterFeedExtraction {
  id: string;
  /** Posters from the same printed flyer share an ordinal; multi-date flyers repeat it. */
  ordinal: number;
  title: string;
  startDate: Date | null;
  timeUnknown: boolean;
  location: string | null;
  organizer: string | null;
  price: string | null;
  /** See PromotionOutcome in lib/posters/promoteExtractions.ts */
  outcome: string | null;
  eventId: string | null;
  /** Present only when the linked event still exists */
  eventSlug: string | null;
}

export interface PosterFeedUpload {
  id: string;
  publicImageUrl: string | null;
  /** Normalized JPEG dimensions; null on uploads predating the columns. */
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: Date;
  extractions: PosterFeedExtraction[];
}

type ExtractionRow = Omit<PosterFeedExtraction, 'eventSlug'> & { uploadId: string };

const extractionColumns = {
  id: posterExtractions.id,
  uploadId: posterExtractions.uploadId,
  ordinal: posterExtractions.ordinal,
  title: posterExtractions.title,
  startDate: posterExtractions.startDate,
  timeUnknown: posterExtractions.timeUnknown,
  location: posterExtractions.location,
  organizer: posterExtractions.organizer,
  price: posterExtractions.price,
  outcome: posterExtractions.outcome,
  eventId: posterExtractions.eventId,
};

const uploadColumns = {
  id: posterUploads.id,
  publicImageUrl: posterUploads.publicImageUrl,
  imageWidth: posterUploads.imageWidth,
  imageHeight: posterUploads.imageHeight,
  createdAt: posterUploads.createdAt,
};

/**
 * Slug for every event these extractions landed on. Slugs come from the event's
 * own title and date, which differ from the extraction's on `matched_existing`
 * rows, so they cannot be derived from the extraction alone.
 */
async function fetchEventSlugs(rows: ExtractionRow[]): Promise<Map<string, string>> {
  const eventIds = [...new Set(rows.map((row) => row.eventId).filter((id): id is string => !!id))];

  if (eventIds.length === 0) return new Map();

  const eventRows = await db
    .select({ id: events.id, title: events.title, startDate: events.startDate })
    .from(events)
    .where(inArray(events.id, eventIds));

  return new Map(
    eventRows.map((row) => [row.id, generateEventSlug(row.title, row.startDate, row.id)])
  );
}

/**
 * Attach each upload's extractions, ordered by ordinal then date so a
 * multi-date flyer's rows stay grouped and chronological in the card.
 */
async function attachExtractions(
  uploads: Omit<PosterFeedUpload, 'extractions'>[]
): Promise<PosterFeedUpload[]> {
  if (uploads.length === 0) return [];

  const rows = await db
    .select(extractionColumns)
    .from(posterExtractions)
    .where(
      inArray(
        posterExtractions.uploadId,
        uploads.map((upload) => upload.id)
      )
    )
    .orderBy(asc(posterExtractions.ordinal), asc(posterExtractions.startDate));

  const slugById = await fetchEventSlugs(rows);

  const byUpload = new Map<string, PosterFeedExtraction[]>();
  for (const { uploadId, ...row } of rows) {
    const list = byUpload.get(uploadId) ?? [];
    list.push({ ...row, eventSlug: row.eventId ? (slugById.get(row.eventId) ?? null) : null });
    byUpload.set(uploadId, list);
  }

  return uploads.map((upload) => ({ ...upload, extractions: byUpload.get(upload.id) ?? [] }));
}

/**
 * Which half of the wall a feed query returns: posters with an event still to
 * come, or posters whose printed dates have all gone by.
 */
export type PosterTimeframe = 'upcoming' | 'past';

export interface PosterFeedOptions {
  includeAdult?: boolean;
  timeframe?: PosterTimeframe;
}

/** Published, and adult-filtered unless the viewer has asked to see those too. */
function publishedFilter(includeAdult: boolean) {
  return includeAdult
    ? eq(posterUploads.status, 'published')
    : and(eq(posterUploads.status, 'published'), eq(posterUploads.adult, false));
}

/**
 * Each upload's event dates folded down to two per-upload values.
 *
 * `nextStart` is the soonest date on the poster that has not happened yet, so
 * it is NULL once every printed date is behind us; `lastStart` is the latest
 * date printed on the poster at all, and is NULL only when nothing on it
 * carried a parseable date. Between them the three cases separate cleanly:
 * upcoming posters have a `nextStart`, past posters have only a `lastStart`,
 * and dateless posters have neither.
 *
 * The cutoff is midnight Eastern rather than "now", matching the event feed, so
 * a poster for tonight stays on the wall for the whole of the day it happens.
 */
function posterEventDates(cutoff: Date) {
  const cutoffSql = sql`${cutoff.toISOString()}::timestamptz`;

  return db
    .select({
      uploadId: posterExtractions.uploadId,
      nextStart:
        sql<Date | null>`min(${posterExtractions.startDate}) filter (where ${posterExtractions.startDate} >= ${cutoffSql})`.as(
          'next_start'
        ),
      lastStart: sql<Date | null>`max(${posterExtractions.startDate})`.as('last_start'),
    })
    .from(posterExtractions)
    .groupBy(posterExtractions.uploadId)
    .as('poster_event_dates');
}

type PosterEventDates = ReturnType<typeof posterEventDates>;

/**
 * A poster counts as past only once it has a date and that date has gone by.
 * One the model read no date off is not past - it rides along at the end of the
 * upcoming wall rather than being filed under a date it never had.
 */
function timeframeFilter(dates: PosterEventDates, timeframe: PosterTimeframe) {
  return timeframe === 'past'
    ? and(isNull(dates.nextStart), isNotNull(dates.lastStart))
    : or(isNotNull(dates.nextStart), isNull(dates.lastStart));
}

/**
 * Published uploads for the /posters feed: soonest event first on the upcoming
 * wall, most recently past first on the past one.
 *
 * `includeAdult` defaults to false, so every caller that forgets to think about
 * it gets the safe feed. Only a signed-in viewer who has asked to see them
 * should pass true - the flag is on the upload, not on the events it created,
 * so this hides images and nothing else.
 */
export async function queryPublishedPosters(
  limit: number = POSTER_FEED_LIMIT,
  { includeAdult = false, timeframe = 'upcoming' }: PosterFeedOptions = {}
): Promise<PosterFeedUpload[]> {
  const dates = posterEventDates(getStartOfTodayEastern());

  const uploads = await db
    .select(uploadColumns)
    .from(posterUploads)
    .leftJoin(dates, eq(dates.uploadId, posterUploads.id))
    .where(and(publishedFilter(includeAdult), timeframeFilter(dates, timeframe)))
    .orderBy(
      ...(timeframe === 'past'
        ? [desc(dates.lastStart), desc(posterUploads.createdAt)]
        : // NULLS LAST because a missing date means "unknown", not "far future",
          // so dateless posters belong behind everything that has a date.
          [sql`${dates.nextStart} asc nulls last`, desc(posterUploads.createdAt)])
    )
    .limit(limit);

  return attachExtractions(uploads);
}

/**
 * How many published uploads the feed is hiding as adult, for the banner.
 * Scoped to the same timeframe, so the count matches the wall being looked at.
 */
export async function countHiddenAdultPosters(
  limit: number = POSTER_FEED_LIMIT,
  { timeframe = 'upcoming' }: { timeframe?: PosterTimeframe } = {}
): Promise<number> {
  const dates = posterEventDates(getStartOfTodayEastern());

  const rows = await db
    .select({ id: posterUploads.id })
    .from(posterUploads)
    .leftJoin(dates, eq(dates.uploadId, posterUploads.id))
    .where(
      and(
        eq(posterUploads.status, 'published'),
        eq(posterUploads.adult, true),
        timeframeFilter(dates, timeframe)
      )
    )
    .limit(limit);

  return rows.length;
}

/**
 * The published upload containing a given extraction, for the `?p=` deep link
 * that poster event URLs point at. Only needed when the target is older than
 * the feed window.
 */
export async function queryPublishedPosterByExtractionId(
  extractionId: string,
  { includeAdult = false }: { includeAdult?: boolean } = {}
): Promise<PosterFeedUpload | null> {
  // Postgres rejects a malformed uuid outright, and the id comes from a query
  // param, so a bad value has to be a miss rather than a 500.
  if (!UUID_PATTERN.test(extractionId)) return null;

  const [upload] = await db
    .select(uploadColumns)
    .from(posterUploads)
    .innerJoin(posterExtractions, eq(posterExtractions.uploadId, posterUploads.id))
    .where(
      and(
        eq(posterExtractions.id, extractionId),
        eq(posterUploads.status, 'published'),
        // A deep link must not be a way around the filter.
        ...(includeAdult ? [] : [eq(posterUploads.adult, false)])
      )
    )
    .limit(1);

  if (!upload) return null;

  const [withExtractions] = await attachExtractions([upload]);
  return withExtractions ?? null;
}

/** Everything the moderation queue shows about one detected poster. */
export interface AdminPosterExtraction extends PosterFeedExtraction {
  description: string | null;
  /** Verbatim OCR. Moderation-only - it is dead weight in the feed payload. */
  rawText: string | null;
}

/** One upload awaiting review (or one that failed), with its moderation context. */
export interface AdminPosterUpload {
  id: string;
  status: string;
  safetyReason: string | null;
  /** Set when held as an adult-audience event rather than as unsafe content */
  adultReason: string | null;
  /** Hidden from the signed-out /posters feed, even after approval */
  adult: boolean;
  errorMessage: string | null;
  /** Truncated: the full dump can be tens of kilobytes of model text. */
  rawModelOutputExcerpt: string | null;
  publicImageUrl: string | null;
  fileSizeBytes: number | null;
  createdAt: Date;
  reviewedAt: Date | null;
  extractions: AdminPosterExtraction[];
}

/** Enough of the model dump to see what went wrong without flooding the page. */
const RAW_OUTPUT_EXCERPT_CHARS = 1200;

const adminUploadColumns = {
  id: posterUploads.id,
  status: posterUploads.status,
  safetyReason: posterUploads.safetyReason,
  adultReason: posterUploads.adultReason,
  adult: posterUploads.adult,
  errorMessage: posterUploads.errorMessage,
  rawModelOutput: posterUploads.rawModelOutput,
  publicImageUrl: posterUploads.publicImageUrl,
  fileSizeBytes: posterUploads.fileSizeBytes,
  createdAt: posterUploads.createdAt,
  reviewedAt: posterUploads.reviewedAt,
};

type AdminUploadRow = {
  [K in keyof typeof adminUploadColumns]: (typeof posterUploads.$inferSelect)[K];
};

type AdminExtractionRow = Omit<AdminPosterExtraction, 'eventSlug'> & { uploadId: string };

/**
 * Same as the feed's extraction load, plus `description` - the moderator needs
 * to read what would be published, not just what the card would show.
 */
async function attachAdminExtractions(uploads: AdminUploadRow[]): Promise<AdminPosterUpload[]> {
  const shaped = uploads.map(({ rawModelOutput, ...upload }) => ({
    ...upload,
    rawModelOutputExcerpt: rawModelOutput
      ? rawModelOutput.slice(0, RAW_OUTPUT_EXCERPT_CHARS)
      : null,
    extractions: [] as AdminPosterExtraction[],
  }));

  if (shaped.length === 0) return shaped;

  const rows: AdminExtractionRow[] = await db
    .select({
      ...extractionColumns,
      description: posterExtractions.description,
      rawText: posterExtractions.rawText,
    })
    .from(posterExtractions)
    .where(
      inArray(
        posterExtractions.uploadId,
        shaped.map((upload) => upload.id)
      )
    )
    .orderBy(asc(posterExtractions.ordinal), asc(posterExtractions.startDate));

  const slugById = await fetchEventSlugs(rows);

  const byUpload = new Map<string, AdminPosterExtraction[]>();
  for (const { uploadId, ...row } of rows) {
    const list = byUpload.get(uploadId) ?? [];
    list.push({ ...row, eventSlug: row.eventId ? (slugById.get(row.eventId) ?? null) : null });
    byUpload.set(uploadId, list);
  }

  for (const upload of shaped) {
    upload.extractions = byUpload.get(upload.id) ?? [];
  }

  return shaped;
}

/** Uploads waiting on a moderator, oldest first so nothing sits forgotten. */
export async function queryPosterReviewQueue(
  limit: number = POSTER_REVIEW_LIMIT
): Promise<AdminPosterUpload[]> {
  const uploads = await db
    .select(adminUploadColumns)
    .from(posterUploads)
    .where(eq(posterUploads.status, 'pending_review'))
    .orderBy(asc(posterUploads.createdAt))
    .limit(limit);

  return attachAdminExtractions(uploads);
}

/**
 * Every upload regardless of status, newest first - the moderation page's
 * unfiltered view. This is the only way to reach an already-published upload
 * to take it down, since the review queue only lists what is still pending.
 */
export async function queryAllPosters(
  limit: number = POSTER_ALL_LIMIT
): Promise<AdminPosterUpload[]> {
  const uploads = await db
    .select(adminUploadColumns)
    .from(posterUploads)
    .orderBy(desc(posterUploads.createdAt))
    .limit(limit);

  return attachAdminExtractions(uploads);
}

/**
 * Recent uploads whose pipeline failed. Not actionable from the queue (there
 * are no extractions to approve), but the error and model output are the only
 * record of what went wrong.
 */
export async function queryFailedPosters(
  limit: number = POSTER_FAILED_LIMIT
): Promise<AdminPosterUpload[]> {
  const uploads = await db
    .select(adminUploadColumns)
    .from(posterUploads)
    .where(eq(posterUploads.status, 'failed'))
    .orderBy(desc(posterUploads.createdAt))
    .limit(limit);

  return attachAdminExtractions(uploads);
}
