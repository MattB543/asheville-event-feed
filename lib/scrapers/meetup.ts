import { ScrapedEvent, MeetupApiEvent } from './types';
import { withRetry } from '@/lib/utils/retry';
import { isNonNCEvent } from '@/lib/utils/locationFilter';

/**
 * Meetup Scraper - Date-Range Based Approach
 *
 * Uses Meetup's gql2 endpoint with persisted queries to fetch PHYSICAL events
 * day-by-day. This approach bypasses the ~380 event limit of the recommendedEvents
 * endpoint by querying each day separately.
 *
 * Key features:
 * - Filters to PHYSICAL events only (no online/virtual events)
 * - Fetches events day-by-day for comprehensive coverage
 * - Uses persisted queries (same as Meetup website)
 * - Includes Asheville-area location filtering
 */

// Asheville, NC coordinates (matching Meetup's precision)
const ASHEVILLE_LAT = 35.59000015258789;
const ASHEVILLE_LON = -82.55999755859375;

// Meetup GraphQL endpoint (gql2 with persisted queries)
const ENDPOINT = "https://www.meetup.com/gql2";

// SHA256 hash for the recommendedEventsWithSeries persisted query
const PERSISTED_QUERY_HASH = "4eda170f69bd7288f7433435dedbd1b2192b7351f8e5bc7b067e27a51d4974d2";

// Request headers
const API_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
  "Accept": "*/*",
  "Accept-Language": "en-US",
  "apollographql-client-name": "nextjs-web",
  "Referer": "https://www.meetup.com/find/",
  "Origin": "https://www.meetup.com",
};

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface MeetupGql2Event {
  id: string;
  title: string;
  description?: string;
  dateTime: string;
  eventType: string;
  eventUrl: string;
  featuredEventPhoto?: {
    baseUrl?: string;
    highResUrl?: string;
    id?: string;
  };
  feeSettings?: {
    amount?: number;
    currency?: string;
  };
  group?: {
    id?: string;
    name?: string;
    urlname?: string;
    timezone?: string;
    city?: string;
    state?: string;
  };
}

