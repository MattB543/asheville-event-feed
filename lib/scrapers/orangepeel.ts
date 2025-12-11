/**
 * Orange Peel Scraper - Ticketmaster API + Website Scraping
 *
 * Uses Ticketmaster Discovery API as primary source for touring acts with
 * high-quality images. Falls back to website scraping for local events
 * not listed on Ticketmaster.
 *
 * Venue ID: KovZpa3hYe (The Orange Peel - Asheville)
 *
 * Requires: TICKETMASTER_API_KEY in environment
 */

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '../utils/retry';
import { parseAsEastern } from '../utils/timezone';

// Ticketmaster API config
const TM_API_KEY = process.env.TICKETMASTER_API_KEY;
const TM_BASE_URL = 'https://app.ticketmaster.com/discovery/v2';
const ORANGE_PEEL_VENUE_ID = 'KovZpa3hYe';

// Website scraping config
const EVENTS_PAGE_URL = 'https://theorangepeel.net/events/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Venue constants
const VENUE_NAME = 'The Orange Peel';
const VENUE_ADDRESS = 'The Orange Peel, 101 Biltmore Ave, Asheville, NC';
const PULP_ADDRESS = 'Pulp, 103 Hilliard Ave, Asheville, NC';
const VENUE_ZIP = '28801';

// Common headers for Ticketmaster API
const TM_API_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

interface TMEvent {
  id: string;
  name: string;
  url: string;
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
  };
  priceRanges?: Array<{
    min: number;
    max: number;
    currency: string;
  }>;
  images?: Array<{
    url: string;
    width: number;
    height: number;
    ratio: string;
  }>;
  info?: string;
  pleaseNote?: string;
  description?: string;
  _embedded?: {
    venues?: Array<{ name: string }>;
    attractions?: Array<{ name: string; description?: string }>;
  };
}

