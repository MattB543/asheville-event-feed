/**
 * Shared Ticketmaster Discovery API helpers for venue scrapers.
 *
 * Multiple Asheville venues (Harrah's Cherokee Center, The Orange Peel) list
 * their touring acts on Ticketmaster. The fetch/pagination loop and the
 * TMEvent -> ScrapedEvent mapping are identical across venues except for a few
 * venue-specific constants, which are supplied via TicketmasterVenueConfig.
 *
 * Requires: TICKETMASTER_API_KEY in environment
 */

import { type EventSource, type ScrapedEvent } from './types';
import { fetchEventData } from './base';
import { parseAsEastern } from '../utils/timezone';

// Ticketmaster API config
const TM_API_KEY = process.env.TICKETMASTER_API_KEY;
const TM_BASE_URL = 'https://app.ticketmaster.com/discovery/v2';

// Common headers for Ticketmaster API
const TM_API_HEADERS = {
  Accept: 'application/json',
};

export interface TMEvent {
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
  info?: string; // Event info/logistics
  pleaseNote?: string; // Additional notes
  description?: string; // Rarely populated
  _embedded?: {
    venues?: Array<{ name: string }>;
    attractions?: Array<{ name: string; description?: string }>;
  };
}

export interface TMResponse {
  _embedded?: {
    events?: TMEvent[];
  };
  page?: {
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

/**
 * Venue-specific parameters for fetching/formatting Ticketmaster events.
 */
export interface TicketmasterVenueConfig {
  /** Ticketmaster venue ID (e.g. 'KovZpZAJvnIA') */
  venueId: string;
  /** Event source enum value stored on each event */
  source: EventSource;
  /** Prefix for sourceId, combined with the TM event id (e.g. 'tm-', 'tm-op-') */
  sourceIdPrefix: string;
  /** Full location string */
  location: string;
  /** Location zip code */
  zip: string;
  /** Organizer / venue name */
  organizer: string;
  /** Default show time (HH:MM:SS) used when the API omits localTime */
  defaultTime: string;
  /** Log label prefix (e.g. 'Harrahs-TM') */
  logLabel: string;
  /** Optional title cleaner applied to event.name */
  cleanTitle?: (name: string) => string;
}

/**
 * Get local date string (YYYY-MM-DD) without timezone conversion
 */
export function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format Ticketmaster event to ScrapedEvent
 */
function formatTMEvent(event: TMEvent, config: TicketmasterVenueConfig): ScrapedEvent | null {
  if (!event.dates?.start?.localDate) {
    return null;
  }

  // Parse date - prefer dateTime (includes timezone) to avoid UTC interpretation issues on servers
  let startDate: Date;
  if (event.dates.start.dateTime) {
    // dateTime is ISO format with timezone (e.g., "2025-12-04T19:00:00Z")
    startDate = new Date(event.dates.start.dateTime);
  } else {
    // Fallback: construct from local date/time with correct Eastern offset (handles DST)
    const dateStr = event.dates.start.localDate;
    const timeStr = event.dates.start.localTime || config.defaultTime;
    startDate = parseAsEastern(dateStr, timeStr);
  }
  if (Number.isNaN(startDate.getTime())) {
    console.warn(`[${config.logLabel}] Skipping event with invalid date: ${event.id}`);
    return null;
  }

  // Get best image (prefer 16:9 ratio, largest size)
  let imageUrl: string | undefined;
  if (event.images?.length) {
    const preferred = event.images
      .filter((img) => img.ratio === '16_9')
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
  const description =
    event.description ||
    event.info ||
    event.pleaseNote ||
    event._embedded?.attractions?.[0]?.description ||
    undefined;

  const title = config.cleanTitle ? config.cleanTitle(event.name) : event.name;

  return {
    sourceId: `${config.sourceIdPrefix}${event.id}`,
    source: config.source,
    title,
    description,
    startDate,
    location: config.location,
    zip: config.zip,
    organizer: config.organizer,
    price,
    url: event.url,
    imageUrl,
  };
}

/**
 * Fetch events from Ticketmaster Discovery API for a single venue.
 *
 * Returns events in API order (sorted by date asc). Callers that need to
 * deduplicate TM events (some venues return the same show under multiple
 * ticket URLs) should do so after this returns, using their venue-specific
 * title normalization.
 */
export async function fetchTicketmasterEvents(
  config: TicketmasterVenueConfig
): Promise<ScrapedEvent[]> {
  if (!TM_API_KEY) {
    console.log(`[${config.logLabel}] No TICKETMASTER_API_KEY set, skipping API fetch`);
    return [];
  }

  console.log(`[${config.logLabel}] Fetching from Ticketmaster API...`);

  const events: ScrapedEvent[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${TM_BASE_URL}/events.json`);
    url.searchParams.set('apikey', TM_API_KEY);
    url.searchParams.set('venueId', config.venueId);
    url.searchParams.set('size', '50');
    url.searchParams.set('page', page.toString());
    url.searchParams.set('sort', 'date,asc');

    try {
      const response = await fetchEventData(
        url.toString(),
        {
          headers: TM_API_HEADERS,
          cache: 'no-store',
        },
        { maxRetries: 3, baseDelay: 1000 },
        config.logLabel
      );
      const data = (await response.json()) as TMResponse;

      if (data._embedded?.events) {
        for (const event of data._embedded.events) {
          const scraped = formatTMEvent(event, config);
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

      if (hasMore) {
        // Rate limit: 200ms between requests
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (error) {
      console.error(`[${config.logLabel}] API error:`, error);
      hasMore = false;
    }
  }

  console.log(`[${config.logLabel}] Found ${events.length} events from Ticketmaster`);
  return events;
}
