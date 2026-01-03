/**
 * Facebook GraphQL API Module
 *
 * Fetches full event details using Facebook's GraphQL API.
 * Two queries are used:
 * 1. EventCometPermalinkHeaderQuery - title, date, place, image
 * 2. PublicEventCometAboutRootQuery - description
 */

import { FB_CONFIG } from '../config/env';
import { log } from './facebook-stealth';

const GRAPHQL_ENDPOINT = 'https://www.facebook.com/api/graphql/';

// GraphQL doc IDs discovered from HAR analysis
const DOC_IDS = {
  header: '24852752747670056', // EventCometPermalinkHeaderQuery
  about: '24522924877384967', // PublicEventCometAboutRootQuery
};

/**
 * Complete event data from GraphQL queries
 */
export interface FacebookGraphQLEvent {
  eventId: string;
  title: string;
  description: string | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
  dateFormatted: string | null;
  location: string | null;
  address: string | null;
  imageUrl: string | null;
  price: string | null;
  url: string;
  organizer: string | null;
}

/**
 * Build cookie string for requests
 */
function buildCookieString(): string {
  return [
    `c_user=${FB_CONFIG.cookies.c_user}`,
    `xs=${FB_CONFIG.cookies.xs}`,
    `fr=${FB_CONFIG.cookies.fr}`,
    `datr=${FB_CONFIG.cookies.datr}`,
    `sb=${FB_CONFIG.cookies.sb}`,
  ].join('; ');
}

/**
 * Build common headers for GraphQL requests
 */
function buildHeaders(queryName: string): Record<string, string> {
  return {
    Host: 'www.facebook.com',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-FB-Friendly-Name': queryName,
    'X-FB-LSD': FB_CONFIG.tokens.lsd!,
    Origin: 'https://www.facebook.com',
    Referer: 'https://www.facebook.com/events/',
    Cookie: buildCookieString(),
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };
}

/**
 * Build form body for GraphQL request
 */
function buildGraphQLBody(
  docId: string,
  variables: Record<string, unknown>,
  queryName: string
): string {
  const params = new URLSearchParams();

  params.append('av', FB_CONFIG.tokens.user!);
  params.append('__aaid', '0');
  params.append('__user', FB_CONFIG.tokens.user!);
  params.append('__a', '1');
  params.append('__req', 'a');
  params.append('__hs', '20417.HCSV2:comet_pkg.2.1...0');
  params.append('dpr', '1');
  params.append('__ccg', 'EXCELLENT');
  params.append('__rev', FB_CONFIG.tokens.rev!);
  params.append('__comet_req', '15');
  params.append('fb_dtsg', FB_CONFIG.tokens.fb_dtsg!);
  params.append('jazoest', FB_CONFIG.tokens.jazoest!);
  params.append('lsd', FB_CONFIG.tokens.lsd!);
  params.append('__spin_r', FB_CONFIG.tokens.rev!);
  params.append('__spin_b', 'trunk');
  params.append('__spin_t', Math.floor(Date.now() / 1000).toString());
  params.append('fb_api_caller_class', 'RelayModern');
  params.append('fb_api_req_friendly_name', queryName);
  params.append('variables', JSON.stringify(variables));
  params.append('doc_id', docId);

  return params.toString();
}

/**
 * Parse streaming JSON response (multiple JSON objects separated by newlines)
 */
function parseStreamingResponse(text: string): unknown[] {
  const results: unknown[] = [];
  const lines = text.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return results;
}

/**
 * Fetch event header data (title, date, place, image)
 */
