/**
 * UNC Asheville Events Scraper
 *
 * Scrapes events from go.unca.edu using the Tribe Events Calendar REST API.
 */

import { type ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import { getZipFromCity, getZipFromCoords, isNonNCEvent } from '@/lib/utils/geo';
import { getTodayStringEastern, parseAsEastern } from '@/lib/utils/timezone';

// API Configuration
const API_BASE = 'https://go.unca.edu/wp-json/tribe/events/v1/events';
const PER_PAGE = 50;
const MAX_PAGES = 30;
const DELAY_MS = 200;

// Browser-like headers to avoid blocking
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://go.unca.edu/events/',
};

interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  geo_lat?: number;
  geo_lng?: number;
  url?: string;
}

interface TribeOrganizer {
  organizer?: string;
  website?: string;
  email?: string;
}

interface TribeImage {
  url?: string;
  sizes?: {
    medium?: { url: string };
    large?: { url: string };
    full?: { url: string };
  };
}

interface TribeEvent {
  id: number;
  title: string;
  description?: string;
  excerpt?: string;
  url: string;
  start_date: string;
  utc_start_date?: string;
  timezone?: string;
  all_day: boolean;
  cost?: string;
  cost_details?: {
    values?: string[];
  };
  venue?: TribeVenue | TribeVenue[] | [];
  organizer?: TribeOrganizer[];
  image?: TribeImage | false;
}

interface TribeEventsResponse {
  events: TribeEvent[];
  rest_url: string;
  next_rest_url?: string;
  total: number;
  total_pages: number;
}

export interface UncaScrapeOptions {
  startDate?: string;
  endDate?: string;
  includePast?: boolean;
}

function getVenue(event: TribeEvent): TribeVenue | undefined {
  if (Array.isArray(event.venue)) {
    return event.venue[0];
  }
  if (event.venue && typeof event.venue === 'object' && 'venue' in event.venue) {
    return event.venue;
  }
  return undefined;
}

function parseStartDate(event: TribeEvent): Date | null {
  if (!event.start_date) return null;
  const [datePart, timePart = '00:00:00'] = event.start_date.split(' ');

  if (event.utc_start_date) {
    const utcEqualsLocal = event.utc_start_date === event.start_date;
    const timezone = event.timezone?.toUpperCase() || '';
    const isUtcLabeled = timezone.includes('UTC');

    // Some UNCA events report UTC+0 with identical local/UTC timestamps.
    if (!(utcEqualsLocal && isUtcLabeled)) {
      const utcDate = new Date(event.utc_start_date.replace(' ', 'T') + 'Z');
      if (!isNaN(utcDate.getTime())) {
        return utcDate;
      }
    }
  }

  const localDate = parseAsEastern(datePart, timePart);
  return isNaN(localDate.getTime()) ? null : localDate;
}

function formatEvent(event: TribeEvent): ScrapedEvent | null {
  const startDate = parseStartDate(event);
  if (!startDate) return null;

  const venue = getVenue(event);
  const organizer = event.organizer?.[0];

  let location: string | undefined;
  if (venue?.venue) {
    const venueName = decodeHtmlEntities(venue.venue);
    const parts = [venueName];
    if (venue.address) parts.push(decodeHtmlEntities(venue.address));
    if (venue.city && !venue.address?.includes(venue.city)) {
      parts.push(venue.city);
    }
    if (venue.state) parts.push(venue.state);
    location = parts.join(', ');
  }

  let zip = venue?.zip || undefined;
  if (!zip && venue?.geo_lat && venue?.geo_lng) {
    zip = getZipFromCoords(venue.geo_lat, venue.geo_lng);
  }
  if (!zip && venue?.city) {
    zip = getZipFromCity(venue.city);
  }

  let price: string | undefined;
  if (event.cost) {
    const trimmed = event.cost.trim();
    const costLower = trimmed.toLowerCase();
    if (costLower === 'free' || costLower === '$0' || costLower === '0') {
      price = 'Free';
    } else if (trimmed === '$') {
      price = undefined;
    } else {
      price = trimmed;
    }
  } else if (event.cost_details?.values?.length) {
    price = event.cost_details.values.join(' - ');
  }

  const title = decodeHtmlEntities(event.title);
  let description = event.description || event.excerpt || undefined;
  if (description) {
    description = decodeHtmlEntities(description);
    if (description.length > 2000) {
      description = description.slice(0, 2000) + '...';
    }
  }

  const imageUrl =
    event.image && typeof event.image === 'object'
      ? event.image.sizes?.large?.url || event.image.sizes?.medium?.url || event.image.url
      : undefined;

  return {
    sourceId: `unca-${event.id}`,
    source: 'UNCA',
    title,
    description,
    startDate,
    location,
    zip,
    organizer: organizer?.organizer || (venue?.venue ? decodeHtmlEntities(venue.venue) : undefined),
    price,
    url: event.url,
    imageUrl,
    timeUnknown: event.all_day,
  };
}

