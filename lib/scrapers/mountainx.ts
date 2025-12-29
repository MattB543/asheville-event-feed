/**
 * Mountain Xpress (mountainx.com) Scraper
 *
 * Scrapes events from Mountain Xpress using the Tribe Events Calendar REST API.
 * The API provides properly formatted JSON with timezone-aware dates.
 */

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { isNonNCEvent } from '@/lib/utils/geo';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import { getZipFromCoords, getZipFromCity } from '@/lib/utils/geo';
import { getTodayStringEastern } from '@/lib/utils/timezone';

// API Configuration
const API_BASE = 'https://mountainx.com/wp-json/tribe/events/v1/events';
const PER_PAGE = 50;
const MAX_PAGES = 40;
const DELAY_MS = 200;

// Browser headers to avoid blocking
const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Tribe Events API Response Types
 */
interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  website?: string;
  geo_lat?: number;
  geo_lng?: number;
}

interface TribeOrganizer {
  organizer?: string;
  website?: string;
  email?: string;
}

interface TribeImage {
  url?: string;
  id?: number;
  extension?: string;
  width?: number;
  height?: number;
  sizes?: {
    medium?: { url: string };
    large?: { url: string };
    full?: { url: string };
  };
}

interface TribeEvent {
  id: number;
  global_id?: string;
  title: string;
  description?: string;
  excerpt?: string;
  url: string;
  start_date: string;        // Local time: "2025-12-16 19:00:00"
  end_date?: string;
  utc_start_date: string;    // UTC time: "2025-12-17 00:00:00"
  utc_end_date?: string;
  timezone: string;          // "America/New_York"
  timezone_abbr?: string;    // "EST" or "EDT"
  all_day: boolean;
  cost?: string;             // "$18", "Free", etc.
  cost_details?: {
    currency_symbol?: string;
    currency_code?: string;
    currency_position?: string;
    values?: string[];
  };
  venue?: TribeVenue;
  organizer?: TribeOrganizer[];
  image?: TribeImage;
  categories?: Array<{ name: string; slug: string }>;
  tags?: Array<{ name: string; slug: string }>;
  website?: string;
}

interface TribeEventsResponse {
  events: TribeEvent[];
  rest_url: string;
  next_rest_url?: string;
  previous_rest_url?: string;
  total: number;
  total_pages: number;
}

/**
 * Scrape events from Mountain Xpress
 */
export async function scrapeMountainX(): Promise<ScrapedEvent[]> {
  console.log('[MountainX] Starting API-based scrape...');

  const allEvents: ScrapedEvent[] = [];
  const today = getTodayStringEastern();
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    try {
      const url = new URL(API_BASE);
      url.searchParams.set('start_date', today);
      url.searchParams.set('per_page', PER_PAGE.toString());
      url.searchParams.set('page', page.toString());

      console.log(`[MountainX] Fetching page ${page}...`);

      const response = await fetchWithRetry(
        url.toString(),
        { headers: API_HEADERS, cache: 'no-store' },
        { maxRetries: 3, baseDelay: 1000 }
      );

      const data = (await response.json()) as TribeEventsResponse;
      const events = data.events || [];

      console.log(`[MountainX] Page ${page}: ${events.length} events (total: ${data.total})`);

      // Format each event
      for (const event of events) {
        const formatted = formatEvent(event);
        if (formatted) {
          allEvents.push(formatted);
        }
      }

      // Check if there are more pages
      hasMore = !!data.next_rest_url && page < data.total_pages;
      page++;

      // Rate limiting
      if (hasMore) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    } catch (error) {
      console.error(`[MountainX] Error fetching page ${page}:`, error);
      break;
    }
  }

  // Filter out non-NC events
  const ncEvents = allEvents.filter(ev => !isNonNCEvent(ev.title, ev.location));
  const filteredCount = allEvents.length - ncEvents.length;

  if (filteredCount > 0) {
    console.log(`[MountainX] Filtered out ${filteredCount} non-NC events`);
  }

  console.log(`[MountainX] Finished. Found ${ncEvents.length} NC events (${allEvents.length} total)`);
  return ncEvents;
}

/**
 * Format a single event from the API response
 */
