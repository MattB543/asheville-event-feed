/**
 * The public events API behind GET /api/export/json: legacy filter parsing, the one
 * filter predicate shared by the full and compact responses, and compact keyset
 * pagination. Headers, limits and the cursor format live in ./publicEventsContract.
 *
 * Filtering runs in two layers. `buildExportConditions` pushes the filters SQL can
 * reproduce exactly (date window, day of week, time of day, the comma-OR search,
 * tags, zips, daily events) into the WHERE clause, so a compact scan rarely hits its
 * cap. `matchesExportFilters` then checks every filter again in JS and stays the
 * source of truth: each SQL condition only removes rows the JS predicate rejects
 * anyway, so full and compact select exactly the same events.
 */

import { unstable_cache } from 'next/cache';
import {
  and,
  arrayOverlaps,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  not,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { publicEventColumns } from '@/lib/db/queries/publicEventColumns';
import {
  getDayBoundariesEastern,
  getStartOfTodayEastern,
  getTodayStringEastern,
} from '@/lib/utils/timezone';
import {
  computeDateFilterBounds,
  isDayOfWeekEastern,
  isInTimeOfDayEastern,
} from '@/lib/utils/dateFilters';
import { matchesDefaultFilter } from '@/lib/config/defaultFilters';
import { extractCity, isAshevilleArea } from '@/lib/utils/geo';
import { isRecord, isString } from '@/lib/utils/validation';
import { formatEventStartDate } from '@/lib/utils/eventStartDate';
import { parsePublicOfferPrice } from '@/lib/utils/publicEventPrice';
import { isFreeEvent, parsePrice } from '@/lib/utils/eventFilterMatch';
import { generateEventUrl } from '@/lib/utils/slugify';
import type { TimeOfDay } from '@/lib/types/filters';
import {
  COMPACT_BATCH_SIZE,
  COMPACT_MAX_BATCHES,
  encodeCursor,
  type ExportCursor,
} from '@/lib/api/publicEventsContract';

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

const TIME_OF_DAY = new Set<TimeOfDay>(['morning', 'afternoon', 'evening']);

interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

/**
 * The 17 legacy export parameters, parsed exactly as the export always has: CSV
 * values split on commas without trimming, malformed values tolerated rather than
 * rejected. Plain JSON, so it doubles as the compact cache key.
 */
export interface ExportFilters {
  /** Lowercased; comma-separated terms are ORed. Empty = no search. */
  search: string;
  dateFilter: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  priceFilter: string | null;
  maxPrice: string | null;
  tagsInclude: string[];
  tagsExclude: string[];
  days: number[];
  times: TimeOfDay[];
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: HiddenEventFingerprint[];
  useDefaultFilters: boolean;
  locations: string[];
  zips: string[];
  showDailyEvents: boolean;
}

function parseHiddenEvents(value: string | null): HiddenEventFingerprint[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!isRecord(entry) || !isString(entry.title) || !isString(entry.organizer)) {
        return [];
      }
      return [{ title: entry.title, organizer: entry.organizer }];
    });
  } catch {
    return [];
  }
}

function parseTimes(value: string | null): TimeOfDay[] {
  if (!value) return [];
  return value
    .split(',')
    .map((time) => time.trim())
    .filter((time): time is TimeOfDay => TIME_OF_DAY.has(time as TimeOfDay));
}

export function parseExportFilters(searchParams: URLSearchParams): ExportFilters {
  const csv = (name: string): string[] => {
    const value = searchParams.get(name);
    return value ? value.split(',') : [];
  };

  return {
    search: searchParams.get('search')?.toLowerCase() ?? '',
    dateFilter: searchParams.get('dateFilter'),
    dateStart: searchParams.get('dateStart'),
    dateEnd: searchParams.get('dateEnd'),
    priceFilter: searchParams.get('priceFilter'),
    maxPrice: searchParams.get('maxPrice'),
    tagsInclude: csv('tagsInclude'),
    tagsExclude: csv('tagsExclude'),
    days: csv('days').map(Number),
    times: parseTimes(searchParams.get('times')),
    blockedHosts: csv('blockedHosts'),
    blockedKeywords: csv('blockedKeywords'),
    hiddenEvents: parseHiddenEvents(searchParams.get('hiddenEvents')),
    useDefaultFilters: searchParams.get('useDefaultFilters') !== 'false',
    locations: csv('locations'),
    zips: csv('zips').filter(Boolean),
    showDailyEvents: searchParams.get('showDailyEvents') !== 'false',
  };
}

