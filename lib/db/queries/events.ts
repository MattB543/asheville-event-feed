import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import {
  and,
  or,
  gte,
  lte,
  asc,
  ilike,
  notIlike,
  isNull,
  sql,
  SQL,
  arrayOverlaps,
  InferSelectModel,
} from "drizzle-orm";
import { getStartOfTodayEastern, parseAsEastern } from "@/lib/utils/timezone";
import { matchesDefaultFilter } from "@/lib/config/defaultFilters";
import { extractCity, isAshevilleArea } from "@/lib/utils/extractCity";
import { isAshevilleZip } from "@/lib/config/zipNames";

// Type for events without embedding (server-side only field)
export type DbEvent = Omit<InferSelectModel<typeof events>, "embedding">;

// Filter parameters accepted by the API
export interface EventFilterParams {
  // Pagination
  cursor?: string; // Format: "startDate_id" (ISO timestamp _ UUID)
  limit?: number; // Default 50, max 100

  // Search
  search?: string;

  // Date filters
  dateFilter?: "all" | "today" | "tomorrow" | "weekend" | "custom" | "dayOfWeek";
  dateStart?: string; // YYYY-MM-DD for custom range
  dateEnd?: string; // YYYY-MM-DD for custom range
  days?: number[]; // Day of week (0=Sun to 6=Sat)

  // Time of day
  times?: ("morning" | "afternoon" | "evening")[];

  // Price
  priceFilter?: "any" | "free" | "under20" | "under100" | "custom";
  maxPrice?: number;

  // Tags
  tagsInclude?: string[];
  tagsExclude?: string[];

  // Location
  locations?: string[]; // City names or "asheville" for area
  zips?: string[];

  // User preferences (blocking)
  blockedHosts?: string[];
  blockedKeywords?: string[];
  hiddenFingerprints?: { title: string; organizer: string }[];

  // Settings
  useDefaultFilters?: boolean;
  showDailyEvents?: boolean;
}