async function fetchEventHeader(eventId: string): Promise<{
  title: string | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
  dateFormatted: string | null;
  location: string | null;
  imageUrl: string | null;
  price: string | null;
  organizer: string | null;
}> {
  const queryName = 'EventCometPermalinkHeaderQuery';
  const variables = {
    eventID: eventId,
    isCrawler: false,
    scale: 1,
  };

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(queryName),
      body: buildGraphQLBody(DOC_IDS.header, variables, queryName),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    const chunks = parseStreamingResponse(text);

    // Find the main data chunk
    for (const chunk of chunks) {
      const data = chunk as { data?: { event?: Record<string, unknown> } };
      if (data?.data?.event) {
        const event = data.data.event;

        // Extract cover image
        let imageUrl: string | null = null;
        const coverMedia = event.cover_media_renderer as
          | {
              cover_photo?: {
                photo?: {
                  full_image?: { uri?: string };
                };
              };
            }
          | undefined;
        if (coverMedia?.cover_photo?.photo?.full_image?.uri) {
          imageUrl = coverMedia.cover_photo.photo.full_image.uri;
        }

        // Extract place
        const place = event.event_place as { name?: string } | undefined;

        // Extract price
        const priceInfo = event.price_info as { summary?: string } | undefined;

        // Extract organizer from page_as_owner or created_for_group
        let organizer: string | null = null;
        const pageOwner = event.page_as_owner as { name?: string } | undefined;
        if (pageOwner?.name) {
          organizer = pageOwner.name;
        }

        return {
          title: (event.name as string) || null,
          startTimestamp: (event.start_timestamp as number) || null,
          endTimestamp: (event.end_timestamp as number) || null,
          dateFormatted: (event.day_time_sentence as string) || null,
          location: place?.name || null,
          imageUrl,
          price: priceInfo?.summary || null,
          organizer,
        };
      }
    }

    return {
      title: null,
      startTimestamp: null,
      endTimestamp: null,
      dateFormatted: null,
      location: null,
      imageUrl: null,
      price: null,
      organizer: null,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`    ⚠️ Header query failed for ${eventId}: ${errorMessage}`);
    return {
      title: null,
      startTimestamp: null,
      endTimestamp: null,
      dateFormatted: null,
      location: null,
      imageUrl: null,
      price: null,
      organizer: null,
    };
  }
}

/**
 * Fetch event description and organizer (about page data)
 */
async function fetchEventAbout(eventId: string): Promise<{
  description: string | null;
  organizer: string | null;
}> {
  const queryName = 'PublicEventCometAboutRootQuery';
  const variables = {
    eventID: eventId,
    isLoggedOut: false,
    scale: 1,
  };

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(queryName),
      body: buildGraphQLBody(DOC_IDS.about, variables, queryName),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    const chunks = parseStreamingResponse(text);

    let description: string | null = null;
    let organizer: string | null = null;

    // Find description and organizer in chunks
    for (const chunk of chunks) {
      const data = chunk as {
        data?: {
          event?: {
            event_description?: { text?: string };
            event_creator?: { name?: string };
          };
        };
      };

      if (data?.data?.event) {
        const event = data.data.event;
        if (event.event_description?.text && !description) {
          description = event.event_description.text;
        }
        if (event.event_creator?.name && !organizer) {
          organizer = event.event_creator.name;
        }
      }
    }

    return { description, organizer };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`    ⚠️ About query failed for ${eventId}: ${errorMessage}`);
    return { description: null, organizer: null };
  }
}

/**
 * Fetch complete event data using both GraphQL queries
 */
export async function fetchEventDetails(eventId: string): Promise<FacebookGraphQLEvent | null> {
  // Fetch header and about data in parallel
  const [header, about] = await Promise.all([fetchEventHeader(eventId), fetchEventAbout(eventId)]);

  // If we couldn't get a title, the event might not exist
  if (!header.title) {
    return null;
  }

  return {
    eventId,
    title: header.title,
    description: about.description,
    startTimestamp: header.startTimestamp,
    endTimestamp: header.endTimestamp,
    dateFormatted: header.dateFormatted,
    location: header.location,
    address: header.location, // Same for now
    imageUrl: header.imageUrl,
    price: header.price,
    url: `https://www.facebook.com/events/${eventId}/`,
    organizer: about.organizer || header.organizer, // Prefer about query, fallback to header
  };
}

/**
 * Fetch details for multiple events with rate limiting
 */
export async function fetchAllEventDetails(
  eventIds: string[],
  options: {
    concurrency?: number;
    delayMs?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<FacebookGraphQLEvent[]> {
  const { concurrency = 3, delayMs = 1000, onProgress } = options;
  const results: FacebookGraphQLEvent[] = [];
  let completed = 0;

  log(`📡 Fetching details for ${eventIds.length} events (concurrency: ${concurrency})...`);

  // Process in batches
  for (let i = 0; i < eventIds.length; i += concurrency) {
    const batch = eventIds.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (eventId) => {
        const event = await fetchEventDetails(eventId);
        completed++;
        onProgress?.(completed, eventIds.length);
        return event;
      })
    );

    // Add non-null results
    for (const result of batchResults) {
      if (result) {
        results.push(result);
      }
    }

    // Rate limiting delay between batches
    if (i + concurrency < eventIds.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  log(`✅ Fetched ${results.length}/${eventIds.length} events successfully`);
  return results;
}

/**
 * Test the GraphQL API with a single event
 */
export async function testGraphQLAPI(eventId: string): Promise<{
  success: boolean;
  event: FacebookGraphQLEvent | null;
  error?: string;
}> {
  try {
    const event = await fetchEventDetails(eventId);
    return {
      success: !!event,
      event,
    };
  } catch (error) {
    return {
      success: false,
      event: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
