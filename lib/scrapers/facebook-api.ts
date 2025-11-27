/**
 * Facebook Bulk API Fetcher
 *
 * Fetches event details from Facebook's bulk-route-definitions API.
 * Uses authenticated session with cookies and CSRF tokens.
 *
 * This API returns minimal event metadata (title, ID, trace policy).
 * For full event details, individual page scraping would be needed.
 */

import { FB_CONFIG, isFacebookEnabled } from '../config/env';
import { log, longDelay } from './facebook-stealth';
import { fetchWithRetry } from '../utils/retry';

/**
 * Structure of the bulk API response
 */
interface BulkAPIResponse {
  payload?: {
    payloads?: {
      [key: string]: {
        error?: boolean;
        result?: {
          type?: string;
          exports?: {
            eventID?: string;
            title?: string;
            activeTab?: string;
            tracePolicy?: string;
            rootView?: {
              props?: {
                eventID?: string;
                activeTab?: string;
              };
            };
            meta?: {
              title?: string;
              accessory?: string | null;
            };
          };
        };
      };
    };
  };
  error?: string;
}

/**
 * Minimal Facebook event data from bulk API
 */
export interface FacebookEventData {
  eventID: string;
  title: string;
  url: string;
}

/**
 * Build cookie string for HTTP request
 */
function buildCookieString(): string {
  const cookies = [
    `c_user=${FB_CONFIG.cookies.c_user}`,
    `xs=${FB_CONFIG.cookies.xs}`,
    `fr=${FB_CONFIG.cookies.fr}`,
    `datr=${FB_CONFIG.cookies.datr}`,
    `sb=${FB_CONFIG.cookies.sb}`,
  ];
  return cookies.join('; ');
}

/**
 * Build the acontext parameter that Facebook requires
 * This tells Facebook the request is coming from the discovery tab
 */
function buildAcontext(): string {
  const context = {
    event_action_history: [
      {
        mechanism: 'discovery_custom_tab',
        surface: 'bookmark',
      },
    ],
    ref_notif_type: null,
  };
  return encodeURIComponent(JSON.stringify(context));
}

/**
 * Build form body for bulk API request
 */
function buildFormBody(eventIds: string[]): string {
  const params = new URLSearchParams();
  const acontext = buildAcontext();

  // Add route URLs for each event WITH acontext parameter (critical!)
  eventIds.forEach((id, index) => {
    params.append(`route_urls[${index}]`, `/events/${id}/?acontext=${acontext}`);
  });

  // Add routing namespace (required for proper response)
  params.append('routing_namespace', 'fb_comet');
  params.append('__aaid', '0');
  params.append('__user', FB_CONFIG.tokens.user!);
  params.append('__a', '1');
  params.append('__req', 'c');
  params.append('__hs', '20417.HCSV2:comet_pkg.2.1...0');
  params.append('dpr', '1');
  params.append('__ccg', 'EXCELLENT');
  params.append('__rev', FB_CONFIG.tokens.rev!);
  params.append('__comet_req', '15');
  params.append('fb_dtsg', FB_CONFIG.tokens.fb_dtsg!);
  params.append('jazoest', FB_CONFIG.tokens.jazoest!);
  params.append('lsd', FB_CONFIG.tokens.lsd!);

  return params.toString();
}

/**
 * Build HTTP headers for bulk API request
 */
function buildHeaders(): Record<string, string> {
  return {
    'Host': 'www.facebook.com',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-FB-LSD': FB_CONFIG.tokens.lsd!,
    'X-ASBD-ID': '359341',
    'Origin': 'https://www.facebook.com',
    'Referer': `https://www.facebook.com/events/?discover_tab=CUSTOM&location_id=${FB_CONFIG.locationId}`,
    'Cookie': buildCookieString(),
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
  };
}

/**
 * Parse the bulk API response
 * Response is prefixed with "for (;;);" for security
 */
function parseResponse(rawText: string): BulkAPIResponse {
  // Strip security prefix
  if (!rawText.startsWith('for (;;);')) {
    throw new Error('Unexpected response format (missing security prefix)');
  }

  const jsonStr = rawText.substring('for (;;);'.length);
  return JSON.parse(jsonStr);
}