export interface EventQueryResult {
  events: DbEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export interface EventMetadata {
  availableTags: string[];
  availableLocations: string[];
  availableZips: { zip: string; count: number }[];
}

// Helper to parse cursor
function parseCursor(cursor: string): { startDate: Date; id: string } | null {
  const parts = cursor.split("_");
  if (parts.length < 2) return null;

  // ID is always the last part (UUID)
  const id = parts.pop()!;
  // Everything before is the ISO date (which may contain underscores if using different format)
  const dateStr = parts.join("_");

  const startDate = new Date(dateStr);
  if (isNaN(startDate.getTime())) return null;

  return { startDate, id };
}

// Helper to create cursor
function createCursor(event: DbEvent): string {
  return `${event.startDate.toISOString()}_${event.id}`;
}

// Helper to get day boundaries in Eastern timezone
function getDayBoundaries(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Parse price string to number
function parsePrice(priceStr: string | null | undefined): number {
  if (!priceStr) return 0;
  const lower = priceStr.toLowerCase();
  if (lower.includes("free") || lower.includes("donation")) return 0;
  const matches = priceStr.match(/(\d+(\.\d+)?)/);
  if (matches) return parseFloat(matches[0]);
  return 0;
}

// Check if event is free
function isFreeEvent(price: string | null | undefined): boolean {
  if (!price) return true; // Unknown = assume free
  const lower = price.toLowerCase();
  return (
    lower === "unknown" ||
    lower === "" ||
    lower.includes("free") ||
    lower.includes("donation") ||
    parsePrice(price) === 0
  );
}

// Get this weekend's boundaries (Fri-Sun)
function getWeekendBoundaries(): { start: Date; end: Date } {
  const today = new Date();
  const dayOfWeek = today.getDay();

  // Calculate Friday of this week
  const daysUntilFriday = dayOfWeek === 0 ? -2 : 5 - dayOfWeek;
  const friday = new Date(today);
  friday.setDate(today.getDate() + daysUntilFriday);
  friday.setHours(0, 0, 0, 0);

  // Sunday end
  const sundayEnd = new Date(friday);
  sundayEnd.setDate(friday.getDate() + 2);
  sundayEnd.setHours(23, 59, 59, 999);

  return { start: friday, end: sundayEnd };
}

/**
 * Build filtered events query.
 * Returns paginated results with cursor for infinite scroll.
 */
export async function queryFilteredEvents(
  params: EventFilterParams
): Promise<EventQueryResult> {
  const limit = Math.min(params.limit || 50, 100);
  const startOfToday = getStartOfTodayEastern();

  // Debug logging for filter params
  const filterDebug = {
    dateFilter: params.dateFilter,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    priceFilter: params.priceFilter,
    tagsInclude: params.tagsInclude?.length,
    cursor: params.cursor ? "yes" : "no",
  };
  const hasFilters = params.dateFilter || params.priceFilter || params.tagsInclude?.length;
  if (hasFilters) {
    console.log("[queryFilteredEvents] Filtering with:", filterDebug);
  }

  // Build WHERE conditions
  const conditions: SQL[] = [];

  // Base condition: future events only
  conditions.push(gte(events.startDate, startOfToday));

  // Exclude online/virtual events
  conditions.push(
    or(
      isNull(events.location),
      and(
        notIlike(events.location, "%online%"),
        notIlike(events.location, "%virtual%")
      )
    )!
  );

  // Exclude hidden (admin moderated) events
  conditions.push(
    or(isNull(events.hidden), sql`${events.hidden} = false`)!
  );

  // NOTE: Cursor-based pagination is handled in the iterative fetch loop below,
  // not here, to allow multiple batches with updated cursors.

  // Date filter
  if (params.dateFilter && params.dateFilter !== "all") {
    const today = new Date();

    switch (params.dateFilter) {
      case "today": {
        const { start, end } = getDayBoundaries(today);
        conditions.push(gte(events.startDate, start));
        conditions.push(lte(events.startDate, end));
        break;
      }
      case "tomorrow": {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const { start, end } = getDayBoundaries(tomorrow);
        conditions.push(gte(events.startDate, start));
        conditions.push(lte(events.startDate, end));
        break;
      }
      case "weekend": {
        const { start, end } = getWeekendBoundaries();
        conditions.push(gte(events.startDate, start));
        conditions.push(lte(events.startDate, end));
        break;
      }
      case "custom": {
        if (params.dateStart) {
          // Parse as Eastern timezone to avoid off-by-one errors
          // e.g., "2025-12-29" should be Dec 29 midnight ET, not UTC
          const startDate = parseAsEastern(params.dateStart, "00:00:00");
          conditions.push(gte(events.startDate, startDate));
          console.log("[queryFilteredEvents] Custom date start:", startDate.toISOString(), "(ET midnight)");
        }
        if (params.dateEnd) {
          // Parse as Eastern timezone, end of day
          const endDate = parseAsEastern(params.dateEnd, "23:59:59");
          conditions.push(lte(events.startDate, endDate));
          console.log("[queryFilteredEvents] Custom date end:", endDate.toISOString(), "(ET end of day)");
        }
        break;
      }
      case "dayOfWeek": {
        if (params.days && params.days.length > 0) {
          // PostgreSQL: EXTRACT(DOW FROM date) returns 0=Sun, 1=Mon, etc.
          const dayConditions = params.days.map(
            (day) => sql`EXTRACT(DOW FROM ${events.startDate}) = ${day}`
          );
          conditions.push(or(...dayConditions)!);
        }
        break;
      }
    }
  }

  // Time of day filter
  if (params.times && params.times.length > 0) {
    const timeConditions: SQL[] = [];

    for (const time of params.times) {
      // PostgreSQL: EXTRACT(HOUR FROM timestamp)
      // Morning: 5-11, Afternoon: 12-16, Evening: 17-23 or 0-2
      switch (time) {
        case "morning":
          timeConditions.push(
            sql`EXTRACT(HOUR FROM ${events.startDate}) BETWEEN 5 AND 11`
          );
          break;
        case "afternoon":
          timeConditions.push(
            sql`EXTRACT(HOUR FROM ${events.startDate}) BETWEEN 12 AND 16`
          );
          break;
        case "evening":
          timeConditions.push(
            or(
              sql`EXTRACT(HOUR FROM ${events.startDate}) >= 17`,
              sql`EXTRACT(HOUR FROM ${events.startDate}) <= 2`
            )!
          );
          break;
      }
    }

    if (timeConditions.length > 0) {
      // Also include events with unknown time
      conditions.push(
        or(sql`${events.timeUnknown} = true`, ...timeConditions)!
      );
    }
  }

  // Tags include (event must have at least one of the included tags)
  if (params.tagsInclude && params.tagsInclude.length > 0) {
    conditions.push(arrayOverlaps(events.tags, params.tagsInclude));
  }

  // Tags exclude (event must not have any excluded tags)
  if (params.tagsExclude && params.tagsExclude.length > 0) {
    // NOT (tags && excluded_tags)
    conditions.push(
      sql`NOT (${events.tags} && ${params.tagsExclude}::text[])`
    );
  }

  // Daily events filter
  if (params.showDailyEvents === false) {
    conditions.push(
      or(isNull(events.recurringType), sql`${events.recurringType} != 'daily'`)!
    );
  }

  // Blocked hosts (organizer contains any blocked string)
  if (params.blockedHosts && params.blockedHosts.length > 0) {
    for (const host of params.blockedHosts) {
      conditions.push(
        or(isNull(events.organizer), notIlike(events.organizer, `%${host}%`))!
      );
    }
  }

  // Search (title, description, organizer, location)
  if (params.search && params.search.trim()) {
    const searchTerm = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(events.title, searchTerm),
        ilike(events.description, searchTerm),
        ilike(events.organizer, searchTerm),
        ilike(events.location, searchTerm)
      )!
    );
  }

