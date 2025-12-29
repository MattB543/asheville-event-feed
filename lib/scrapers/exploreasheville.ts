/**
 * ExploreAsheville.com Scraper
 *
 * Scrapes events from the ExploreAsheville.com public API.
 * Uses curl for HTTP requests as the API blocks Node.js fetch (TLS fingerprinting).
 */

import { ScrapedEvent } from './types';
import { isNonNCEvent } from '@/lib/utils/geo';
import { getZipFromCoords, getZipFromCity } from '@/lib/utils/geo';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Parse a date string from the API as Eastern Time.
 * The API returns dates like "2025-12-12T10:00:00.000Z" but the times are actually ET,
 * not UTC. We need to strip the Z and interpret as America/New_York timezone.
 */
function parseAsEasternTime(dateStr: string): Date {
  // Remove the Z suffix if present - the times are NOT actually UTC
  const cleanedStr = dateStr.replace(/Z$/, '');

  // Parse the date components
  const [datePart, timePart] = cleanedStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes, seconds] = (timePart || '00:00:00').split(':').map(s => parseFloat(s));

  // Create a date string with explicit ET timezone
  // Format: "2025-12-12T10:00:00" in America/New_York
  const dateInET = new Date(
    Date.UTC(year, month - 1, day, hours, Math.floor(minutes), Math.floor(seconds || 0))
  );

  // Calculate Eastern Time offset (handles DST automatically)
  // ET is UTC-5 (EST) or UTC-4 (EDT)
  const etOffset = getEasternTimeOffset(dateInET);

  // Adjust from "fake UTC" (which is actually ET) to real UTC
  // If API says 10:00Z but means 10:00 ET, we need to ADD the offset to get UTC
  return new Date(dateInET.getTime() + etOffset * 60 * 60 * 1000);
}

/**
 * Get the Eastern Time offset for a given date (handles DST).
 * Returns hours to add to convert from ET to UTC (5 for EST, 4 for EDT).
 */
function getEasternTimeOffset(date: Date): number {
  // Use Intl to determine if DST is in effect for the given date
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);

  const janOffset = getTimezoneOffsetForDate(jan);
  const julOffset = getTimezoneOffsetForDate(jul);
  const dateOffset = getTimezoneOffsetForDate(date);

  // In ET: EST (standard) = UTC-5, EDT (daylight) = UTC-4
  // The offset with MORE negative minutes is standard time
  const standardOffset = Math.max(janOffset, julOffset);

  // If current date has the standard offset, it's EST (return 5)
  // Otherwise it's EDT (return 4)
  return dateOffset === standardOffset ? 5 : 4;
}

/**
 * Get timezone offset in minutes for a specific date using America/New_York
 */
function getTimezoneOffsetForDate(date: Date): number {
  // Create formatter for America/New_York
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';

  const etYear = parseInt(getPart('year'));
  const etMonth = parseInt(getPart('month')) - 1;
  const etDay = parseInt(getPart('day'));
  const etHour = parseInt(getPart('hour'));
  const etMinute = parseInt(getPart('minute'));
  const etSecond = parseInt(getPart('second'));

  // Create a Date from ET components (as if they were UTC)
  const etAsUtc = Date.UTC(etYear, etMonth, etDay, etHour, etMinute, etSecond);

  // The difference between UTC time and "ET as UTC" gives us the offset
  return Math.round((date.getTime() - etAsUtc) / (60 * 1000));
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
  '-H "Accept-Encoding: gzip, deflate, br"',
  '-H "Referer: https://www.exploreasheville.com/events"',
  '-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"',
  '-H "Connection: keep-alive"',
  '-H "Sec-Fetch-Dest: empty"',
  '-H "Sec-Fetch-Mode: cors"',
  '-H "Sec-Fetch-Site: same-origin"',
  '-H "DNT: 1"',
  '-H "Priority: u=4"',
  '--compressed',  // Handle gzip/br compression
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
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  Connection: 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  DNT: '1',
  Priority: 'u=4',
};

