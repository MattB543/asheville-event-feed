import { ScrapedEvent } from './types';
import { withRetry } from '@/lib/utils/retry';
import { isNonNCEvent } from '@/lib/utils/geo';
import { getEasternOffset } from '@/lib/utils/timezone';
import { getZipFromCoords, getZipFromCity } from '@/lib/utils/geo';
import { tryExtractPrice } from '@/lib/utils/parsers';

/**
 * Meetup Scraper - Date-Range Based Approach
 *
 * Uses Meetup's gql2 GraphQL endpoint to fetch PHYSICAL events day-by-day.
 * This approach bypasses the ~380 event limit by querying each day separately.
 *
 * Key features:
 * - Filters to PHYSICAL events only (no online/virtual events)
 * - Fetches events day-by-day for comprehensive coverage
 * - Uses the recommendedEvents query with full query text
 * - Includes Asheville-area location filtering
 *
 * Note: As of Dec 2024, Meetup deprecated the old persisted query hash approach.
 * The scraper now sends the full GraphQL query text instead.
 */

// Asheville, NC coordinates (matching Meetup's precision)
const ASHEVILLE_LAT = 35.59000015258789;
const ASHEVILLE_LON = -82.55999755859375;

// Meetup GraphQL endpoint
const ENDPOINT = "https://www.meetup.com/gql2";

