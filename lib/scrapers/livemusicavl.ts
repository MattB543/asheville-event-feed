/**
 * Live Music Asheville Scraper
 *
 * Scrapes events from livemusicasheville.com using the Tribe Events REST API.
 * Filters to only include events from specific target venues.
 *
 * API Endpoint: https://livemusicasheville.com/wp-json/tribe/events/v1/events
 */

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';

// Target venues to include (partial match, case-insensitive)
const TARGET_VENUES = [
  'Pisgah Brewing',
  'Jack Of The Wood',
  'Little Jumbo',
  'French Broad River Brewery',
  'Fitz and the Wolfe',
  'One World Brewing',  // Matches "One World Brewing – West"
  '5 Walnut Wine Bar',
  'White Horse Black Mountain',
];

// Fallback images for venues when event has no image
// These are stored in /public and served from root
const VENUE_FALLBACK_IMAGES: Record<string, string> = {
  'pisgah brewing': '/pisgah-brewing.jpeg',
  'jack of the wood': '/jack-of-the-wood.jpg', // TODO: add this image
  'little jumbo': '/little-jumbo.jpg', // TODO: add this image
  'french broad river': '/french_broad_river.avif',
  'fitz and the wolfe': '/fitz_and_wolfe.avif',
  'one world brewing': '/one_world_west.avif', // Default to West location
  'one world west': '/one_world_west.avif',
  'one world downtown': '/one-world-downtown.avif',
  '5 walnut': '/waltnut.webp',
  'walnut wine': '/waltnut.webp',
  'white horse': '/white-horse.png',
};

// Fallback zip codes for venues when API doesn't provide one
const VENUE_FALLBACK_ZIPS: Record<string, string> = {
  'pisgah brewing': '28711',  // Black Mountain
  'jack of the wood': '28801',  // Downtown Asheville
  'little jumbo': '28801',  // Downtown Asheville
  'french broad river': '28806',  // West Asheville
  'fitz and the wolfe': '28801',  // Downtown Asheville
  'one world brewing': '28801',  // Downtown (default)
  'one world west': '28806',  // West Asheville
  'one world downtown': '28801',  // Downtown Asheville
  '5 walnut': '28801',  // Downtown Asheville
  'walnut wine': '28801',  // Downtown Asheville
  'white horse': '28711',  // Black Mountain
};

// Config
const API_BASE = 'https://livemusicasheville.com/wp-json/tribe/events/v1/events';
const PER_PAGE = 50;
const MAX_PAGES = 15; // ~750 events max to cover all target venue events
const DELAY_MS = 500;

// Common headers to avoid blocking
const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://livemusicasheville.com/events/",
};

// Types for API response
interface TribeVenue {
  id: number;
  venue: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  geo_lat?: number;
  geo_lng?: number;
  url: string;
}

interface TribeEvent {
  id: number;
  title: string;
  description: string;
  url: string;
  start_date: string;
  utc_start_date: string;
  cost: string;
  cost_details: {
    currency_symbol: string;
    currency_code: string;
    values: string[];
  };
  image: {
    url: string;
    id: number;
    width: number;
    height: number;
  } | false;
  venue: TribeVenue | TribeVenue[] | [];
  organizer: Array<{
    id: number;
    organizer: string;
    url: string;
  }>;
}

interface TribeApiResponse {
  events: TribeEvent[];
  rest_url: string;
  next_rest_url?: string;
  total: number;
  total_pages: number;
}

/**
 * Get venue from event (handles both object and array formats)
 */
function getVenue(event: TribeEvent): TribeVenue | undefined {
  if (Array.isArray(event.venue)) {
    return event.venue[0];
  } else if (event.venue && typeof event.venue === 'object' && 'venue' in event.venue) {
    return event.venue as TribeVenue;
  }
  return undefined;
}

/**
 * Check if venue matches one of our target venues
 */
function isTargetVenue(venueName: string | undefined): boolean {
  if (!venueName) return false;
  const decoded = decodeHtmlEntities(venueName).toLowerCase();
  return TARGET_VENUES.some(target => decoded.includes(target.toLowerCase()));
}

/**
 * Get fallback image for a venue when event has no image
 */
function getVenueFallbackImage(venueName: string | undefined): string | undefined {
  if (!venueName) return undefined;
  const decoded = decodeHtmlEntities(venueName).toLowerCase();

  // Check each fallback key for a match
  for (const [key, imagePath] of Object.entries(VENUE_FALLBACK_IMAGES)) {
    if (decoded.includes(key)) {
      return imagePath;
    }
  }
  return undefined;
}

/**
 * Get fallback zip code for a venue when API doesn't provide one
 */
function getVenueFallbackZip(venueName: string | undefined): string | undefined {
  if (!venueName) return undefined;
  const decoded = decodeHtmlEntities(venueName).toLowerCase();

  // Check each fallback key for a match
  for (const [key, zip] of Object.entries(VENUE_FALLBACK_ZIPS)) {
    if (decoded.includes(key)) {
      return zip;
    }
  }
  return undefined;
}

/**
 * Format API event to ScrapedEvent
 */