  // Define the select fields
  const selectFields = {
    id: events.id,
    sourceId: events.sourceId,
    source: events.source,
    title: events.title,
    description: events.description,
    startDate: events.startDate,
    location: events.location,
    zip: events.zip,
    organizer: events.organizer,
    price: events.price,
    url: events.url,
    imageUrl: events.imageUrl,
    tags: events.tags,
    createdAt: events.createdAt,
    hidden: events.hidden,
    interestedCount: events.interestedCount,
    goingCount: events.goingCount,
    timeUnknown: events.timeUnknown,
    recurringType: events.recurringType,
    recurringEndDate: events.recurringEndDate,
    favoriteCount: events.favoriteCount,
    aiSummary: events.aiSummary,
    updatedAt: events.updatedAt,
    lastSeenAt: events.lastSeenAt,
    score: events.score,
    scoreRarity: events.scoreRarity,
    scoreUnique: events.scoreUnique,
    scoreMagnitude: events.scoreMagnitude,
    scoreReason: events.scoreReason,
  };

  // Client-side filter function - returns true if event passes all filters
  const passesClientFilters = (event: DbEvent): boolean => {
    // Default spam filter
    if (params.useDefaultFilters !== false) {
      const textToCheck = `${event.title} ${event.description || ""} ${event.organizer || ""}`;
      if (matchesDefaultFilter(textToCheck)) {
        return false;
      }
    }

    // Custom blocked keywords
    if (params.blockedKeywords && params.blockedKeywords.length > 0) {
      const titleLower = event.title.toLowerCase();
      if (params.blockedKeywords.some((kw) => titleLower.includes(kw.toLowerCase()))) {
        return false;
      }
    }

    // Hidden fingerprints (title + organizer combo)
    if (params.hiddenFingerprints && params.hiddenFingerprints.length > 0) {
      const eventTitle = event.title.toLowerCase().trim();
      const eventOrganizer = (event.organizer || "").toLowerCase().trim();
      if (
        params.hiddenFingerprints.some(
          (fp) =>
            fp.title.toLowerCase().trim() === eventTitle &&
            fp.organizer.toLowerCase().trim() === eventOrganizer
        )
      ) {
        return false;
      }
    }

    // Price filter (complex logic, easier client-side)
    if (params.priceFilter && params.priceFilter !== "any") {
      const price = parsePrice(event.price);
      const isFree = isFreeEvent(event.price);

      switch (params.priceFilter) {
        case "free":
          if (!isFree) return false;
          break;
        case "under20":
          if (price > 20) return false;
          break;
        case "under100":
          if (price > 100) return false;
          break;
        case "custom":
          if (params.maxPrice !== undefined && price > params.maxPrice) {
            return false;
          }
          break;
      }
    }

    // Location filter (complex logic with known venues)
    if (params.locations && params.locations.length > 0) {
      const eventCity = extractCity(event.location);
      const eventZip = event.zip;
      let matchesLocation = false;

      for (const loc of params.locations) {
        if (loc.toLowerCase() === "asheville") {
          // Asheville area includes known venues + Asheville zips
          if (isAshevilleArea(event.location) || (eventZip && isAshevilleZip(eventZip))) {
            matchesLocation = true;
            break;
          }
        } else if (loc === "Online") {
          if (eventCity === "Online") {
            matchesLocation = true;
            break;
          }
        } else {
          // Specific city match
          if (eventCity === loc) {
            matchesLocation = true;
            break;
          }
        }
      }

      if (!matchesLocation) return false;
    }

    // Zip filter
    if (params.zips && params.zips.length > 0) {
      if (!event.zip || !params.zips.includes(event.zip)) {
        return false;
      }
    }

    return true;
  };

  // Iterative fetch pattern: keep fetching batches until we have enough results
  // This ensures we always return `limit` results (if they exist) even with restrictive client-side filters
  const MAX_ITERATIONS = 10; // Prevent infinite loops
  const BATCH_SIZE = 150; // Fetch 150 events per iteration
  const allFiltered: DbEvent[] = [];
  let currentCursor = params.cursor;
  let lastBatchEvent: DbEvent | null = null;
  let exhaustedResults = false;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Build cursor condition for this batch
    const batchConditions = [...conditions];
    if (currentCursor) {
      const parsed = parseCursor(currentCursor);
      if (parsed) {
        const cursorDateStr = parsed.startDate.toISOString();
        batchConditions.push(
          or(
            sql`${events.startDate} > ${cursorDateStr}`,
            and(
              sql`${events.startDate} = ${cursorDateStr}`,
              sql`${events.id} > ${parsed.id}`
            )
          )!
        );
      }
    }