/**
 * Extract event data from parsed response
 */
function extractEvents(
  response: BulkAPIResponse,
  requestedIds: string[]
): FacebookEventData[] {
  const events: FacebookEventData[] = [];

  if (!response.payload?.payloads) {
    return events;
  }

  for (const [key, payload] of Object.entries(response.payload.payloads)) {
    if (payload.error || !payload.result?.exports) {
      continue;
    }

    const exports = payload.result.exports;

    // Extract event ID from various possible locations
    const eventID =
      exports.eventID ||
      exports.rootView?.props?.eventID ||
      key.match(/\/events\/(\d+)/)?.[1];

    // Extract title from meta or direct property
    const title =
      exports.meta?.title || exports.title || 'Unknown Event';

    if (eventID) {
      events.push({
        eventID,
        title,
        url: `https://www.facebook.com/events/${eventID}/`,
      });
    }
  }

  return events;
}

/**
 * Fetch event details for a batch of event IDs
 *
 * @param eventIds Array of Facebook event IDs (max 12 recommended)
 * @returns Array of FacebookEventData with basic event info
 */
export async function fetchEventsBatch(
  eventIds: string[]
): Promise<FacebookEventData[]> {
  if (eventIds.length === 0) {
    return [];
  }

  log(`  📡 Fetching batch of ${eventIds.length} events from bulk API...`);

  const body = buildFormBody(eventIds);
  const headers = buildHeaders();

  try {
    const response = await fetchWithRetry(
      'https://www.facebook.com/ajax/bulk-route-definitions/',
      {
        method: 'POST',
        headers,
        body,
      },
      {
        maxRetries: 2,
        baseDelay: 3000,
      }
    );

    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new Error(
          `Authentication failed (${status}). Tokens may have expired.`
        );
      }
      throw new Error(`HTTP ${status}: ${response.statusText}`);
    }

    const rawText = await response.text();
    const parsed = parseResponse(rawText);
    const events = extractEvents(parsed, eventIds);

    log(`  ✅ Fetched ${events.length} events from batch`);
    return events;
  } catch (error) {
    log(`  ❌ Batch fetch error: ${error}`);
    throw error;
  }
}

/**
 * Fetch all events in batches with rate limiting
 *
 * @param eventIds All event IDs to fetch
 * @param batchSize Number of events per batch (default 12)
 * @returns Array of all fetched events
 */
export async function fetchAllEventsBulk(
  eventIds: string[],
  batchSize: number = 12
): Promise<FacebookEventData[]> {
  if (!isFacebookEnabled()) {
    log('⚠️  Facebook scraping is disabled');
    return [];
  }

  log(`📡 Fetching ${eventIds.length} events in batches of ${batchSize}...`);

  const allEvents: FacebookEventData[] = [];
  const totalBatches = Math.ceil(eventIds.length / batchSize);

  for (let i = 0; i < eventIds.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const batch = eventIds.slice(i, i + batchSize);

    log(`  Batch ${batchNum}/${totalBatches} (${batch.length} events)`);

    try {
      const events = await fetchEventsBatch(batch);
      allEvents.push(...events);
    } catch (error) {
      log(`  ⚠️  Batch ${batchNum} failed: ${error}`);
      // Continue with other batches instead of failing completely
    }

    // Rate limiting between batches
    if (i + batchSize < eventIds.length) {
      log('  ⏳ Rate limiting (3-5s delay)...');
      await longDelay();
    }
  }

  log(`📊 Total events fetched: ${allEvents.length}/${eventIds.length}`);
  return allEvents;
}

/**
 * Quick test of the bulk API with known event IDs
 */
export async function testBulkAPI(): Promise<{
  success: boolean;
  events: FacebookEventData[];
  error?: string;
}> {
  // Use event IDs from the original HAR file for testing
  const testIds = [
    '3755760114724043',
    '1562072804992939',
    '2534071006975664',
  ];

  try {
    const events = await fetchEventsBatch(testIds);
    return {
      success: true,
      events,
    };
  } catch (error) {
    return {
      success: false,
      events: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