// ---------------------------------------------------------------------------
// Date windows
// ---------------------------------------------------------------------------

/**
 * Whole Eastern calendar days: `start` inclusive, `endExclusive` the following
 * midnight. Half-open so SQL and JS agree on a start_date in the last millisecond
 * of the day (Postgres keeps microseconds, a JS Date truncates them).
 */
export interface DateRange {
  start: Date;
  endExclusive: Date;
}

/** Day boundaries whose end is 23:59:59.999, as a half-open window. */
function halfOpen(bounds: { start: Date; end: Date }): DateRange {
  return { start: bounds.start, endExclusive: new Date(bounds.end.getTime() + 1) };
}

/**
 * `dateFilter=custom`: dateStart's day through dateEnd's day (or dateStart's day
 * alone), on Eastern day boundaries so a DST switch day is covered whole. null
 * when either date can't be parsed, which matches nothing.
 */
export function resolveCustomDateRange(
  dateStart: string,
  dateEnd: string | null | undefined
): DateRange | null {
  try {
    const start = getDayBoundariesEastern(dateStart).start;
    const end = getDayBoundariesEastern(dateEnd || dateStart).end;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return halfOpen({ start, end });
  } catch {
    return null;
  }
}

/** Whether a start date falls in a window; a null (unparseable) window matches nothing. */
export function isInDateRange(date: Date, range: DateRange | null): boolean {
  return range !== null && date >= range.start && date < range.endExclusive;
}

