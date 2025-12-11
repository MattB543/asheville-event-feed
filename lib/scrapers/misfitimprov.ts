import { ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';

/**
 * Misfit Improv Scraper
 *
 * Fetches events from Misfit Improv & Acting School in Asheville, NC.
 * Uses the Crowdwork API which powers their ticketing system.
 *
 * API Endpoints:
 * - Shows (paid performances): /api/v2/misfitimprovavl/shows
 * - Classes (free events/workshops): /api/v2/misfitimprovavl/classes
 */

const API_BASE = 'https://crowdwork.com/api/v2/misfitimprovavl';
const SHOWS_ENDPOINT = `${API_BASE}/shows`;
const CLASSES_ENDPOINT = `${API_BASE}/classes`;

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// Crowdwork API response types
interface CrowdworkCostTier {
  id: number;
  name: string;
  cost: number; // Cost in cents
  quantity: number | null;
}

interface CrowdworkEvent {
  id: number;
  name: string;
  theatre: {
    id: number;
    name: string;
  };
  recurring: string;
  dates: string[]; // ISO 8601 dates with timezone offset
  next_date: string;
  img: {
    url: string;
  } | null;
  description: {
    body: string;
  } | null;
  description_short: string;
  cost: {
    formatted: string; // "Free", "$11.64 (includes fees)", "Multiple prices"
  };
  cost_tiers: CrowdworkCostTier[];
  venue: string;
  url: string;
  timezone: string;
  status: string;
}

interface CrowdworkResponse {
  message: string;
  status: number;
  type: string;
  data: CrowdworkEvent[];
}

/**
 * Format price from Crowdwork event
 * Uses the formatted price, but for "Multiple prices" shows the lowest tier
 */
function formatPrice(event: CrowdworkEvent): string {
  const formatted = event.cost?.formatted;

  if (!formatted) {
    return 'Unknown';
  }

  // If "Multiple prices", calculate from tiers
  if (formatted === 'Multiple prices' && event.cost_tiers?.length > 0) {
    const costs = event.cost_tiers.map(t => t.cost);
    const minCents = Math.min(...costs);
    if (minCents === 0) {
      return 'Free';
    }
    return `From $${Math.round(minCents / 100)}`;
  }

  return formatted;
}

/**
 * Transform a Crowdwork event into ScrapedEvent(s)
 * Events with multiple dates are expanded into separate entries
 */
function transformEvent(event: CrowdworkEvent): ScrapedEvent[] {
  // Skip inactive events
  if (event.status !== 'active') {
    return [];
  }

  const now = new Date();
  const results: ScrapedEvent[] = [];

  // Get common fields
  const title = decodeHtmlEntities(event.name);
  const description = event.description?.body
    ? decodeHtmlEntities(event.description.body)
    : event.description_short
      ? decodeHtmlEntities(event.description_short)
      : undefined;
  // Misfit Improv is at 573 Fairview Rd, Unit 21A, Asheville, NC 28803
  const location = event.venue
    ? `${event.venue}, 573 Fairview Rd, Asheville, NC`
    : 'Misfit Improv, 573 Fairview Rd, Asheville, NC';
  const zip = '28803';
  const organizer = event.theatre?.name || 'Misfit Improv AVL';
  const price = formatPrice(event);
  const imageUrl = event.img?.url || undefined;
  const baseUrl = event.url;

  // Expand each date into a separate event
  for (let i = 0; i < event.dates.length; i++) {
    const dateStr = event.dates[i];
    const startDate = new Date(dateStr);

    // Skip past dates
    if (startDate < now) {
      continue;
    }

    // Create unique sourceId and URL for this date occurrence
    const sourceId = `misfit-${event.id}-${i}`;
    // Append date fragment to URL for uniqueness (DB uses URL as unique key)
    const dateFragment = dateStr.split('T')[0]; // YYYY-MM-DD
    const url = `${baseUrl}#date=${dateFragment}`;

    results.push({
      sourceId,
      source: 'MISFIT_IMPROV',
      title,
      description,
      startDate,
      location,
      zip,
      organizer,
      price,
      url,
      imageUrl,
    });
  }

  return results;
}

/**
 * Fetch events from a Crowdwork endpoint
 */
async function fetchCrowdworkEvents(endpoint: string, type: string): Promise<CrowdworkEvent[]> {
  try {
    const response = await fetchWithRetry(endpoint, {
      headers: API_HEADERS,
    }, {
      maxRetries: 3,
      baseDelay: 1000,
    });

    if (!response.ok) {
      console.error(`[MisfitImprov] ${type} API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: CrowdworkResponse = await response.json();

    if (data.status !== 200 || data.type !== 'success') {
      console.error(`[MisfitImprov] ${type} API returned error:`, data.message);
      return [];
    }

    return data.data || [];
  } catch (error) {
    console.error(`[MisfitImprov] Failed to fetch ${type}:`, error);
    return [];
  }
}

/**
 * Scrape Misfit Improv events
 *
 * Fetches both shows and classes from the Crowdwork API,
 * expands multi-date events, and returns ScrapedEvent array.
 */
export async function scrapeMisfitImprov(): Promise<ScrapedEvent[]> {
  console.log('[MisfitImprov] Starting scrape...');

  // Fetch shows and classes in parallel
  const [shows, classes] = await Promise.all([
    fetchCrowdworkEvents(SHOWS_ENDPOINT, 'shows'),
    fetchCrowdworkEvents(CLASSES_ENDPOINT, 'classes'),
  ]);

  console.log(`[MisfitImprov] Fetched ${shows.length} shows, ${classes.length} classes`);

  // Transform all events (this expands multi-date events)
  const allCrowdworkEvents = [...shows, ...classes];
  const allEvents: ScrapedEvent[] = [];

  for (const event of allCrowdworkEvents) {
    const transformed = transformEvent(event);
    allEvents.push(...transformed);
  }

  console.log(`[MisfitImprov] Complete. Found ${allEvents.length} event occurrences.`);

  return allEvents;
}
