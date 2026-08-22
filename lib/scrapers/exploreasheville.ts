/**
 * ExploreAsheville.com Scraper
 *
 * Scrapes events from the ExploreAsheville.com public API.
 * Uses curl for HTTP requests as the API blocks Node.js fetch (TLS fingerprinting).
 */

import { type ScrapedEvent } from './types';
import { isNonNCEvent } from '@/lib/utils/geo';
import { getZipFromCoords, getZipFromCity } from '@/lib/utils/geo';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parseAsEastern } from '@/lib/utils/timezone';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import { DEFAULT_FETCH_TIMEOUT_MS, HttpResponseError } from '@/lib/utils/retry';

const execAsync = promisify(exec);

/**
 * Parse a date string from the API as Eastern Time.
 * The API returns dates like "2025-12-12T10:00:00.000Z" but the times are actually ET,
 * not UTC. We strip the Z and interpret the wall clock as America/New_York.
 */
function parseAsEasternTime(dateStr: string): Date {
  const [datePart, timePart = '00:00:00'] = dateStr.replace(/Z$/, '').split('T');
  const [hours = '00', minutes = '00', seconds = '00'] = timePart.split(':');
  const pad = (value: string) => String(parseInt(value, 10) || 0).padStart(2, '0');
  return parseAsEastern(datePart, `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
}

// API Configuration
const API_URL = 'https://www.exploreasheville.com/api/getListingGridData';
const BASE_URL = 'https://www.exploreasheville.com';
const PAGE_SIZE = 50;
const MAX_PAGES = 15;
const DELAY_MS = 200;

// Headers for curl - mimics a real Firefox browser request
const CURL_HEADERS = [
  '-H "Accept: */*"',
  '-H "Accept-Language: en-US,en;q=0.5"',
  // Avoid br since Windows curl can fail with CURLE_BAD_CONTENT_ENCODING (code 61)
  '-H "Accept-Encoding: gzip, deflate"',
  '-H "Referer: https://www.exploreasheville.com/events"',
  '-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"',
  '-H "Connection: keep-alive"',
  '-H "Sec-Fetch-Dest: empty"',
  '-H "Sec-Fetch-Mode: cors"',
  '-H "Sec-Fetch-Site: same-origin"',
  '-H "DNT: 1"',
  '-H "Priority: u=4"',
  '--compressed', // Handle gzip/br compression
].join(' ');

/**
 * API Response Types
 */
interface ExploreAshevilleEvent {
  id: number;
  listingId: string;
  title: string;
  path: string;
  previewImage?: {
    src: string;
    alt: string;
  };
  dates?: string[];
  nextDate?: string;
  startDate?: string;
  endDate?: string;
  venueName?: string;
  partnerName?: string;
  cities?: Array<{ id: string; name: string }>;
  position?: { lat: number; lng: number };
  website?: string;
  recurringLabel?: string;
}

interface ExploreAshevilleResponse {
  pageInfo: {
    page: number;
    pageSize: number;
    total: number;
    offset: number;
  };
  results: ExploreAshevilleEvent[];
}

// Headers for native fetch - mimics a real Firefox browser request
const FETCH_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://www.exploreasheville.com/events',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  Connection: 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  DNT: '1',
  Priority: 'u=4',
};

/**
 * Curl-fallback state, scoped to a single scrape run rather than the module —
 * a warm lambda must not stay stuck on curl because one request 403'd.
 */
export interface CurlFallbackState {
  useCurl: boolean;
}

export function createCurlFallbackState(): CurlFallbackState {
  return { useCurl: false };
}

/**
 * Fetch a URL with curl (bypasses TLS fingerprinting, for local dev).
 * Only used for this site's own API/detail URLs, which we build ourselves.
 */
async function runCurl(url: string): Promise<string> {
  const maxTimeSeconds = Math.ceil(DEFAULT_FETCH_TIMEOUT_MS / 1000);
  const command = `curl -s --max-time ${maxTimeSeconds} "${url}" ${CURL_HEADERS}`;
  const { stdout } = await execAsync(command, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: DEFAULT_FETCH_TIMEOUT_MS + 1000,
  });
  return stdout;
}

/**
 * Fetch a URL with native fetch, throwing an HttpResponseError (carrying the
 * status) so callers can branch on 403 instead of substring-matching messages.
 */
async function runNativeFetch(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    cache: 'no-store',
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new HttpResponseError(response.status, response.statusText, url);
  }
  return response;
}

function isForbidden(error: unknown): boolean {
  return error instanceof HttpResponseError && error.status === 403;
}

/**
 * Fetch text with fallback: try native fetch first, then curl on a 403
 */
async function fetchText(url: string, state: CurlFallbackState): Promise<string> {
  if (state.useCurl) {
    return runCurl(url);
  }

  try {
    const response = await runNativeFetch(url);
    return await response.text();
  } catch (error) {
    if (isForbidden(error)) {
      state.useCurl = true;
      return runCurl(url);
    }
    throw error;
  }
}

/**
 * Fetch event description from detail page
 * Extracts from og:description meta tag
 * Exported for use in cron route to fetch descriptions for new events
 */
export async function fetchEventDescription(
  pathOrUrl: string,
  state: CurlFallbackState = createCurlFallbackState()
): Promise<string | undefined> {
  try {
    // Handle both full URLs and paths
    const fullUrl = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const html = await fetchText(fullUrl, state);

    // Try og:description first (usually cleaner)
    let match =
      html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:description"/i);

    // Fallback to regular description meta tag
    if (!match) {
      match =
        html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
        html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
    }

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
    return undefined;
  } catch {
    // Silently fail - description is optional
    return undefined;
  }
}

/**
 * Fetch API with fallback: try native fetch first, then curl
 * Native fetch may work on Vercel but get blocked locally (TLS fingerprinting)
 */
async function fetchAPI(url: string, state: CurlFallbackState): Promise<ExploreAshevilleResponse> {
  // If we already know fetch is blocked, go straight to curl
  if (state.useCurl) {
    return JSON.parse(await runCurl(url)) as ExploreAshevilleResponse;
  }

  try {
    const response = await runNativeFetch(url);
    return (await response.json()) as ExploreAshevilleResponse;
  } catch (error) {
    // A 403 is the TLS-fingerprinting block; fall back to curl for this run
    if (isForbidden(error)) {
      console.log('[ExploreAsheville] Native fetch blocked, using curl fallback...');
      state.useCurl = true;
      return JSON.parse(await runCurl(url)) as ExploreAshevilleResponse;
    }
    throw error;
  }
}

/**
 * Scrape events from ExploreAsheville.com API
 */
export async function scrapeExploreAsheville(): Promise<ScrapedEvent[]> {
  console.log('[ExploreAsheville] Starting API-based scrape...');

  const allEvents: ScrapedEvent[] = [];
  let totalFetched = 0;
  const fallbackState = createCurlFallbackState();

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        type: 'event',
        page: page.toString(),
        pageSize: PAGE_SIZE.toString(),
        sortValue: 'next_date',
        sortOrder: 'ASC',
      });

      console.log(`[ExploreAsheville] Fetching page ${page}...`);

      const url = `${API_URL}?${params}`;
      const data = await fetchAPI(url, fallbackState);
      const events = data.results || [];

      console.log(
        `[ExploreAsheville] Page ${page}: ${events.length} events (total in API: ${data.pageInfo.total})`
      );

      // Format events (may return multiple for weekly/monthly recurring)
      for (const event of events) {
        const formatted = formatEvents(event);
        allEvents.push(...formatted);
      }

      totalFetched += events.length;

      // Check if we've fetched all events
      if (events.length < PAGE_SIZE || totalFetched >= data.pageInfo.total) {
        console.log(`[ExploreAsheville] Reached end of results`);
        break;
      }

      // Rate limiting
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (error) {
      console.error(`[ExploreAsheville] Error fetching page ${page}:`, error);
      break;
    }
  }

  // Filter out non-NC events
  const ncEvents = allEvents.filter((ev) => !isNonNCEvent(ev.title, ev.location));
  const filteredCount = allEvents.length - ncEvents.length;

  if (filteredCount > 0) {
    console.log(`[ExploreAsheville] Filtered out ${filteredCount} non-NC events`);
  }

  console.log(
    `[ExploreAsheville] Finished. Found ${ncEvents.length} NC events (${allEvents.length} total)`
  );
  return ncEvents;
}

// Max occurrences to create for weekly/monthly recurring events
const MAX_RECURRING_OCCURRENCES = 10;

/**
 * Format event(s) from the API response
 * - Daily recurring: ONE event with recurringType='daily' and recurringEndDate
 * - Weekly/Monthly recurring: Multiple events (up to MAX_RECURRING_OCCURRENCES)
 * - Non-recurring: Single event
 */
function formatEvents(event: ExploreAshevilleEvent, description?: string): ScrapedEvent[] {
  const dateStrings = event.dates || [];
  const now = new Date();

  // Filter to future dates only, keeping both original string and parsed date
  // Use parseAsEasternTime since API returns ET times with incorrect Z suffix
  const futureDatePairs = dateStrings
    .map((str) => ({ str, date: parseAsEasternTime(str) }))
    .filter(({ date }) => !isNaN(date.getTime()) && date > now);

  if (futureDatePairs.length === 0) {
    return [];
  }

  const futureDates = futureDatePairs.map((p) => p.date);
  const futureDateStrs = futureDatePairs.map((p) => p.str);

  // Build common fields
  const cityName = event.cities?.[0]?.name || 'Asheville';
  const location = event.venueName ? `${event.venueName}, ${cityName}, NC` : `${cityName}, NC`;

  // Calculate zip from coordinates or fall back to city name
  const zip =
    getZipFromCoords(event.position?.lat, event.position?.lng) || getZipFromCity(cityName);

  let imageUrl = event.previewImage?.src;
  if (imageUrl) {
    // The API returns image URLs with %3A (encoded colon) and no file extension,
    // which 404 on their server. The working URLs use "-" instead and end with .jpg.
    // e.g. broken: /sites/default/files/listing_images/eu-west-1%3Aced5e211-...-filename_jfif
    //      working: /sites/default/files/listing_images/eu-west-1-ced5e211-...-filename_jfif.jpg
    imageUrl = imageUrl.replace(/%3A/gi, '-');
    if (!/\.(jpe?g|png|gif|webp|avif)$/i.test(imageUrl)) {
      imageUrl += '.jpg';
    }
    if (imageUrl.startsWith('/')) {
      imageUrl = `${BASE_URL}${imageUrl}`;
    }
  }

  const organizer = event.partnerName || event.venueName || undefined;
  const url = `${BASE_URL}${event.path}`;

  // Helper to check if original time string was midnight (date-only, no specific time)
  // We check the original string because after ET->UTC conversion, midnight ET becomes 05:00 UTC
  const isTimeUnknownStr = (dateStr: string) => {
    return dateStr.includes('T00:00:00');
  };

  // Handle daily recurring events - store as ONE event with recurring metadata
  if (event.recurringLabel === 'Recurring Daily') {
    const startDate = futureDates[0];
    const endDate = futureDates[futureDates.length - 1];

    return [
      {
        sourceId: `ea-${event.listingId}`,
        source: 'EXPLORE_ASHEVILLE',
        title: event.title,
        description,
        startDate,
        location,
        zip,
        organizer,
        url,
        imageUrl,
        timeUnknown: isTimeUnknownStr(futureDateStrs[0]),
        recurringType: 'daily',
        recurringEndDate: endDate,
      },
    ];
  }

  // Handle weekly/monthly recurring - create individual events (limited)
  if (event.recurringLabel === 'Recurring Weekly' || event.recurringLabel === 'Recurring Monthly') {
    const pairsToUse = futureDatePairs.slice(0, MAX_RECURRING_OCCURRENCES);

    return pairsToUse.map(({ str, date }, index) => ({
      // Add index to sourceId to make each occurrence unique
      sourceId: `ea-${event.listingId}-${index}`,
      source: 'EXPLORE_ASHEVILLE' as const,
      title: event.title,
      description,
      startDate: date,
      location,
      zip,
      organizer,
      // Add date to URL to make each occurrence unique (URL is unique constraint)
      url: `${url}#${date.toISOString().split('T')[0]}`,
      imageUrl,
      timeUnknown: isTimeUnknownStr(str),
    }));
  }

  // Non-recurring or unknown - single event
  const startDate = futureDates[0];
  return [
    {
      sourceId: `ea-${event.listingId}`,
      source: 'EXPLORE_ASHEVILLE',
      title: event.title,
      description,
      startDate,
      location,
      zip,
      organizer,
      url,
      imageUrl,
      timeUnknown: isTimeUnknownStr(futureDateStrs[0]),
    },
  ];
}

// Allow running standalone for testing
if (require.main === module || process.argv[1]?.includes('exploreasheville')) {
  scrapeExploreAsheville()
    .then((events) => {
      console.log('\n' + '='.repeat(60));
      console.log('SCRAPE RESULTS');
      console.log('='.repeat(60));
      console.log(`Total events: ${events.length}`);

      console.log('\nSample events (first 15):');
      console.log('-'.repeat(60));
      for (const event of events.slice(0, 15)) {
        console.log(`\n${event.title}`);
        console.log(`  Date: ${event.startDate.toLocaleString()}`);
        console.log(`  Location: ${event.location || 'N/A'}`);
        console.log(`  Organizer: ${event.organizer || 'N/A'}`);
        console.log(`  URL: ${event.url}`);
        if (event.timeUnknown) {
          console.log(`  Time: Unknown (date only)`);
        }
        if (event.recurringType === 'daily') {
          console.log(`  Recurring: Daily until ${event.recurringEndDate?.toLocaleDateString()}`);
        }
      }

      console.log('\n✅ Scrape complete!');
    })
    .catch((error) => {
      console.error('❌ Scrape failed:', error);
      process.exit(1);
    });
}