interface TMResponse {
  _embedded?: {
    events?: TMEvent[];
  };
  page?: {
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

interface JSONLDEvent {
  '@type': string;
  name: string;
  startDate: string;
  url: string;
  image?: string;
  description?: string;
  location?: {
    '@type'?: string;
    name?: string;
    address?: string;
  };
  offers?: {
    '@type'?: string;
    url?: string;
    price?: number | string;
  };
}

/**
 * Fetch events from Ticketmaster Discovery API
 */
async function fetchTicketmasterEvents(): Promise<ScrapedEvent[]> {
  if (!TM_API_KEY) {
    console.log('[OrangePeel-TM] No TICKETMASTER_API_KEY set, skipping API fetch');
    return [];
  }

  console.log('[OrangePeel-TM] Fetching from Ticketmaster API...');

  const events: ScrapedEvent[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${TM_BASE_URL}/events.json`);
    url.searchParams.set('apikey', TM_API_KEY);
    url.searchParams.set('venueId', ORANGE_PEEL_VENUE_ID);
    url.searchParams.set('size', '50');
    url.searchParams.set('page', page.toString());
    url.searchParams.set('sort', 'date,asc');

    try {
      const response = await fetchWithRetry(
        url.toString(),
        {
          headers: TM_API_HEADERS,
          cache: 'no-store',
        },
        { maxRetries: 3, baseDelay: 1000 }
      );
      const data: TMResponse = await response.json();

      if (data._embedded?.events) {
        for (const event of data._embedded.events) {
          const scraped = formatTMEvent(event);
          if (scraped) {
            events.push(scraped);
          }
        }
      }

      // Check pagination
      if (data.page) {
        const { number, totalPages } = data.page;
        hasMore = number < totalPages - 1;
        page++;
      } else {
        hasMore = false;
      }

      // Rate limit: 200ms between requests
      await new Promise(r => setTimeout(r, 200));

    } catch (error) {
      console.error('[OrangePeel-TM] API error:', error);
      hasMore = false;
    }
  }

  // Deduplicate by date + normalized title (TM returns duplicates with different ticket URLs)
  const seen = new Set<string>();
  const deduped = events.filter(e => {
    const key = `${getLocalDateKey(e.startDate)}-${normalizeTitle(e.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[OrangePeel-TM] Found ${deduped.length} unique events (${events.length} total with dupes)`);
  return deduped;
}

/**
 * Format Ticketmaster event to ScrapedEvent
 */
function formatTMEvent(event: TMEvent): ScrapedEvent | null {
  if (!event.dates?.start?.localDate) {
    return null;
  }

  // Parse date - prefer dateTime (includes timezone) to avoid UTC interpretation issues on servers
  let startDate: Date;
  if (event.dates.start.dateTime) {
    // dateTime is ISO format with timezone (e.g., "2025-12-04T20:00:00Z")
    startDate = new Date(event.dates.start.dateTime);
  } else {
    // Fallback: construct from local date/time with correct Eastern offset (handles DST)
    const dateStr = event.dates.start.localDate;
    const timeStr = event.dates.start.localTime || '20:00:00';
    startDate = parseAsEastern(dateStr, timeStr);
  }

  // Get best image (prefer 16:9 ratio, largest size)
  let imageUrl: string | undefined;
  if (event.images?.length) {
    const preferred = event.images
      .filter(img => img.ratio === '16_9')
      .sort((a, b) => b.width - a.width)[0];
    imageUrl = preferred?.url || event.images[0].url;
  }

  // Format price if available
  let price = 'Unknown';
  if (event.priceRanges?.length) {
    const range = event.priceRanges[0];
    if (range.min === range.max) {
      price = `$${range.min}`;
    } else {
      price = `$${range.min} - $${range.max}`;
    }
  }

  // Build description from available fields
  const description = event.description
    || event.info
    || event.pleaseNote
    || event._embedded?.attractions?.[0]?.description
    || undefined;

  // Clean title - remove age restrictions (will be in description if needed)
  const title = event.name
    .replace(/\s*\(18 and Over\)/gi, '')
    .replace(/\s*\(All Ages[^)]*\)/gi, '')
    .replace(/\s*- Ages?:?\s*18\+?/gi, '')
    .replace(/\s*- 18\+$/gi, '')
    .trim();

  return {
    sourceId: `tm-op-${event.id}`,
    source: 'ORANGE_PEEL',
    title,
    description,
    startDate,
    location: VENUE_ADDRESS,
    zip: VENUE_ZIP,
    organizer: VENUE_NAME,
    price,
    url: event.url,
    imageUrl,
  };
}

/**
 * Normalize title for comparison - strips common variations
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove tour names and suffixes
    .replace(/\s*-\s*(tour|mirrorverse|house of mirrors|winter|north american|the denali|rituals of hate|visions|know your enemy|too many flooz|2026|2025)[^-]*/gi, '')
    // Remove "w/" featuring artists
    .replace(/\s*w\/[^-]*/gi, '')
    // Remove punctuation and extra whitespace
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get local date string (YYYY-MM-DD) without timezone conversion
 */
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if two events are duplicates (same date + similar title)
 */
function isDuplicate(
  event: { title: string; date: string },
  existing: Map<string, Set<string>>
): boolean {
  const normalizedTitle = normalizeTitle(event.title);
  const titlesOnDate = existing.get(event.date);

  if (!titlesOnDate) return false;

  // Check for similar titles on same date
  for (const existingTitle of titlesOnDate) {
    // Check if one contains the other
    if (normalizedTitle.includes(existingTitle) || existingTitle.includes(normalizedTitle)) {
      return true;
    }

    // Check for shared significant words (more than 3 chars)
    const words1 = normalizedTitle.split(' ').filter(w => w.length > 3);
    const words2 = existingTitle.split(' ').filter(w => w.length > 3);
    const shared = words1.filter(w => words2.includes(w));

    // 2+ shared words, or 1 word if it's long (likely artist name)
    if (shared.length >= 2 || (shared.length >= 1 && shared[0].length > 5)) {
      return true;
    }
  }

  return false;
}

/**
 * Fetch events from Orange Peel website using JSON-LD structured data
 */
async function fetchWebsiteEvents(): Promise<ScrapedEvent[]> {
  console.log('[OrangePeel-Web] Fetching event links from website...');

  try {
    const response = await fetchWithRetry(
      EVENTS_PAGE_URL,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 }
    );
    const html = await response.text();

    // Extract event URLs
    const eventUrlPattern = /href="(https:\/\/theorangepeel\.net\/event\/[^"]+)"/g;
    const urls = new Set<string>();
    let match;

    while ((match = eventUrlPattern.exec(html)) !== null) {
      urls.add(match[1]);
    }

    if (urls.size === 0) {
      console.log('[OrangePeel-Web] No event URLs found');
      return [];
    }

    console.log(`[OrangePeel-Web] Found ${urls.size} event URLs, scraping each...`);

    const events: ScrapedEvent[] = [];
    let scraped = 0;
    let failed = 0;

    for (const url of urls) {
      const event = await scrapeEventPage(url);
      if (event) {
        events.push(event);
        scraped++;
      } else {
        failed++;
      }

      // Rate limit: 150ms between requests
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`[OrangePeel-Web] Scraped ${scraped} events (${failed} failed)`);
    return events;

  } catch (error) {
    console.error('[OrangePeel-Web] Error fetching events page:', error);
    return [];
  }
}

/**
 * Scrape a single event page for JSON-LD structured data
 */
async function scrapeEventPage(url: string): Promise<ScrapedEvent | null> {
  try {
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
        },
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 500 }
    );
    const html = await response.text();

    // Extract JSON-LD structured data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!jsonLdMatch) return null;

    let jsonLd: JSONLDEvent;
    try {
      jsonLd = JSON.parse(jsonLdMatch[1]);
    } catch {
      return null;
    }

    if (jsonLd['@type'] !== 'Event') return null;

    // Parse date
    const startDate = new Date(jsonLd.startDate);
    if (isNaN(startDate.getTime())) return null;

    // Get slug for sourceId
    const slug = url.match(/\/event\/([^/]+)/)?.[1] || 'unknown';

    // Clean title (decode HTML entities)
    const title = jsonLd.name
      .replace(/&#8211;/g, '-')
      .replace(/&#8217;/g, "'")
      .replace(/&#8216;/g, "'")
      .replace(/&#038;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    // Determine venue from location or URL
    let location = VENUE_ADDRESS;
    if (url.includes('/pulp/') || jsonLd.location?.name?.toLowerCase().includes('pulp')) {
      location = PULP_ADDRESS;
    } else if (jsonLd.location?.name && !jsonLd.location.name.toLowerCase().includes('orange peel')) {
      location = jsonLd.location.name;
    }

    return {
      sourceId: `op-web-${slug}`,
      source: 'ORANGE_PEEL',
      title,
      description: jsonLd.description,
      startDate,
      location,
      zip: VENUE_ZIP,
      organizer: VENUE_NAME,
      price: 'Unknown', // JSON-LD price is always 0, not usable
      url: jsonLd.url || url,
      imageUrl: jsonLd.image,
    };
  } catch (error) {
    console.warn(`[OrangePeel] Failed to scrape: ${url}`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Main scraper function - combines Ticketmaster API and website scraping
 */
export async function scrapeOrangePeel(): Promise<ScrapedEvent[]> {
  console.log('[OrangePeel] Starting hybrid scrape...');

  // 1. Primary: Ticketmaster API (better images for touring acts)
  const tmEvents = await fetchTicketmasterEvents();

  // 2. Build index of existing events by date -> normalized titles
  const existingByDate = new Map<string, Set<string>>();
  for (const event of tmEvents) {
    const dateKey = getLocalDateKey(event.startDate);
    if (!existingByDate.has(dateKey)) {
      existingByDate.set(dateKey, new Set());
    }
    existingByDate.get(dateKey)!.add(normalizeTitle(event.title));
  }

  // 3. Secondary: Website scraping (for local events not on TM)
  const webEvents = await fetchWebsiteEvents();

  // 4. Filter website events to only new ones (not duplicates of TM events)
  const uniqueWebEvents: ScrapedEvent[] = [];
  let skipped = 0;

  for (const event of webEvents) {
    const dateKey = getLocalDateKey(event.startDate);
    if (isDuplicate({ title: event.title, date: dateKey }, existingByDate)) {
      skipped++;
    } else {
      uniqueWebEvents.push(event);
      // Add to existing to prevent web-to-web duplicates
      if (!existingByDate.has(dateKey)) {
        existingByDate.set(dateKey, new Set());
      }
      existingByDate.get(dateKey)!.add(normalizeTitle(event.title));
    }
  }

  console.log(`[OrangePeel] Merged: ${skipped} website events were duplicates of TM events`);

  // 5. Combine and sort by date
  const allEvents = [...tmEvents, ...uniqueWebEvents];
  allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  console.log(`[OrangePeel] Total: ${allEvents.length} events (${tmEvents.length} from TM, ${uniqueWebEvents.length} from Web)`);

  return allEvents;
}

// Export individual functions for testing
export { fetchTicketmasterEvents, fetchWebsiteEvents };