// Full GraphQL query (Meetup removed support for the old persisted query hash)
const RECOMMENDED_EVENTS_QUERY = `
  query recommendedEvents(
    $first: Int,
    $after: String,
    $filter: RecommendedEventsFilter!,
    $sort: RecommendedEventsSort
  ) {
    recommendedEvents(
      first: $first,
      after: $after,
      filter: $filter,
      sort: $sort
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
      edges {
        node {
          id
          title
          description
          dateTime
          eventType
          eventUrl
          featuredEventPhoto {
            baseUrl
            highResUrl
            id
          }
          feeSettings {
            amount
            currency
          }
          group {
            id
            name
            urlname
            timezone
            city
            state
          }
        }
      }
    }
  }
`;

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
    recommendedEvents?: {
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
 * Venue data extracted from Meetup event page HTML
 */
interface MeetupVenue {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lon?: number;
}

/**
 * Data extracted from Meetup event page HTML
 */
interface MeetupPageData {
  imageUrl: string | null;
  venue: MeetupVenue | null;
  price: string | null;
}

/**
 * Fetch og:image, venue, and price data from a Meetup event page
 * Extracts data from embedded Apollo cache JSON and page content
 */
async function fetchEventPageData(eventUrl: string): Promise<MeetupPageData> {
  const result: MeetupPageData = { imageUrl: null, venue: null, price: null };

  try {
    const response = await fetch(eventUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) return result;

    const html = await response.text();

    // Extract og:image
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/)
      || html.match(/content="([^"]+)"[^>]*property="og:image"/);

    if (ogImageMatch) {
      const imageUrl = ogImageMatch[1];
      // Filter out Meetup's generic fallback/placeholder images
      if (!imageUrl.includes('/images/fallbacks/') &&
          !imageUrl.includes('group-cover') &&
          !imageUrl.includes('default_photo')) {
        result.imageUrl = imageUrl;
      }
    }

    // Extract venue from embedded Apollo cache JSON
    // Pattern: "Venue:12345":{"__typename":"Venue","id":"12345","name":"...","address":"...","city":"...","state":"..."}
    const venueMatch = html.match(/"Venue:\d+":\{[^}]+\}/);
    if (venueMatch) {
      try {
        // Parse the JSON value (need to wrap in braces to make valid JSON)
        const venueJson = venueMatch[0].replace(/"Venue:\d+":/, '');
        const venueData = JSON.parse(venueJson);

        result.venue = {
          name: venueData.name,
          address: venueData.address,
          city: venueData.city,
          state: venueData.state,
          lat: venueData.lat,
          lon: venueData.lon || venueData.lng,
        };
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Extract price/fee from Apollo cache JSON
    // Pattern: "feeSettings":{"__typename":"FeeSettings","amount":25,"currency":"USD"}
    const feeMatch = html.match(/"feeSettings":\s*\{[^}]*"amount":\s*(\d+(?:\.\d+)?)[^}]*\}/);
    if (feeMatch) {
      const amount = Math.round(parseFloat(feeMatch[1]));
      if (amount > 0) {
        result.price = `$${amount}`;
      } else {
        result.price = 'Free';
      }
    }

    // If no fee in Apollo cache, try extracting from visible page content
    if (!result.price) {
      // Look for common price patterns in the HTML text content
      // Strip HTML tags for cleaner text search
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');

      // Use the existing price extraction utility
      const extracted = tryExtractPrice(textContent, null, null, 'low');
      if (extracted && extracted !== 'Unknown') {
        result.price = extracted;
      }
    }

    return result;
  } catch (error) {
    console.warn(`[Meetup] Failed to fetch page data for ${eventUrl}:`, error);
    return result;
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
  // Build the filter object for the new recommendedEvents query
  // Note: Date range filters require full ISO format with timezone (e.g., 2025-12-17T00:00:00-05:00)
  const filter: Record<string, unknown> = {
    lat: ASHEVILLE_LAT,
    lon: ASHEVILLE_LON,
    startDateRange: startDate, // Full ISO format with timezone
    endDateRange: endDate,
    eventType: 'PHYSICAL',  // Only fetch in-person events
  };

  const variables: Record<string, unknown> = {
    first: pageSize,
    filter,
    sort: { sortField: "RELEVANCE" },
  };

  if (cursor) {
    variables.after = cursor;
  }

  const body = {
    operationName: "recommendedEvents",
    query: RECOMMENDED_EVENTS_QUERY,
    variables,
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

  const result = data.data?.recommendedEvents;
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
  // Get correct Eastern offset for this date (handles DST)
  const offset = getEasternOffset(dateStr);
  const startDate = `${dateStr}T00:00:00${offset}`;
  const endDate = `${dateStr}T23:59:59${offset}`;

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
  // Be more conservative: only mark as "Free" if we have explicit fee info with amount = 0
  // If feeSettings is missing entirely, mark as "Unknown" (don't assume free)
  let price: string;
  if (event.feeSettings) {
    if (event.feeSettings.amount && event.feeSettings.amount > 0) {
      const amount = Math.round(event.feeSettings.amount);
      price = `$${amount}`;
    } else {
      // feeSettings exists but amount is 0 or undefined - likely free
      price = "Free";
    }
  } else {
    // No feeSettings at all - try to extract from title + description
    // Combine title and description for better extraction coverage
    const searchText = `${event.title || ''}\n${event.description || ''}`;
    // Use 'low' confidence threshold to catch more prices
    // Default to "Free" since most Meetup events are free community gatherings
    price = tryExtractPrice(searchText, 'Free', event.group?.name, 'low');
  }

  // Get location from group
  const city = event.group?.city || "";
  const state = event.group?.state || "";
  const location = city && state ? `${city}, ${state}` : city || "Asheville, NC";

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

  // Apply standard non-NC filter and skip online events
  const ncEvents = formattedEvents.filter(ev => {
    // Skip online events
    if (ev.location?.toLowerCase() === 'online') return false;
    // Skip non-NC events
    return !isNonNCEvent(ev.title, ev.location);
  });
  const ncFilteredCount = formattedEvents.length - ncEvents.length;

  if (ncFilteredCount > 0) {
    console.log(`[Meetup] Filtered out ${ncFilteredCount} non-NC events`);
  }

  // Fetch venue data, prices, and missing images from event pages
  // We need to fetch all events to get venue/zip/price data since GraphQL doesn't return it
  console.log(`[Meetup] Fetching page data for ${ncEvents.length} events...`);

  let venuesFetched = 0;
  let imagesFetched = 0;
  let pricesFetched = 0;

  for (let i = 0; i < ncEvents.length; i += IMAGE_BATCH_SIZE) {
    const batch = ncEvents.slice(i, i + IMAGE_BATCH_SIZE);

    await Promise.all(batch.map(async (event) => {
      const pageData = await fetchEventPageData(event.url);

      // Update image if we don't have one and page has one
      if (!event.imageUrl && pageData.imageUrl) {
        event.imageUrl = pageData.imageUrl;
        imagesFetched++;
      }

      // Update price if we don't have one and page has one
      if (event.price === 'Unknown' && pageData.price) {
        event.price = pageData.price;
        pricesFetched++;
      }

      // Update venue data if available
      if (pageData.venue) {
        // Build better location string with venue address
        if (pageData.venue.address && pageData.venue.city && pageData.venue.state) {
          event.location = `${pageData.venue.name || ''}, ${pageData.venue.address}, ${pageData.venue.city}, ${pageData.venue.state}`.replace(/^, /, '');
        } else if (pageData.venue.name && pageData.venue.city) {
          event.location = `${pageData.venue.name}, ${pageData.venue.city}, ${pageData.venue.state || 'NC'}`;
        }
        // Calculate zip from lat/lon coordinates or fall back to city name
        event.zip = getZipFromCoords(pageData.venue.lat, pageData.venue.lon)
          || getZipFromCity(pageData.venue.city);
        venuesFetched++;
      }
    }));

    if (i + IMAGE_BATCH_SIZE < ncEvents.length) {
      await new Promise(r => setTimeout(r, IMAGE_BATCH_DELAY_MS));
    }
  }

  console.log(`[Meetup] Fetched ${venuesFetched} venues, ${imagesFetched} images, ${pricesFetched} prices`);

  console.log(`[Meetup] Complete. Found ${ncEvents.length} Asheville-area physical events.`);
  return ncEvents;
}