interface Gql2Response {
  data?: {
    result?: {
      pageInfo: PageInfo;
      totalCount?: number;
      edges: Array<{
        node: MeetupGql2Event;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Fetch og:image from a Meetup event page
 * Used as fallback when GraphQL doesn't return featuredEventPhoto
 */
async function fetchOgImage(eventUrl: string): Promise<string | null> {
  try {
    const response = await fetch(eventUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Try og:image meta tag (most reliable)
    let imageUrl: string | null = null;
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
    if (ogImageMatch) {
      imageUrl = ogImageMatch[1];
    }

    // Try alternate pattern (content before property)
    if (!imageUrl) {
      const ogImageMatch2 = html.match(/content="([^"]+)"[^>]*property="og:image"/);
      if (ogImageMatch2) {
        imageUrl = ogImageMatch2[1];
      }
    }

    // Filter out Meetup's generic fallback/placeholder images
    if (imageUrl && (
      imageUrl.includes('/images/fallbacks/') ||
      imageUrl.includes('group-cover') ||
      imageUrl.includes('default_photo')
    )) {
      return null;
    }

    return imageUrl;
  } catch (error) {
    console.warn(`[Meetup] Failed to fetch og:image for ${eventUrl}:`, error);
    return null;
  }
}

/**
 * Fetch events for a specific date range from Meetup's gql2 API
 */
async function fetchEventsForDateRange(
  startDate: string,
  endDate: string,
  cursor?: string,
  pageSize: number = 50
): Promise<{
  events: MeetupGql2Event[];
  pageInfo: PageInfo;
}> {
  const variables: Record<string, unknown> = {
    first: pageSize,
    lat: ASHEVILLE_LAT,
    lon: ASHEVILLE_LON,
    startDateRange: startDate,
    endDateRange: endDate,
    eventType: 'PHYSICAL',  // Only fetch in-person events
    numberOfEventsForSeries: 5,
    seriesStartDate: startDate.split('T')[0],
    sortField: "RELEVANCE",
    doConsolidateEvents: true,
    doPromotePaypalEvents: false,
    indexAlias: '"{\"filterOutWrongLanguage\": \"true\",\"modelVersion\": \"split_offline_online\"}"',
    dataConfiguration: '{"isSimplifiedSearchEnabled": true, "include_events_from_user_chapters": true}',
  };

  if (cursor) {
    variables.after = cursor;
  }

  const body = {
    operationName: "recommendedEventsWithSeries",
    variables,
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: PERSISTED_QUERY_HASH,
      },
    },
  };

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Meetup API error: ${response.status} ${response.statusText}`);
  }

  const data: Gql2Response = await response.json();

  if (data.errors && data.errors.length > 0) {
    console.error("[Meetup] GraphQL errors:", data.errors.map(e => e.message));
    return { events: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }

  const result = data.data?.result;
  if (!result) {
    return { events: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }

  const events = result.edges?.map(edge => edge.node) || [];

  return {
    events,
    pageInfo: {
      hasNextPage: result.pageInfo.hasNextPage,
      endCursor: result.pageInfo.endCursor,
    },
  };
}

/**
 * Fetch all events for a specific date
 */
async function fetchAllEventsForDate(date: Date): Promise<MeetupGql2Event[]> {
  const dateStr = date.toISOString().split('T')[0];
  const startDate = `${dateStr}T00:00:00-05:00`;
  const endDate = `${dateStr}T23:59:59-05:00`;

  const allEvents: MeetupGql2Event[] = [];
  let cursor: string | undefined;
  let page = 0;
  let hasMore = true;
  const maxPagesPerDay = 10;  // Safety limit

  while (hasMore && page < maxPagesPerDay) {
    page++;

    const result = await withRetry(
      () => fetchEventsForDateRange(startDate, endDate, cursor, 50),
      { maxRetries: 2, baseDelay: 1000 }
    );

    allEvents.push(...result.events);

    hasMore = result.pageInfo.hasNextPage;
    cursor = result.pageInfo.endCursor || undefined;

    // Rate limit between pages
    if (hasMore) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return allEvents;
}

/**
 * Format a Meetup event to our standard ScrapedEvent format
 */
function formatMeetupEvent(event: MeetupGql2Event): ScrapedEvent {
  // Format price
  let price = "Free";
  if (event.feeSettings?.amount && event.feeSettings.amount > 0) {
    const amount = Math.round(event.feeSettings.amount);
    price = `$${amount}`;
  }

  // Get location from group
  const city = event.group?.city || "";
  const state = event.group?.state || "";
  let location = city && state ? `${city}, ${state}` : city || "Asheville, NC";

  // Get organizer from group
  const organizer = event.group?.name || event.group?.urlname || "Meetup";

  // Get image URL
  let imageUrl = "";
  const photo = event.featuredEventPhoto;
  if (photo?.highResUrl) {
    imageUrl = photo.highResUrl.replace('/highres_', '/600_');
  }

  return {
    sourceId: event.id,
    source: 'MEETUP',
    title: event.title || "Untitled Event",
    description: event.description || "",
    startDate: new Date(event.dateTime),
    location: location,
    organizer: organizer,
    price: price,
    url: event.eventUrl,
    imageUrl: imageUrl,
  };
}

// Asheville-area patterns for filtering
const ASHEVILLE_AREA_PATTERNS = [
  /\basheville\b/i,
  /\bwnc\b/i,
  /\bwestern north carolina\b/i,
  /\bavl\b/i,
  /\bblack mountain\b/i,
  /\bweaverville\b/i,
  /\bhendersonville\b/i,
  /\bbrevard\b/i,
  /\barden\b/i,
  /\bfletcher\b/i,
  /\bswannanoa\b/i,
  /\bcandler\b/i,
  /\bwaynesville\b/i,
  /\bmars hill\b/i,
  /\bwoodfin\b/i,
  /\bmills river\b/i,
];

/**
 * Check if an event is Asheville-related
 */
function isAshevilleRelated(event: MeetupGql2Event): boolean {
  const groupCity = event.group?.city?.toLowerCase() || '';
  const groupState = event.group?.state?.toLowerCase() || '';

  // NC-based groups in Asheville area
  if (groupState === 'nc' && ASHEVILLE_AREA_PATTERNS.some(p => p.test(groupCity))) {
    return true;
  }

  // Check group name for Asheville references
  const groupName = event.group?.name || '';
  const groupUrlname = event.group?.urlname || '';
  if (ASHEVILLE_AREA_PATTERNS.some(p => p.test(groupName) || p.test(groupUrlname))) {
    return true;
  }

  // Check event title for Asheville references
  const title = event.title || '';
  if (ASHEVILLE_AREA_PATTERNS.some(p => p.test(title))) {
    return true;
  }

  // Physical events in NC - be lenient since we're already filtering by location
  if (groupState === 'nc') {
    return true;
  }

  return false;
}

/**
 * Scrape Meetup events near Asheville, NC
 *
 * Uses the date-range approach to fetch PHYSICAL events day-by-day,
 * bypassing the API's recommendation limit.
 *
 * @param daysToFetch Number of days to fetch (default 30)
 * @returns Array of scraped events filtered to NC area
 */
export async function scrapeMeetup(daysToFetch: number = 30): Promise<ScrapedEvent[]> {
  const PAGE_DELAY_MS = 500;  // Delay between days
  const IMAGE_BATCH_SIZE = 5;
  const IMAGE_BATCH_DELAY_MS = 1000;

  console.log(`[Meetup] Starting date-range scrape (${daysToFetch} days, PHYSICAL events only)...`);

  const allEvents = new Map<string, MeetupGql2Event>();
  const startDate = new Date();

  for (let i = 0; i < daysToFetch; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    try {
      const events = await fetchAllEventsForDate(date);

      let newCount = 0;
      for (const event of events) {
        if (!allEvents.has(event.id)) {
          allEvents.set(event.id, event);
          newCount++;
        }
      }

      // Log progress every 5 days or on first/last day
      if (i === 0 || i === daysToFetch - 1 || (i + 1) % 5 === 0) {
        console.log(`[Meetup] Day ${i + 1}/${daysToFetch} (${dateStr}): ${events.length} events, ${newCount} new. Total: ${allEvents.size}`);
      }

      // Rate limit between days
      if (i < daysToFetch - 1) {
        await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
      }
    } catch (error) {
      console.error(`[Meetup] Error fetching ${dateStr}:`, error);
      // Continue with next day
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`[Meetup] Fetched ${allEvents.size} unique physical events`);

  // Filter to Asheville-related events
  const ashevilleEvents = Array.from(allEvents.values()).filter(isAshevilleRelated);
  const filteredOut = allEvents.size - ashevilleEvents.length;

  if (filteredOut > 0) {
    console.log(`[Meetup] Filtered out ${filteredOut} non-Asheville events`);
  }

  // Convert to ScrapedEvent format
  const formattedEvents = ashevilleEvents.map(formatMeetupEvent);

  // Apply standard non-NC filter
  const ncEvents = formattedEvents.filter(ev => !isNonNCEvent(ev.title, ev.location));
  const ncFilteredCount = formattedEvents.length - ncEvents.length;

  if (ncFilteredCount > 0) {
    console.log(`[Meetup] Filtered out ${ncFilteredCount} non-NC events`);
  }

  // Fetch missing images
  const eventsWithoutImages = ncEvents.filter(ev => !ev.imageUrl);
  if (eventsWithoutImages.length > 0) {
    console.log(`[Meetup] Fetching images for ${eventsWithoutImages.length} events...`);

    for (let i = 0; i < eventsWithoutImages.length; i += IMAGE_BATCH_SIZE) {
      const batch = eventsWithoutImages.slice(i, i + IMAGE_BATCH_SIZE);

      await Promise.all(batch.map(async (event) => {
        const ogImage = await fetchOgImage(event.url);
        if (ogImage) {
          event.imageUrl = ogImage;
        }
      }));

      if (i + IMAGE_BATCH_SIZE < eventsWithoutImages.length) {
        await new Promise(r => setTimeout(r, IMAGE_BATCH_DELAY_MS));
      }
    }

    const fetched = eventsWithoutImages.filter(ev => ev.imageUrl).length;
    console.log(`[Meetup] Fetched ${fetched}/${eventsWithoutImages.length} images`);
  }

  console.log(`[Meetup] Complete. Found ${ncEvents.length} Asheville-area physical events.`);
  return ncEvents;
}
