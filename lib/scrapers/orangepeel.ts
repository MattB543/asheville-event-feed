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

import { type ScrapedEvent } from './types';
import { fetchEventData } from './base';
import { findJsonLdEvent } from './jsonld';
import {
  fetchTicketmasterEvents as fetchTicketmasterVenueEvents,
  getLocalDateKey,
  type TicketmasterVenueConfig,
} from './ticketmaster';

const ORANGE_PEEL_VENUE_ID = 'KovZpa3hYe';

// Website scraping config
const EVENTS_PAGE_URL = 'https://theorangepeel.net/events/';

// Venue constants
const VENUE_NAME = 'The Orange Peel';
const VENUE_ADDRESS = 'The Orange Peel, 101 Biltmore Ave, Asheville, NC';
const PULP_ADDRESS = 'Pulp, 103 Hilliard Ave, Asheville, NC';
const VENUE_ZIP = '28801';

/**
 * Clean title - remove age restrictions (will be in description if needed)
 */
function cleanTitle(name: string): string {
  return name
    .replace(/\s*\(18 and Over\)/gi, '')
    .replace(/\s*\(All Ages[^)]*\)/gi, '')
    .replace(/\s*- Ages?:?\s*18\+?/gi, '')
    .replace(/\s*- 18\+$/gi, '')
    .trim();
}

const TM_CONFIG: TicketmasterVenueConfig = {
  venueId: ORANGE_PEEL_VENUE_ID,
  source: 'ORANGE_PEEL',
  sourceIdPrefix: 'tm-op-',
  location: VENUE_ADDRESS,
  zip: VENUE_ZIP,
  organizer: VENUE_NAME,
  defaultTime: '20:00:00',
  logLabel: 'OrangePeel-TM',
  cleanTitle,
};

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
  const events = await fetchTicketmasterVenueEvents(TM_CONFIG);

  // Deduplicate by date + normalized title (TM returns duplicates with different ticket URLs)
  const seen = new Set<string>();
  const deduped = events.filter((e) => {
    const key = `${getLocalDateKey(e.startDate)}-${normalizeTitle(e.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(
    `[OrangePeel-TM] Found ${deduped.length} unique events (${events.length} total with dupes)`
  );
  return deduped;
}

/**
 * Normalize title for comparison - strips common variations
 */
function normalizeTitle(title: string): string {
  return (
    title
      .toLowerCase()
      // Remove tour names and suffixes
      .replace(
        /\s*-\s*(tour|mirrorverse|house of mirrors|winter|north american|the denali|rituals of hate|visions|know your enemy|too many flooz|2026|2025)[^-]*/gi,
        ''
      )
      // Remove "w/" featuring artists
      .replace(/\s*w\/[^-]*/gi, '')
      // Remove punctuation and extra whitespace
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
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
    const words1 = normalizedTitle.split(' ').filter((w) => w.length > 3);
    const words2 = existingTitle.split(' ').filter((w) => w.length > 3);
    const shared = words1.filter((w) => words2.includes(w));

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
    const response = await fetchEventData(
      EVENTS_PAGE_URL,
      {
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 },
      'OrangePeel-Web'
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
      await new Promise((r) => setTimeout(r, 150));
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
    const response = await fetchEventData(
      url,
      {
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 500 },
      'OrangePeel-Web'
    );
    const html = await response.text();

    // Extract JSON-LD structured data - find the Event block among all blocks
    const jsonLd = findJsonLdEvent<JSONLDEvent>(html);
    if (!jsonLd) return null;

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
    } else if (
      jsonLd.location?.name &&
      !jsonLd.location.name.toLowerCase().includes('orange peel')
    ) {
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
    console.warn(
      `[OrangePeel] Failed to scrape: ${url}`,
      error instanceof Error ? error.message : error
    );
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

  console.log(
    `[OrangePeel] Total: ${allEvents.length} events (${tmEvents.length} from TM, ${uniqueWebEvents.length} from Web)`
  );

  return allEvents;
}

// Export individual functions for testing
export { fetchTicketmasterEvents, fetchWebsiteEvents };
