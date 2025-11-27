import { ScrapedEvent, MeetupApiEvent, MeetupGraphQLResponse } from './types';
import { withRetry } from '@/lib/utils/retry';
import { isNonNCEvent } from '@/lib/utils/locationFilter';

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
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
    if (ogImageMatch) {
      return ogImageMatch[1];
    }

    // Try alternate pattern (content before property)
    const ogImageMatch2 = html.match(/content="([^"]+)"[^>]*property="og:image"/);
    if (ogImageMatch2) {
      return ogImageMatch2[1];
    }

    return null;
  } catch (error) {
    console.warn(`[Meetup Scraper] Failed to fetch og:image for ${eventUrl}:`, error);
    return null;
  }
}

// Asheville, NC coordinates
const ASHEVILLE_LAT = 35.5951;
const ASHEVILLE_LON = -82.5515;

// Meetup GraphQL endpoint (public, no auth required)
const ENDPOINT = "https://api.meetup.com/gql-ext";

// GraphQL query for recommended events by location
const EVENTS_QUERY = `
  query($lat: Float!, $lon: Float!, $first: Int, $after: String) {
    recommendedEvents(filter: { lat: $lat, lon: $lon }, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          description
          dateTime
          endTime
          eventType
          eventUrl
          rsvpState
          maxTickets

          featuredEventPhoto {
            id
            baseUrl
            highResUrl
          }

          feeSettings {
            amount
            currency
          }

          group {
            id
            name
            urlname
            city
            state
            country
          }
        }
      }
    }
  }
`;

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * Fetch a single page of events from Meetup GraphQL API
 */