    // Fetch batch
    const batch = await db
      .select(selectFields)
      .from(events)
      .where(and(...batchConditions))
      .orderBy(asc(events.startDate), asc(events.id))
      .limit(BATCH_SIZE);

    if (batch.length === 0) {
      exhaustedResults = true;
      break;
    }

    // Track last event for next cursor
    lastBatchEvent = batch[batch.length - 1];

    // Apply client-side filters
    const filtered = batch.filter(passesClientFilters);
    allFiltered.push(...filtered);

    if (hasFilters) {
      console.log(`[queryFilteredEvents] Iteration ${iteration + 1}: batch=${batch.length}, filtered=${filtered.length}, total=${allFiltered.length}, target=${limit}`);
    }

    // Check if we have enough results (need limit + 1 to know if there are more)
    if (allFiltered.length > limit) {
      break;
    }

    // Update cursor for next iteration
    currentCursor = createCursor(lastBatchEvent);

    // If batch was smaller than BATCH_SIZE, we've exhausted all results
    if (batch.length < BATCH_SIZE) {
      exhaustedResults = true;
      break;
    }
  }

  // Determine if there are more results
  const hasMore = allFiltered.length > limit && !exhaustedResults;

  // Slice to limit
  const resultEvents = allFiltered.slice(0, limit);

  // Create next cursor from the last returned event
  const nextCursor =
    hasMore && resultEvents.length > 0
      ? createCursor(resultEvents[resultEvents.length - 1])
      : null;

  if (hasFilters) {
    console.log(`[queryFilteredEvents] Final: returning ${resultEvents.length} events, hasMore=${hasMore}`);
  }

  // For total count, we need a separate count query (simplified - just base conditions)
  // This is an approximation since we can't easily count with all client-side filters
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        gte(events.startDate, startOfToday),
        or(
          isNull(events.location),
          and(
            notIlike(events.location, "%online%"),
            notIlike(events.location, "%virtual%")
          )
        )!
      )
    );

  const totalCount = countResult[0]?.count || 0;

  return {
    events: resultEvents,
    nextCursor,
    hasMore,
    totalCount,
  };
}

/**
 * Get metadata for filter dropdowns.
 * Computed from all future events, cached for reuse.
 */
export async function getEventMetadata(): Promise<EventMetadata> {
  const startOfToday = getStartOfTodayEastern();

  const allEvents = await db
    .select({
      tags: events.tags,
      location: events.location,
      zip: events.zip,
    })
    .from(events)
    .where(
      and(
        gte(events.startDate, startOfToday),
        or(isNull(events.hidden), sql`${events.hidden} = false`)!,
        or(
          isNull(events.location),
          and(
            notIlike(events.location, "%online%"),
            notIlike(events.location, "%virtual%")
          )
        )!
      )
    );

  const tagCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const zipCounts = new Map<string, number>();
  let onlineCount = 0;

  const LOCATION_MIN_EVENTS = 6;
  const ZIP_MIN_EVENTS = 6;

  for (const event of allEvents) {
    // Tags
    if (event.tags) {
      for (const tag of event.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    // Locations
    const city = extractCity(event.location);
    if (city === "Online") {
      onlineCount++;
    } else if (city) {
      locationCounts.set(city, (locationCounts.get(city) || 0) + 1);
    }

    // Zips
    if (event.zip) {
      zipCounts.set(event.zip, (zipCounts.get(event.zip) || 0) + 1);
    }
  }

  // Process tags - sorted by frequency
  const availableTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  // Process locations - filtered and sorted with Asheville first
  const availableLocations = Array.from(locationCounts.entries())
    .filter(([city, count]) => city === "Asheville" || count >= LOCATION_MIN_EVENTS)
    .map(([city]) => city)
    .sort((a, b) => {
      if (a === "Asheville") return -1;
      if (b === "Asheville") return 1;
      return a.localeCompare(b);
    });

  if (onlineCount >= LOCATION_MIN_EVENTS) {
    availableLocations.push("Online");
  }

  // Process zips - filtered and sorted by count
  const availableZips = Array.from(zipCounts.entries())
    .filter(([, count]) => count >= ZIP_MIN_EVENTS)
    .sort((a, b) => b[1] - a[1])
    .map(([zip, count]) => ({ zip, count }));

  return { availableTags, availableLocations, availableZips };
}