function formatEvent(event: TribeEvent): ScrapedEvent {
  const venue = getVenue(event);
  const organizer = event.organizer?.[0];

  // Build location string
  let location: string | undefined;
  if (venue?.venue) {
    const parts = [decodeHtmlEntities(venue.venue)];
    if (venue.address) parts.push(venue.address);
    if (venue.city) parts.push(venue.city);
    if (venue.state) parts.push(venue.state);
    location = parts.join(', ');
  }

  // Extract zip code from venue, with fallback for known venues
  const zip = venue?.zip || getVenueFallbackZip(venue?.venue);

  // Format price
  let price: string | undefined;
  if (event.cost) {
    const costLower = event.cost.toLowerCase();
    if (costLower === 'free' || costLower === '$0') {
      price = 'Free';
    } else {
      price = event.cost;
    }
  } else if (event.cost_details?.values?.length > 0) {
    price = event.cost_details.values.join(' - ');
  }

  return {
    sourceId: event.id.toString(),
    source: 'LIVE_MUSIC_AVL',
    title: decodeHtmlEntities(event.title),
    description: event.description ? decodeHtmlEntities(event.description).slice(0, 2000) : undefined,
    // Append 'Z' to indicate UTC - the API returns UTC time without timezone indicator
    startDate: new Date(event.utc_start_date + 'Z'),
    location,
    zip,
    organizer: organizer?.organizer || (venue?.venue ? decodeHtmlEntities(venue.venue) : undefined),
    price,
    url: event.url,
    imageUrl: event.image ? event.image.url : getVenueFallbackImage(venue?.venue),
  };
}

/**
 * Fetch a page of events from the API
 */
async function fetchEventsPage(page: number, startDate: string): Promise<TribeApiResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: PER_PAGE.toString(),
    start_date: startDate,
    status: 'publish',
  });

  const url = `${API_BASE}?${params}`;

  const response = await fetchWithRetry(
    url,
    {
      headers: API_HEADERS,
      cache: 'no-store',
    },
    { maxRetries: 3, baseDelay: 2000 }
  );

  return response.json();
}

/**
 * Main scraper function
 */
export async function scrapeLiveMusicAvl(): Promise<ScrapedEvent[]> {
  const allEvents: ScrapedEvent[] = [];

  // Get today's date in YYYY-MM-DD format (Asheville time)
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });

  console.log(`[LiveMusicAVL] Starting scrape from ${today}...`);
  console.log(`[LiveMusicAVL] Filtering for ${TARGET_VENUES.length} target venues`);

  let page = 1;
  let hasMore = true;
  let totalFromApi = 0;

  while (hasMore && page <= MAX_PAGES) {
    try {
      console.log(`[LiveMusicAVL] Fetching page ${page}...`);
      const data = await fetchEventsPage(page, today);

      if (page === 1) {
        totalFromApi = data.total;
        console.log(`[LiveMusicAVL] API has ${totalFromApi} total events`);
      }

      // Filter to target venues and format
      let matchedThisPage = 0;
      for (const event of data.events) {
        const venue = getVenue(event);
        if (isTargetVenue(venue?.venue)) {
          allEvents.push(formatEvent(event));
          matchedThisPage++;
        }
      }

      console.log(`[LiveMusicAVL] Page ${page}: ${matchedThisPage}/${data.events.length} matched target venues`);

      // Check for more pages
      if (!data.next_rest_url || page >= data.total_pages || page >= MAX_PAGES) {
        hasMore = false;
      } else {
        page++;
        // Rate limiting delay
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    } catch (error) {
      console.error(`[LiveMusicAVL] Error on page ${page}:`, error);
      hasMore = false;
    }
  }

  // Sort by date
  allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  console.log(`[LiveMusicAVL] Finished. Found ${allEvents.length} events from target venues.`);

  return allEvents;
}

// Allow running standalone for testing
if (require.main === module || process.argv[1]?.includes('livemusicavl')) {
  scrapeLiveMusicAvl()
    .then(events => {
      console.log('\n' + '='.repeat(60));
      console.log('SCRAPE RESULTS');
      console.log('='.repeat(60));
      console.log(`Total events: ${events.length}`);

      // Count by venue
      const venueCounts: Record<string, number> = {};
      for (const e of events) {
        const venue = e.organizer || 'Unknown';
        venueCounts[venue] = (venueCounts[venue] || 0) + 1;
      }

      console.log('\nEvents by venue:');
      for (const [venue, count] of Object.entries(venueCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count.toString().padStart(3)}  ${venue}`);
      }

      console.log('\nSample events:');
      console.log('-'.repeat(60));
      for (const event of events.slice(0, 10)) {
        console.log(`\n${event.title}`);
        console.log(`  Date: ${event.startDate.toLocaleString()}`);
        console.log(`  Venue: ${event.organizer || 'N/A'}`);
        console.log(`  Price: ${event.price || 'N/A'}`);
      }

      console.log('\n✅ Scrape complete!');
    })
    .catch(error => {
      console.error('❌ Scrape failed:', error);
      process.exit(1);
    });
}