async function fetchEventsPage(
  page: number,
  startDate: string,
  endDate?: string
): Promise<TribeEventsResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: PER_PAGE.toString(),
    start_date: startDate,
    status: 'publish',
  });

  if (endDate) {
    params.set('end_date', `${endDate} 23:59:59`);
  }

  const url = `${API_BASE}?${params}`;

  const response = await fetchWithRetry(
    url,
    { headers: API_HEADERS, cache: 'no-store' },
    { maxRetries: 3, baseDelay: 1000 }
  );

  return (await response.json()) as TribeEventsResponse;
}

export async function scrapeUncaEvents(options: UncaScrapeOptions = {}): Promise<ScrapedEvent[]> {
  const allEvents: ScrapedEvent[] = [];

  const startDate = options.startDate || getTodayStringEastern();
  const includePast = options.includePast || false;
  const endDate = options.endDate;

  console.log(`[UNCA] Starting scrape from ${startDate}${endDate ? ` to ${endDate}` : ''}...`);

  let page = 1;
  let hasMore = true;
  const now = new Date();

  while (hasMore && page <= MAX_PAGES) {
    try {
      console.log(`[UNCA] Fetching page ${page}...`);
      const data = await fetchEventsPage(page, startDate, endDate);
      const events = data.events || [];

      console.log(`[UNCA] Page ${page}: ${events.length} events (total: ${data.total})`);

      for (const event of events) {
        const formatted = formatEvent(event);
        if (!formatted) continue;
        if (!includePast && formatted.startDate < now) continue;
        allEvents.push(formatted);
      }

      hasMore = !!data.next_rest_url && page < data.total_pages;
      page++;

      if (hasMore) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    } catch (error) {
      console.error(`[UNCA] Error fetching page ${page}:`, error);
      break;
    }
  }

  const ncEvents = allEvents.filter((ev) => !isNonNCEvent(ev.title, ev.location));
  const filteredCount = allEvents.length - ncEvents.length;
  if (filteredCount > 0) {
    console.log(`[UNCA] Filtered out ${filteredCount} non-NC events`);
  }

  ncEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  console.log(`[UNCA] Finished. Found ${ncEvents.length} events.`);

  return ncEvents;
}

if (require.main === module) {
  scrapeUncaEvents()
    .then((events) => {
      console.log('\n' + '='.repeat(60));
      console.log('SCRAPE RESULTS');
      console.log('='.repeat(60));
      console.log(`Total events: ${events.length}`);

      for (const event of events.slice(0, 10)) {
        console.log(`\n${event.title}`);
        console.log(`  Date (UTC): ${event.startDate.toISOString()}`);
        console.log(
          `  Date (ET):  ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
        );
        console.log(`  Location: ${event.location || 'N/A'}`);
        console.log(`  Price: ${event.price || 'N/A'}`);
      }
    })
    .catch((error) => {
      console.error('[UNCA] Scrape failed:', error);
      process.exit(1);
    });
}