/** undefined: no date window (missing/'all'/'dayOfWeek'/unrecognized, or custom without dateStart). */
function resolveDateRange(filters: ExportFilters): DateRange | null | undefined {
  switch (filters.dateFilter) {
    case 'today':
      return halfOpen(computeDateFilterBounds().today);
    case 'tomorrow':
      return halfOpen(computeDateFilterBounds().tomorrow);
    case 'weekend':
      return halfOpen(computeDateFilterBounds().weekend);
    case 'custom':
      return filters.dateStart
        ? resolveCustomDateRange(filters.dateStart, filters.dateEnd)
        : undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

type EventRow = typeof events.$inferSelect;

/** The columns the filter predicate reads. */
type FilterableEvent = Pick<
  EventRow,
  | 'title'
  | 'description'
  | 'startDate'
  | 'location'
  | 'zip'
  | 'organizer'
  | 'price'
  | 'tags'
  | 'timeUnknown'
  | 'recurringType'
>;

/** Filters plus everything derived from them once per request rather than per event. */
interface PreparedExport {
  filters: ExportFilters;
  startOfToday: Date;
  /** undefined: no date window. null: unparseable custom dates, which match nothing. */
  dateRange: DateRange | null | undefined;
  searchTerms: string[];
}

function prepareExport(filters: ExportFilters): PreparedExport {
  return {
    filters,
    startOfToday: getStartOfTodayEastern(),
    dateRange: resolveDateRange(filters),
    searchTerms: filters.search
      .split(',')
      .map((term) => term.trim())
      .filter((term) => term.length > 0),
  };
}

function matchesHiddenFingerprint(
  event: { title: string; organizer: string | null },
  hiddenEvents: HiddenEventFingerprint[]
): boolean {
  const eventKey = `${event.title.toLowerCase().trim()}|||${(event.organizer || '').toLowerCase().trim()}`;
  return hiddenEvents.some((fp) => eventKey === `${fp.title}|||${fp.organizer}`);
}

/**
 * The export's filter predicate: the original JS-only export's, plus the site's
 * shared free rule and the API-only `confirmedFree`.
 */
function matchesExportFilters(event: FilterableEvent, prepared: PreparedExport): boolean {
  const filters = prepared.filters;

  // Daily events toggle
  if (!filters.showDailyEvents && event.recurringType === 'daily') return false;

  // Hidden events (by title+organizer fingerprint)
  if (filters.hiddenEvents.length > 0 && matchesHiddenFingerprint(event, filters.hiddenEvents)) {
    return false;
  }

  // Blocked hosts
  if (filters.blockedHosts.length > 0 && event.organizer) {
    const organizer = event.organizer.toLowerCase();
    if (filters.blockedHosts.some((host) => organizer.includes(host.toLowerCase()))) return false;
  }

  // Blocked keywords (user custom)
  if (filters.blockedKeywords.length > 0) {
    const title = event.title.toLowerCase();
    if (filters.blockedKeywords.some((kw) => title.includes(kw.toLowerCase()))) return false;
  }

  // Default filters (spam filter)
  if (filters.useDefaultFilters) {
    const textToCheck = `${event.title} ${event.description || ''} ${event.organizer || ''}`;
    if (matchesDefaultFilter(textToCheck)) return false;
  }

  // Search (comma-separated OR). A search of only commas/spaces matches nothing.
  if (filters.search) {
    const searchText =
      `${event.title} ${event.description || ''} ${event.organizer || ''} ${event.location || ''}`.toLowerCase();
    if (!prepared.searchTerms.some((term) => searchText.includes(term))) return false;
  }

  // Date window (Eastern)
  const eventDate = new Date(event.startDate);
  if (prepared.dateRange !== undefined && !isInDateRange(eventDate, prepared.dateRange)) {
    return false;
  }
  if (filters.dateFilter === 'dayOfWeek' && !isDayOfWeekEastern(eventDate, filters.days)) {
    return false;
  }

  // Time of day (unknown times pass)
  if (filters.times.length > 0 && !event.timeUnknown) {
    if (!isInTimeOfDayEastern(eventDate, filters.times)) return false;
  }

  // Price. "free" is the site's rule (includes events with no listed price);
  // "confirmedFree" only what the source lists as free ("Free" or $0).
  if (filters.priceFilter && filters.priceFilter !== 'any') {
    const price = parsePrice(event.price);

    if (filters.priceFilter === 'free' && !isFreeEvent(event.price)) return false;
    if (filters.priceFilter === 'confirmedFree' && parsePublicOfferPrice(event.price) !== '0') {
      return false;
    }
    if (filters.priceFilter === 'under20' && price > 20) return false;
    if (filters.priceFilter === 'under100' && price > 100) return false;
    if (
      filters.priceFilter === 'custom' &&
      filters.maxPrice &&
      price > parseFloat(filters.maxPrice)
    ) {
      return false;
    }
  }

  // Tags: exclude if any excluded tag, require one included tag when set
  const eventTags = event.tags || [];
  if (filters.tagsExclude.length > 0) {
    if (filters.tagsExclude.some((tag) => eventTags.includes(tag))) return false;
  }
  if (filters.tagsInclude.length > 0) {
    if (!filters.tagsInclude.some((tag) => eventTags.includes(tag))) return false;
  }

  // Location (multi-select - OR logic)
  if (filters.locations.length > 0) {
    const eventCity = extractCity(event.location);
    const matchesAnyLocation = filters.locations.some((loc) => {
      if (loc === 'asheville') return isAshevilleArea(event.location);
      return eventCity === loc; // includes 'Online'
    });
    if (!matchesAnyLocation) return false;
  }

  // Zip
  if (filters.zips.length > 0) {
    if (!event.zip || !filters.zips.includes(event.zip)) return false;
  }

  return true;
}

const EASTERN_HOUR = sql`EXTRACT(HOUR FROM ${events.startDate} AT TIME ZONE 'America/New_York')`;

const ASCII_ONLY = /^[\x00-\x7f]*$/;

/**
 * Postgres text can't hold U+0000, so a value containing it never equals or occurs
 * in a stored value (the JS predicate rejects it too) - and binding it as a query
 * parameter would fail the whole query. Such values are dropped from the SQL.
 */
function storable(value: string): boolean {
  return !value.includes('\u0000');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * SQL for the filters Postgres can evaluate with the predicate's exact semantics.
 * Every condition is implied by `matchesExportFilters`; the rest stay JS-only.
 */
function buildExportConditions(prepared: PreparedExport): SQL[] {
  const { filters, dateRange } = prepared;

  const conditions: SQL[] = [
    gte(events.startDate, prepared.startOfToday),
    // NULL `hidden` counts as visible, as it always has for this export
    or(isNull(events.hidden), eq(events.hidden, false))!,
    isNull(events.dedupedAt),
    isNull(events.deadAt),
  ];

  if (dateRange === null) {
    conditions.push(sql`false`);
  } else if (dateRange) {
    conditions.push(
      gte(events.startDate, dateRange.start),
      lt(events.startDate, dateRange.endExclusive)
    );
  }

  if (filters.dateFilter === 'dayOfWeek' && filters.days.length > 0) {
    // Values outside 0-6 (NaN included) match no day, in JS and here
    const days = filters.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    conditions.push(
      days.length > 0
        ? or(
            ...days.map(
              (day) =>
                sql`EXTRACT(DOW FROM ${events.startDate} AT TIME ZONE 'America/New_York') = ${day}`
            )
          )!
        : sql`false`
    );
  }

  if (filters.times.length > 0) {
    const buckets = filters.times.map((time) => {
      if (time === 'morning') return sql`${EASTERN_HOUR} BETWEEN 5 AND 11`;
      if (time === 'afternoon') return sql`${EASTERN_HOUR} BETWEEN 12 AND 16`;
      return sql`(${EASTERN_HOUR} >= 17 OR ${EASTERN_HOUR} <= 2)`;
    });
    conditions.push(or(eq(events.timeUnknown, true), ...buckets)!);
  }

  // Same concatenated text as the JS search, so a term spanning two fields still
  // matches. ILIKE lowercases ASCII exactly as toLowerCase() does; a search with any
  // non-ASCII term is left to JS alone.
  const searchTerms = prepared.searchTerms.filter(storable);
  if (filters.search && searchTerms.every((term) => ASCII_ONLY.test(term))) {
    const searchText = sql`(${events.title} || ' ' || coalesce(${events.description}, '') || ' ' || coalesce(${events.organizer}, '') || ' ' || coalesce(${events.location}, ''))`;
    conditions.push(
      searchTerms.length > 0
        ? or(...searchTerms.map((term) => sql`${searchText} ILIKE ${`%${escapeLike(term)}%`}`))!
        : sql`false`
    );
  }

  if (filters.tagsInclude.length > 0) {
    const tags = filters.tagsInclude.filter(storable);
    conditions.push(tags.length > 0 ? arrayOverlaps(events.tags, tags) : sql`false`);
  }
  const excludedTags = filters.tagsExclude.filter(storable);
  if (excludedTags.length > 0) {
    // NULL tags overlap nothing, so they must survive an exclude
    conditions.push(or(isNull(events.tags), not(arrayOverlaps(events.tags, excludedTags)))!);
  }

  if (!filters.showDailyEvents) {
    conditions.push(sql`${events.recurringType} IS DISTINCT FROM 'daily'`);
  }

  if (filters.zips.length > 0) {
    const zips = filters.zips.filter(storable);
    conditions.push(zips.length > 0 ? inArray(events.zip, zips) : sql`false`);
  }

  return conditions;
}

// ---------------------------------------------------------------------------
// Full response (the original export shape)
// ---------------------------------------------------------------------------

type PublicEventRow = Pick<EventRow, keyof typeof publicEventColumns>;

function getImageUrl(imageUrl: string | null | undefined): string | null {
  // Filter out base64 data URLs (AI-generated images) - they're too large
  if (!imageUrl || imageUrl.startsWith('data:')) return null;
  return imageUrl;
}

function toFullExportEvent(event: PublicEventRow) {
  return {
    id: event.id,
    sourceId: event.sourceId,
    source: event.source,
    title: event.title,
    description: event.description || null,
    startDate: event.startDate.toISOString(),
    location: event.location || null,
    zip: event.zip || null,
    organizer: event.organizer || null,
    price: event.price || null,
    url: event.url,
    imageUrl: getImageUrl(event.imageUrl),
    tags: event.tags || [],
    aiSummary: event.aiSummary || null,
    // Engagement metrics
    interestedCount: event.interestedCount || null,
    goingCount: event.goingCount || null,
    favoriteCount: event.favoriteCount || 0,
    // Scoring (used by Top 30 ranking)
    score: event.score ?? null,
    scoreRarity: event.scoreRarity ?? null,
    scoreUnique: event.scoreUnique ?? null,
    scoreMagnitude: event.scoreMagnitude ?? null,
    scoreReason: event.scoreReason ?? null,
    scoreAshevilleWeird: event.scoreAshevilleWeird ?? null,
    scoreSocial: event.scoreSocial ?? null,
    // Recurring event info
    recurringType: event.recurringType || null,
    recurringEndDate: event.recurringEndDate?.toISOString() || null,
    // Metadata
    timeUnknown: event.timeUnknown || false,
    createdAt: event.createdAt?.toISOString() || null,
    updatedAt: event.updatedAt?.toISOString() || null,
    lastSeenAt: event.lastSeenAt?.toISOString() || null,
  };
}

/**
 * Every matching upcoming event in one unpaginated response. Not data-cached: it can
 * run to several MB, past the data cache's per-entry limit, so it relies on the
 * HTTP Cache-Control alone.
 */
export async function queryFullExport(filters: ExportFilters) {
  const prepared = prepareExport(filters);

  const rows = await db
    .select(publicEventColumns)
    .from(events)
    .where(and(...buildExportConditions(prepared)))
    .orderBy(asc(events.startDate), asc(events.id));

  const jsonEvents = rows
    .filter((event) => matchesExportFilters(event, prepared))
    .map(toFullExportEvent);

  return {
    count: jsonEvents.length,
    generated: new Date().toISOString(),
    events: jsonEvents,
  };
}

// ---------------------------------------------------------------------------
// Compact response
// ---------------------------------------------------------------------------

/** What a compact page returns plus what the predicate reads - no images, scores or embeddings. */
const compactColumns = {
  id: events.id,
  title: events.title,
  description: events.description,
  startDate: events.startDate,
  location: events.location,
  zip: events.zip,
  organizer: events.organizer,
  price: events.price,
  tags: events.tags,
  aiSummary: events.aiSummary,
  timeUnknown: events.timeUnknown,
  recurringType: events.recurringType,
};

/** start_date to the microsecond, for the cursor (see ExportCursor). */
const CURSOR_START = sql<string>`to_char(${events.startDate} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type CompactRow = Pick<EventRow, keyof typeof compactColumns> & { cursorStart: string };

export interface CompactExportEvent {
  id: string;
  title: string;
  /** RFC 3339 with the Eastern offset (to the second), or YYYY-MM-DD when the time is unknown. */
  startDate: string;
  location: string | null;
  /** The source's price text; null when none is listed. */
  price: string | null;
  aiSummary: string | null;
  /** Canonical AVL GO event page. */
  url: string;
}

export interface CompactExportResponse {
  /** Events on this page, not total matches. */
  count: number;
  generated: string;
  timezone: 'America/New_York';
  events: CompactExportEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Compact price: null for no price, including the stored "Unknown" placeholder. */
function compactPrice(price: string | null): string | null {
  const trimmed = price?.trim();
  return !trimmed || trimmed.toLowerCase() === 'unknown' ? null : price;
}

function toCompactExportEvent(event: CompactRow): CompactExportEvent {
  return {
    id: event.id,
    title: event.title,
    startDate: formatEventStartDate(event.startDate, event.timeUnknown === true),
    location: event.location || null,
    price: compactPrice(event.price),
    aiSummary: event.aiSummary || null,
    url: generateEventUrl(event.title, event.startDate, event.id),
  };
}

function cursorAfter(row: CompactRow): ExportCursor {
  return { startDate: row.cursorStart, id: row.id };
}

/**
 * One compact page: scans batches in (startDate, id) order after the cursor until
 * it has limit + 1 matches (so it knows another page exists), runs out of rows, or
 * hits the scan cap. At the cap the cursor resumes after the last row scanned, so
 * `events` can come back short - even empty - with hasMore still true.
 */
async function queryCompactPage(
  filters: ExportFilters,
  limit: number,
  cursor: ExportCursor | null
): Promise<CompactExportResponse> {
  const prepared = prepareExport(filters);
  const conditions = buildExportConditions(prepared);

  const matches: CompactRow[] = [];
  let after = cursor;
  let lastScanned: CompactRow | null = null;
  let termination: 'exhausted' | 'overflow' | 'scanCap' = 'scanCap';

  for (let batchIndex = 0; batchIndex < COMPACT_MAX_BATCHES; batchIndex++) {
    // Compared as exact timestamptz text, so a row is never revisited over sub-ms precision
    const keyset = after
      ? or(
          sql`${events.startDate} > ${after.startDate}::timestamptz`,
          and(sql`${events.startDate} = ${after.startDate}::timestamptz`, gt(events.id, after.id))
        )
      : undefined;

    const batch = await db
      .select({ ...compactColumns, cursorStart: CURSOR_START })
      .from(events)
      .where(and(...conditions, keyset))
      .orderBy(asc(events.startDate), asc(events.id))
      .limit(COMPACT_BATCH_SIZE);

    if (batch.length === 0) {
      termination = 'exhausted';
      break;
    }

    lastScanned = batch[batch.length - 1];
    matches.push(...batch.filter((event) => matchesExportFilters(event, prepared)));

    if (matches.length > limit) {
      termination = 'overflow';
      break;
    }
    if (batch.length < COMPACT_BATCH_SIZE) {
      termination = 'exhausted';
      break;
    }
    after = cursorAfter(lastScanned);
  }

  const page = matches.slice(0, limit);

  let nextCursor: string | null = null;
  if (termination === 'overflow') {
    nextCursor = encodeCursor(cursorAfter(page[page.length - 1]));
  } else if (termination === 'scanCap' && lastScanned) {
    nextCursor = encodeCursor(cursorAfter(lastScanned));
  }

  return {
    count: page.length,
    generated: new Date().toISOString(),
    timezone: 'America/New_York',
    events: page.map(toCompactExportEvent),
    nextCursor,
    hasMore: termination !== 'exhausted',
  };
}

// Bump when the compact response shape changes, or cached entries keep serving the old one
const COMPACT_CACHE_SHAPE = 'compact-v4';

/**
 * A compact page through the data cache, invalidated with the feed by the `events`
 * tag. The response is serialized (dates already strings) before it is cached, and
 * `generated` is cached with the events it describes. The Eastern date is in the
 * key because "today", "weekend" and the today-onward base filter move at midnight.
 */
export function getCompactExport(
  filters: ExportFilters,
  limit: number,
  cursor: ExportCursor | null
): Promise<CompactExportResponse> {
  return unstable_cache(
    () => queryCompactPage(filters, limit, cursor),
    [
      'export-json-compact',
      COMPACT_CACHE_SHAPE,
      getTodayStringEastern(),
      JSON.stringify({ filters, limit, cursor: cursor ? encodeCursor(cursor) : null }),
    ],
    { tags: ['events'], revalidate: 300 }
  )();
}
