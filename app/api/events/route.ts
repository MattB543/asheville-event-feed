import { NextRequest, NextResponse } from "next/server";
import {
  queryFilteredEvents,
  getEventMetadata,
  EventFilterParams,
} from "@/lib/db/queries/events";
import { unstable_cache } from "next/cache";

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
    const body = await request.json();
    const { searchParams } = new URL(request.url);

    // Merge URL params with body params (body takes precedence)
    const params: EventFilterParams = {
      cursor: body.cursor || searchParams.get("cursor") || undefined,
      limit: Math.min(body.limit || parseInt(searchParams.get("limit") || "50", 10), 100),
      search: body.search || searchParams.get("search") || undefined,
      dateFilter: body.dateFilter || searchParams.get("dateFilter") || undefined,
      dateStart: body.dateStart || searchParams.get("dateStart") || undefined,
      dateEnd: body.dateEnd || searchParams.get("dateEnd") || undefined,
      days: body.days || parseNumberArray(searchParams.get("days")),
      times: body.times || parseArray(searchParams.get("times")) as EventFilterParams["times"],
      priceFilter: body.priceFilter || searchParams.get("priceFilter") || undefined,
      maxPrice: body.maxPrice ?? (searchParams.get("maxPrice")
        ? parseFloat(searchParams.get("maxPrice")!)
        : undefined),
      tagsInclude: body.tagsInclude || parseArray(searchParams.get("tagsInclude")),
      tagsExclude: body.tagsExclude || parseArray(searchParams.get("tagsExclude")),
      locations: body.locations || parseArray(searchParams.get("locations")),
      zips: body.zips || parseArray(searchParams.get("zips")),
      blockedHosts: body.blockedHosts || parseArray(searchParams.get("blockedHosts")),
      blockedKeywords: body.blockedKeywords || parseArray(searchParams.get("blockedKeywords")),
      hiddenFingerprints: body.hiddenFingerprints,
      useDefaultFilters: body.useDefaultFilters ?? searchParams.get("useDefaultFilters") !== "false",
      showDailyEvents: body.showDailyEvents ?? searchParams.get("showDailyEvents") !== "false",
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
      body.includeMetadata === true ||
      searchParams.get("includeMetadata") === "true" ||
      (body.includeMetadata !== false &&
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
