import { type ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { debugSave } from './base';

// Universe.com API types
interface UniverseListing {
  id: string;
  title: string;
  description?: string;
  slug_param: string;
  state: string; // "posted" = active/upcoming, "expired" = past
  cover_photo?: {
    uploadcare_id?: string;
  };
  event_ids: string[];
  host_id: string;
  address?: string; // Full address string, e.g. "131 Sweeten Creek Rd ste 10, Asheville, NC 28803, USA"
}

interface UniverseEvent {
  id: string;
  listing_id: string;
  start_stamp: number; // Unix timestamp in seconds
  start_time: string; // ISO 8601 with offset, e.g. "2026-02-20T19:30:00.000-05:00"
  end_time?: string;
  tz: string; // e.g. "America/New_York"
  count_attending?: number;
}

interface UniverseRate {
  id: string;
  listing_id: string;
  name: string; // e.g. "General Admission"
  price: number; // e.g. 10.0
  src_currency: string; // e.g. "USD"
}

interface UniverseApiResponse {
  events: UniverseEvent[];
  listings: UniverseListing[];
  rates: UniverseRate[];
  users: unknown[];
  meta: { limit: number; offset: number; count: number };
}

const API_BASE = 'https://www.universe.com/api/v2';
const USER_ID = '55fb8b01aed6b30fa804932a'; // PechaKucha Night Asheville
const UPLOADCARE_CDN = 'https://ucarecdn.com';

const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

export async function scrapePechaKucha(): Promise<ScrapedEvent[]> {
  console.log('[PechaKucha] Starting scrape via Universe.com API...');

  try {
    const url = `${API_BASE}/listings?user_id=${USER_ID}&limit=50`;
    console.log(`[PechaKucha] Fetching listings...`);

    const response = await fetchWithRetry(
      url,
      { headers: API_HEADERS, cache: 'no-store' },
      { maxRetries: 3, baseDelay: 1000 }
    );

    const data = (await response.json()) as UniverseApiResponse;
    await debugSave('01-universe-response.json', data, { label: 'PechaKucha' });

    console.log(
      `[PechaKucha] API returned ${data.listings.length} listings, ${data.events.length} events, ${data.rates.length} rates`
    );

    // Build lookup maps
    const eventsById = new Map<string, UniverseEvent>();
    for (const event of data.events) {
      eventsById.set(event.id, event);
    }

    const ratesByListingId = new Map<string, UniverseRate[]>();
    for (const rate of data.rates) {
      const existing = ratesByListingId.get(rate.listing_id) || [];
      existing.push(rate);
      ratesByListingId.set(rate.listing_id, existing);
    }

    const now = new Date();
    const results: ScrapedEvent[] = [];

    for (const listing of data.listings) {
      // Only process active/upcoming listings
      if (listing.state !== 'posted') continue;

      // Find the event (date/time info) for this listing
      const eventData = listing.event_ids
        .map((id) => eventsById.get(id))
        .find((e): e is UniverseEvent => !!e);

      if (!eventData) {
        console.warn(`[PechaKucha] No event data for listing "${listing.title}"`);
        continue;
      }

      // Parse start date - Universe provides ISO 8601 with offset in start_time
      const startDate = new Date(eventData.start_time);
      if (isNaN(startDate.getTime()) || startDate < now) {
        continue;
      }

      // Build price from rates
      const rates = ratesByListingId.get(listing.id) || [];
      const price = formatPrice(rates);

      // Parse location and zip from address string
      const { location, zip } = parseAddress(listing.address);

      // Get image from Uploadcare CDN
      const imageUrl = listing.cover_photo?.uploadcare_id
        ? `${UPLOADCARE_CDN}/${listing.cover_photo.uploadcare_id}/`
        : undefined;

      // Build event URL
      const eventUrl = `https://www.universe.com/events/${listing.slug_param}`;

      results.push({
        sourceId: `pkn-${listing.id}`,
        source: 'PECHAKUCHA',
        title: listing.title,
        description: listing.description || undefined,
        startDate,
        location,
        zip,
        organizer: 'PechaKucha Night Asheville',
        price,
        url: eventUrl,
        imageUrl,
      });
    }

    await debugSave('02-formatted-events.json', results, { label: 'PechaKucha' });

    console.log(`[PechaKucha] Found ${results.length} upcoming events`);
    return results;
  } catch (error) {
    console.error('[PechaKucha] Scrape failed:', error);
    return [];
  }
}

function formatPrice(rates: UniverseRate[]): string {
  if (rates.length === 0) return 'Unknown';

  const prices = rates.map((r) => r.price).filter((p) => typeof p === 'number');
  if (prices.length === 0) return 'Unknown';

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  if (min === 0 && max === 0) return 'Free';
  if (min === 0) return `$${Math.round(max)}`;
  if (min === max) return `$${Math.round(min)}`;
  return `$${Math.round(min)} - $${Math.round(max)}`;
}

/**
 * Parse a Universe.com address string like "131 Sweeten Creek Rd ste 10, Asheville, NC 28803, USA"
 * into location and zip code.
 */
function parseAddress(address?: string): { location?: string; zip?: string } {
  if (!address) return {};

  // Extract zip code (5-digit pattern)
  const zipMatch = address.match(/\b(\d{5})\b/);
  const zip = zipMatch?.[1];

  // Remove ", USA" suffix and build clean location
  const location = address.replace(/,?\s*USA\s*$/i, '').trim();

  return { location: location || undefined, zip };
}