/**
 * Fetch a page using native fetch (works on Vercel, may be blocked locally)
 */
async function fetchWithNativeFetch(
  url: string
): Promise<ExploreAshevilleResponse> {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as ExploreAshevilleResponse;
}

/**
 * Fetch a page using curl (bypasses TLS fingerprinting, for local dev)
 */
async function fetchWithCurl(url: string): Promise<ExploreAshevilleResponse> {
  const command = `curl -s "${url}" ${CURL_HEADERS}`;
  const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as ExploreAshevilleResponse;
}

// Track if we need to use curl fallback (persists across requests in same scrape session)
let useCurlFallback = false;

/**
 * Fetch HTML page with fallback: try native fetch first, then curl
 */
async function fetchHTML(url: string): Promise<string> {
  if (useCurlFallback) {
    const command = `curl -s "${url}" ${CURL_HEADERS}`;
    const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  }

  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('403') || message.includes('Forbidden')) {
      useCurlFallback = true;
      const command = `curl -s "${url}" ${CURL_HEADERS}`;
      const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
      return stdout;
    }
    throw error;
  }
}

/**
 * Fetch event description from detail page
 * Extracts from og:description meta tag
 * Exported for use in cron route to fetch descriptions for new events
 */
export async function fetchEventDescription(pathOrUrl: string): Promise<string | undefined> {
  try {
    // Handle both full URLs and paths
    const fullUrl = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${BASE_URL}${pathOrUrl}`;
    const html = await fetchHTML(fullUrl);

    // Try og:description first (usually cleaner)
    let match = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+content="([^"]+)"\s+property="og:description"/i);

    // Fallback to regular description meta tag
    if (!match) {
      match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
    }

    if (match?.[1]) {
      // Decode HTML entities
      return match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
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
async function fetchAPI(url: string): Promise<ExploreAshevilleResponse> {
  // If we already know fetch is blocked, go straight to curl
  if (useCurlFallback) {
    return await fetchWithCurl(url);
  }

  try {
    return await fetchWithNativeFetch(url);
  } catch (error) {
    // If fetch fails (likely 403 from TLS fingerprinting), try curl
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('403') || message.includes('Forbidden')) {
      console.log('[ExploreAsheville] Native fetch blocked, using curl fallback...');
      useCurlFallback = true;
      return await fetchWithCurl(url);
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
      const data = await fetchAPI(url);
      const events = data.results || [];

      console.log(`[ExploreAsheville] Page ${page}: ${events.length} events (total in API: ${data.pageInfo.total})`);

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
  const ncEvents = allEvents.filter(ev => !isNonNCEvent(ev.title, ev.location));
  const filteredCount = allEvents.length - ncEvents.length;

  if (filteredCount > 0) {
    console.log(`[ExploreAsheville] Filtered out ${filteredCount} non-NC events`);
  }

  console.log(`[ExploreAsheville] Finished. Found ${ncEvents.length} NC events (${allEvents.length} total)`);
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
    .map(str => ({ str, date: parseAsEasternTime(str) }))
    .filter(({ date }) => !isNaN(date.getTime()) && date > now);

  if (futureDatePairs.length === 0) {
    return [];
  }

  const futureDates = futureDatePairs.map(p => p.date);
  const futureDateStrs = futureDatePairs.map(p => p.str);

  // Build common fields
  const cityName = event.cities?.[0]?.name || 'Asheville';
  const location = event.venueName
    ? `${event.venueName}, ${cityName}, NC`
    : `${cityName}, NC`;

  // Calculate zip from coordinates or fall back to city name
  const zip = getZipFromCoords(event.position?.lat, event.position?.lng)
    || getZipFromCity(cityName);

  let imageUrl = event.previewImage?.src;
  if (imageUrl && imageUrl.startsWith('/')) {
    imageUrl = `${BASE_URL}${imageUrl}`;
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

    return [{
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
    }];
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
  return [{
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
  }];
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