async function fetchPage(cursor?: string): Promise<{ events: MeetupApiEvent[]; pageInfo: PageInfo }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      query: EVENTS_QUERY,
      variables: {
        lat: ASHEVILLE_LAT,
        lon: ASHEVILLE_LON,
        first: 50,
        after: cursor,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const data: MeetupGraphQLResponse = await response.json();

  if (data.errors && data.errors.length > 0) {
    console.error("[Meetup Scraper] GraphQL errors:", data.errors.map(e => e.message));
    return { events: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }

  const result = data.data?.recommendedEvents;
  if (!result) {
    return { events: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }

  const events = result.edges.map(edge => edge.node);
  return {
    events,
    pageInfo: result.pageInfo,
  };
}

/**
 * Format a Meetup API event to our standard ScrapedEvent format
 */
function formatMeetupEvent(event: MeetupApiEvent): ScrapedEvent {
  // Format price (rounded to nearest dollar)
  let price = "Free";
  if (event.feeSettings?.amount && event.feeSettings.amount > 0) {
    const amount = Math.round(event.feeSettings.amount);
    price = `$${amount}`;
  }

  // Get location from group (venue details not available in public API)
  const city = event.group?.city || "";
  const state = event.group?.state || "";
  let location = "Online";
  if (city && state) {
    location = `${city}, ${state}`;
  } else if (city) {
    location = city;
  }

  // For online events, mark location appropriately
  if (event.eventType === 'ONLINE') {
    location = "Online";
  }

  // Get organizer from group
  const organizer = event.group?.name || event.group?.urlname || "Meetup";

  // Get image URL - prefer highResUrl (complete URL), construct from id if needed
  let imageUrl = "";
  const photo = event.featuredEventPhoto;
  if (photo) {
    if (photo.highResUrl) {
      // highResUrl is a complete, valid URL - use it directly
      // Convert highres to 600px version for consistency
      imageUrl = photo.highResUrl.replace('/highres_', '/600_');
    } else if (photo.id && photo.baseUrl) {
      // Construct URL from baseUrl and id (baseUrl alone is not valid)
      // Pattern: https://secure.meetupstatic.com/photos/event/X/X/X/600_PHOTOID.jpeg
      // But we don't have the path segments, so skip this approach
      imageUrl = ""; // Will be fetched via og:image fallback
    }
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

// Asheville-area cities for filtering (case insensitive)
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
 * For online events, we check if the group name suggests Asheville connection
 * For physical events, we check the group's city
 */
function isAshevilleRelated(event: MeetupApiEvent): boolean {
  // Check group city - physical events in Asheville area
  const groupCity = event.group?.city?.toLowerCase() || '';
  const groupState = event.group?.state?.toLowerCase() || '';

  // NC-based groups in Asheville area
  if (groupState === 'nc' && ASHEVILLE_AREA_PATTERNS.some(p => p.test(groupCity))) {
    return true;
  }

  // Check group name for Asheville references (catches "AVL Digital Nomads", "Asheville Runners", etc.)
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

  // Physical events in NC without specific city match - be lenient
  if (event.eventType === 'PHYSICAL' && groupState === 'nc') {
    return true;
  }

  return false;
}

/**
 * Scrape Meetup events near Asheville, NC
 *
 * Uses the public GraphQL API (no authentication required) to fetch events
 * by location with cursor-based pagination.
 *
 * @param maxPages Maximum number of pages to fetch (default 5, ~250 events)
 * @returns Array of scraped events filtered to NC area
 */
export async function scrapeMeetup(maxPages: number = 5): Promise<ScrapedEvent[]> {
  console.log(`[Meetup Scraper] Starting fetch (max ${maxPages} pages)...`);

  const allEvents: MeetupApiEvent[] = [];
  let pageInfo: PageInfo = { hasNextPage: true, endCursor: null };
  let page = 0;

  while (pageInfo.hasNextPage && page < maxPages) {
    page++;
    try {
      console.log(`[Meetup Scraper] Fetching page ${page}/${maxPages}...`);

      // Use retry wrapper for resilience
      const result = await withRetry(
        () => fetchPage(pageInfo.endCursor || undefined),
        { maxRetries: 2, baseDelay: 1000 }
      );

      console.log(`[Meetup Scraper] Page ${page}: ${result.events.length} events (hasNextPage: ${result.pageInfo.hasNextPage})`);

      allEvents.push(...result.events);
      pageInfo = result.pageInfo;

      // Rate limit: polite delay between pages
      if (pageInfo.hasNextPage && page < maxPages) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (error) {
      console.error(`[Meetup Scraper] Error fetching page ${page}:`, error);
      break;
    }
  }

  // Deduplicate by ID (events can appear in multiple pages)
  const uniqueEvents = new Map<string, MeetupApiEvent>();
  for (const event of allEvents) {
    uniqueEvents.set(event.id, event);
  }

  console.log(`[Meetup Scraper] Deduped: ${uniqueEvents.size} unique events from ${allEvents.length} total`);

  // First filter: Only keep Asheville-related events
  const ashevilleEvents = Array.from(uniqueEvents.values()).filter(isAshevilleRelated);
  const ashevilleFilteredCount = uniqueEvents.size - ashevilleEvents.length;

  if (ashevilleFilteredCount > 0) {
    console.log(`[Meetup Scraper] Filtered out ${ashevilleFilteredCount} non-Asheville events`);
  }

  // Convert to ScrapedEvent format
  const formattedEvents = ashevilleEvents.map(formatMeetupEvent);

  // Second filter: Apply standard non-NC filter (catches edge cases)
  const ncEvents = formattedEvents.filter(ev => !isNonNCEvent(ev.title, ev.location));
  const ncFilteredCount = formattedEvents.length - ncEvents.length;

  if (ncFilteredCount > 0) {
    console.log(`[Meetup Scraper] Filtered out ${ncFilteredCount} non-NC events`);
  }

  // Fetch missing images from event pages (og:image fallback)
  const eventsWithoutImages = ncEvents.filter(ev => !ev.imageUrl);
  if (eventsWithoutImages.length > 0) {
    console.log(`[Meetup Scraper] Fetching images for ${eventsWithoutImages.length} events without photos...`);

    // Process in batches of 5 to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < eventsWithoutImages.length; i += batchSize) {
      const batch = eventsWithoutImages.slice(i, i + batchSize);

      await Promise.all(batch.map(async (event) => {
        const ogImage = await fetchOgImage(event.url);
        if (ogImage) {
          event.imageUrl = ogImage;
        }
      }));

      // Small delay between batches
      if (i + batchSize < eventsWithoutImages.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    const fetched = eventsWithoutImages.filter(ev => ev.imageUrl).length;
    console.log(`[Meetup Scraper] Fetched ${fetched}/${eventsWithoutImages.length} missing images`);
  }

  console.log(`[Meetup Scraper] Finished. Found ${ncEvents.length} Asheville-area events.`);
  return ncEvents;
}
