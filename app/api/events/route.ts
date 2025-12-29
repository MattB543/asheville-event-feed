import { NextResponse, type NextRequest } from "next/server";
import {
  queryFilteredEvents,
  getEventMetadata,
  type EventFilterParams,
} from "@/lib/db/queries/events";
import { unstable_cache } from "next/cache";
import {
  isBoolean,
  isNumber,
  isNumberArray,
  isRecord,
  isString,
  isStringArray,
} from "@/lib/utils/validation";

// Cache metadata separately (less volatile than filtered events)
const getCachedMetadata = unstable_cache(
  async () => getEventMetadata(),
  ["events-metadata"],
  { tags: ["events"], revalidate: 3600 }
);

// Parse comma-separated string to array
function parseArray(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// Parse comma-separated numbers to array
function parseNumberArray(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

type DateFilter = NonNullable<EventFilterParams["dateFilter"]>;
type PriceFilter = NonNullable<EventFilterParams["priceFilter"]>;

const DATE_FILTERS = new Set<DateFilter>([
  "all",
  "today",
  "tomorrow",
  "weekend",
  "custom",
  "dayOfWeek",
]);

const PRICE_FILTERS = new Set<PriceFilter>([
  "any",
  "free",
  "under20",
  "under100",
  "custom",
]);

type TimeFilter = NonNullable<EventFilterParams["times"]>[number];

const TIME_FILTERS = new Set<TimeFilter>([
  "morning",
  "afternoon",
  "evening",
]);

function isDateFilter(value: string): value is DateFilter {
  return DATE_FILTERS.has(value as DateFilter);
}

function isPriceFilter(value: string): value is PriceFilter {
  return PRICE_FILTERS.has(value as PriceFilter);
}

function parseDateFilter(
  value: unknown
): EventFilterParams["dateFilter"] | undefined {
  return isString(value) && isDateFilter(value) ? value : undefined;
}

function parsePriceFilter(value: unknown): EventFilterParams["priceFilter"] | undefined {
  return isString(value) && isPriceFilter(value) ? value : undefined;
}

function parseTimes(value: unknown): EventFilterParams["times"] | undefined {
  if (!isStringArray(value)) return undefined;
  const times = value.filter(
    (time): time is TimeFilter => TIME_FILTERS.has(time as TimeFilter)
  );
  return times.length > 0 ? times : undefined;
}

function parseHiddenFingerprints(
  value: unknown
): EventFilterParams["hiddenFingerprints"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fingerprints = value.flatMap((entry) => {
    if (!isRecord(entry) || !isString(entry.title)) return [];
    const organizer = isString(entry.organizer) ? entry.organizer : "";
    return [{ title: entry.title, organizer }];
  });
  return fingerprints.length > 0 ? fingerprints : undefined;
}

/**
 * GET /api/events
 *
 * Paginated event listing with server-side filtering.
 *
 * Query params:
 *   - cursor: Pagination cursor (startDate_id)
 *   - limit: Results per page (default 50, max 100)
 *   - search: Text search (title, description, organizer, location)
 *   - dateFilter: all | today | tomorrow | weekend | custom | dayOfWeek
 *   - dateStart: YYYY-MM-DD for custom range
 *   - dateEnd: YYYY-MM-DD for custom range
 *   - days: Comma-separated day of week (0=Sun to 6=Sat)
 *   - times: Comma-separated time of day (morning, afternoon, evening)
 *   - priceFilter: any | free | under20 | under100 | custom
 *   - maxPrice: Number for custom price filter
 *   - tagsInclude: Comma-separated tags to include
 *   - tagsExclude: Comma-separated tags to exclude
 *   - locations: Comma-separated location names (or "asheville" for area)
 *   - zips: Comma-separated zip codes
 *   - blockedHosts: Comma-separated organizer substrings to block
 *   - blockedKeywords: Comma-separated keywords to block
 *   - useDefaultFilters: "true" or "false" (default true)
 *   - showDailyEvents: "true" or "false" (default true)
 *   - includeMetadata: "true" to include filter dropdown metadata (default true on first page)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Log incoming request params for debugging
    const paramsObj = Object.fromEntries(searchParams.entries());
    if (Object.keys(paramsObj).length > 0) {
      console.log("[API /events GET] Received params:", paramsObj);
    }

    // Parse filter params
    const params: EventFilterParams = {
      cursor: searchParams.get("cursor") || undefined,
      limit: Math.min(parseInt(searchParams.get("limit") || "50", 10), 100),
      search: searchParams.get("search") || undefined,
      dateFilter: (searchParams.get("dateFilter") as EventFilterParams["dateFilter"]) || undefined,
      dateStart: searchParams.get("dateStart") || undefined,
      dateEnd: searchParams.get("dateEnd") || undefined,
      days: parseNumberArray(searchParams.get("days")),
      times: parseArray(searchParams.get("times")) as EventFilterParams["times"],
      priceFilter: (searchParams.get("priceFilter") as EventFilterParams["priceFilter"]) || undefined,
      maxPrice: searchParams.get("maxPrice")
        ? parseFloat(searchParams.get("maxPrice")!)
        : undefined,
      tagsInclude: parseArray(searchParams.get("tagsInclude")),
      tagsExclude: parseArray(searchParams.get("tagsExclude")),
      locations: parseArray(searchParams.get("locations")),
      zips: parseArray(searchParams.get("zips")),
      blockedHosts: parseArray(searchParams.get("blockedHosts")),
      blockedKeywords: parseArray(searchParams.get("blockedKeywords")),
      useDefaultFilters: searchParams.get("useDefaultFilters") !== "false",
      showDailyEvents: searchParams.get("showDailyEvents") !== "false",
    };

    // Clean up empty arrays
    if (params.days?.length === 0) params.days = undefined;
    if (params.times?.length === 0) params.times = undefined;
    if (params.tagsInclude?.length === 0) params.tagsInclude = undefined;
    if (params.tagsExclude?.length === 0) params.tagsExclude = undefined;
    if (params.locations?.length === 0) params.locations = undefined;
    if (params.zips?.length === 0) params.zips = undefined;
    if (params.blockedHosts?.length === 0) params.blockedHosts = undefined;
    if (params.blockedKeywords?.length === 0) params.blockedKeywords = undefined;

    // Log parsed filter params for debugging
    const activeFilters = {
      dateFilter: params.dateFilter,
      dateStart: params.dateStart,
      dateEnd: params.dateEnd,
      priceFilter: params.priceFilter,
      tagsInclude: params.tagsInclude,
      search: params.search,
    };
    const hasActiveFilters = Object.values(activeFilters).some(v => v !== undefined && (Array.isArray(v) ? v.length > 0 : true));
    if (hasActiveFilters) {
      console.log("[API /events GET] Active filters:", activeFilters);
    }

    // Query events
    const result = await queryFilteredEvents(params);

    if (hasActiveFilters) {
      console.log(`[API /events GET] Query returned ${result.events.length} events (total: ${result.totalCount})`);
    }

    // Include metadata on first page by default (no cursor)
    const includeMetadata =
      searchParams.get("includeMetadata") === "true" ||
      (searchParams.get("includeMetadata") !== "false" && !params.cursor);

    let metadata = undefined;
    if (includeMetadata) {
      metadata = await getCachedMetadata();
    }

    return NextResponse.json({
      events: result.events,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      metadata,
    });
  } catch (error) {
    console.error("[API /events] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/events
 *
 * Alternative endpoint for complex filters (hidden fingerprints).
 * Body: { ...filter params, hiddenFingerprints: [{ title, organizer }] }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const body = parsed;
    const { searchParams } = new URL(request.url);

    // Merge URL params with body params (body takes precedence)
    const bodyCursor = isString(body.cursor) ? body.cursor : undefined;
    const bodyLimit = isNumber(body.limit) ? body.limit : undefined;
    const bodySearch = isString(body.search) ? body.search : undefined;
    const bodyDateFilter = parseDateFilter(body.dateFilter);
    const bodyDateStart = isString(body.dateStart) ? body.dateStart : undefined;
    const bodyDateEnd = isString(body.dateEnd) ? body.dateEnd : undefined;
    const bodyDays = isNumberArray(body.days) ? body.days : undefined;
    const bodyTimes = parseTimes(body.times);
    const bodyPriceFilter = parsePriceFilter(body.priceFilter);
    const bodyMaxPrice = isNumber(body.maxPrice)
      ? body.maxPrice
      : isString(body.maxPrice)
        ? parseFloat(body.maxPrice)
        : undefined;
    const bodyTagsInclude = isStringArray(body.tagsInclude)
      ? body.tagsInclude
      : undefined;
    const bodyTagsExclude = isStringArray(body.tagsExclude)
      ? body.tagsExclude
      : undefined;
    const bodyLocations = isStringArray(body.locations)
      ? body.locations
      : undefined;
    const bodyZips = isStringArray(body.zips) ? body.zips : undefined;
    const bodyBlockedHosts = isStringArray(body.blockedHosts)
      ? body.blockedHosts
      : undefined;
    const bodyBlockedKeywords = isStringArray(body.blockedKeywords)
      ? body.blockedKeywords
      : undefined;
    const bodyHiddenFingerprints = parseHiddenFingerprints(body.hiddenFingerprints);
    const bodyUseDefaultFilters = isBoolean(body.useDefaultFilters)
      ? body.useDefaultFilters
      : undefined;
    const bodyShowDailyEvents = isBoolean(body.showDailyEvents)
      ? body.showDailyEvents
      : undefined;
    const bodyIncludeMetadata = isBoolean(body.includeMetadata)
      ? body.includeMetadata
      : undefined;

    const params: EventFilterParams = {
      cursor: bodyCursor || searchParams.get("cursor") || undefined,
      limit: Math.min(
        bodyLimit ?? parseInt(searchParams.get("limit") || "50", 10),
        100
      ),
      search: bodySearch || searchParams.get("search") || undefined,
      dateFilter:
        bodyDateFilter ||
        parseDateFilter(searchParams.get("dateFilter")) ||
        undefined,
      dateStart: bodyDateStart || searchParams.get("dateStart") || undefined,
      dateEnd: bodyDateEnd || searchParams.get("dateEnd") || undefined,
      days: bodyDays || parseNumberArray(searchParams.get("days")),
      times: bodyTimes || parseArray(searchParams.get("times")) as EventFilterParams["times"],
      priceFilter:
        bodyPriceFilter ||
        parsePriceFilter(searchParams.get("priceFilter")) ||
        undefined,
      maxPrice:
        bodyMaxPrice ??
        (searchParams.get("maxPrice")
          ? parseFloat(searchParams.get("maxPrice")!)
          : undefined),
      tagsInclude: bodyTagsInclude || parseArray(searchParams.get("tagsInclude")),
      tagsExclude: bodyTagsExclude || parseArray(searchParams.get("tagsExclude")),
      locations: bodyLocations || parseArray(searchParams.get("locations")),
      zips: bodyZips || parseArray(searchParams.get("zips")),
      blockedHosts:
        bodyBlockedHosts || parseArray(searchParams.get("blockedHosts")),
      blockedKeywords:
        bodyBlockedKeywords || parseArray(searchParams.get("blockedKeywords")),
      hiddenFingerprints: bodyHiddenFingerprints,
      useDefaultFilters:
        bodyUseDefaultFilters ?? searchParams.get("useDefaultFilters") !== "false",
      showDailyEvents:
        bodyShowDailyEvents ?? searchParams.get("showDailyEvents") !== "false",
    };

    // Clean up empty arrays
    if (params.days?.length === 0) params.days = undefined;
    if (params.times?.length === 0) params.times = undefined;
    if (params.tagsInclude?.length === 0) params.tagsInclude = undefined;
    if (params.tagsExclude?.length === 0) params.tagsExclude = undefined;
    if (params.locations?.length === 0) params.locations = undefined;
    if (params.zips?.length === 0) params.zips = undefined;
    if (params.blockedHosts?.length === 0) params.blockedHosts = undefined;
    if (params.blockedKeywords?.length === 0) params.blockedKeywords = undefined;
    if (params.hiddenFingerprints?.length === 0) params.hiddenFingerprints = undefined;

    // Query events
    const result = await queryFilteredEvents(params);

    // Include metadata on first page by default
    const includeMetadata =
      bodyIncludeMetadata === true ||
      searchParams.get("includeMetadata") === "true" ||
      (bodyIncludeMetadata !== false &&
        searchParams.get("includeMetadata") !== "false" &&
        !params.cursor);

    let metadata = undefined;
    if (includeMetadata) {
      metadata = await getCachedMetadata();
    }

    return NextResponse.json({
      events: result.events,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      metadata,
    });
  } catch (error) {
    console.error("[API /events POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