function formatEvent(event: TribeEvent): ScrapedEvent | null {
  // Parse the UTC start date
  // API format: "2025-12-16 19:00:00" (space-separated)
  // Convert to ISO format with Z suffix for proper UTC parsing
  const utcDateStr = event.utc_start_date.replace(' ', 'T') + 'Z';
  const startDate = new Date(utcDateStr);

  // Validate date
  if (isNaN(startDate.getTime())) {
    console.warn(`[MountainX] Invalid date for event "${event.title}": ${event.utc_start_date}`);
    return null;
  }

  // Skip past events (shouldn't happen with start_date filter, but safety check)
  const now = new Date();
  if (startDate < now) {
    return null;
  }

  // Build location string
  const venue = event.venue;
  let location: string | undefined;
  if (venue?.venue) {
    const venueName = decodeHtmlEntities(venue.venue);
    const parts = [venueName];
    if (venue.address) parts.push(decodeHtmlEntities(venue.address));
    // Only add city if it's not already in the address
    if (venue.city && !venue.address?.includes(venue.city)) {
      parts.push(venue.city);
    }
    if (venue.state) parts.push(venue.state);
    location = parts.join(', ');
  }

  // Determine zip code with fallbacks
  let zip = venue?.zip || undefined;
  if (!zip && venue?.geo_lat && venue?.geo_lng) {
    zip = getZipFromCoords(venue.geo_lat, venue.geo_lng);
  }
  if (!zip && venue?.city) {
    zip = getZipFromCity(venue.city);
  }

  // Get organizer name
  const organizer = event.organizer?.[0]?.organizer || undefined;

  // Get image URL (prefer larger sizes)
  const imageUrl = event.image?.sizes?.large?.url
    || event.image?.sizes?.medium?.url
    || event.image?.url
    || undefined;

  // Clean up cost string
  let price = event.cost || 'Unknown';
  if (price.toLowerCase() === 'free' || price === '$0' || price === '0') {
    price = 'Free';
  }

  // Decode HTML entities in title and description
  const title = decodeHtmlEntities(event.title);
  let description = event.description || event.excerpt || undefined;
  if (description) {
    description = decodeHtmlEntities(description);
    // Truncate very long descriptions
    if (description.length > 2000) {
      description = description.slice(0, 2000) + '...';
    }
  }

  return {
    sourceId: `mx-${event.id}`,
    source: 'MOUNTAIN_X',
    title,
    description,
    startDate,
    location,
    zip,
    organizer,
    price,
    url: event.url,
    imageUrl,
    timeUnknown: event.all_day,
  };
}

// Allow running standalone for testing
if (require.main === module || process.argv[1]?.includes('mountainx')) {
  scrapeMountainX()
    .then((events) => {
      console.log('\n' + '='.repeat(60));
      console.log('SCRAPE RESULTS');
      console.log('='.repeat(60));
      console.log(`Total events: ${events.length}`);

      console.log('\nSample events (first 15):');
      console.log('-'.repeat(60));
      for (const event of events.slice(0, 15)) {
        console.log(`\n${event.title}`);
        console.log(`  Date (UTC): ${event.startDate.toISOString()}`);
        console.log(`  Date (ET):  ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
        console.log(`  Location: ${event.location || 'N/A'}`);
        console.log(`  Zip: ${event.zip || 'N/A'}`);
        console.log(`  Price: ${event.price || 'N/A'}`);
        console.log(`  URL: ${event.url}`);
        if (event.timeUnknown) {
          console.log(`  Time: All day / unknown`);
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('Field Completeness:');
      const withImages = events.filter(e => e.imageUrl).length;
      const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
      const withDescriptions = events.filter(e => e.description).length;
      const withZips = events.filter(e => e.zip).length;
      console.log(`  With images: ${withImages}/${events.length} (${Math.round(withImages/events.length*100)}%)`);
      console.log(`  With prices: ${withPrices}/${events.length} (${Math.round(withPrices/events.length*100)}%)`);
      console.log(`  With descriptions: ${withDescriptions}/${events.length} (${Math.round(withDescriptions/events.length*100)}%)`);
      console.log(`  With zip codes: ${withZips}/${events.length} (${Math.round(withZips/events.length*100)}%)`);
      console.log('='.repeat(60));
    })
    .catch((error) => {
      console.error('Scrape failed:', error);
      process.exit(1);
    });
}
