/**
 * Little Animals Space Scraper - Squarespace JSON API
 *
 * Scrapes events from Little Animals Space calendar using Squarespace's JSON API.
 * Little Animals Space is a creative co-working and event space in Asheville.
 *
 * Venue: Little Animals Space - 31 Carolina Ln, Asheville, NC 28801
 *
 * Data Sources:
 *   - Calendar listing: Squarespace ?format=json endpoint
 *   - Events available in `upcoming` and `past` arrays
 *   - Pagination supported via `nextPageUrl`
 */

import { type ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { debugSave } from './base';

// Config
const BASE_URL = 'https://www.littleanimalsspace.com';
const CALENDAR_URL = `${BASE_URL}/calendar?format=json`;
const VENUE_NAME = 'Little Animals Space';
const VENUE_ADDRESS = 'Little Animals Space, 31 Carolina Ln, Asheville, NC';
const VENUE_ZIP = '28801';

// Rate limiting
const REQUEST_DELAY_MS = 300;

// Default image for Little Animals events
const DEFAULT_IMAGE_URL = '/little-animals.png';

// API headers
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SquarespaceEvent {
  id: string;
  title: string;
  urlId: string;
  startDate: number; // Unix timestamp in milliseconds
  endDate: number;
  excerpt?: string;
  body?: string; // HTML content
  assetUrl?: string;
  fullUrl?: string;
  // Location data (may be embedded in the event)
  location?: {
    addressLine1?: string;
    addressLine2?: string;
    addressCity?: string;
    addressState?: string;
    addressZip?: string;
    mapLat?: number;
    mapLng?: number;
  };
}

interface SquarespaceCalendarResponse {
  collection?: {
    id: string;
    title: string;
    itemCount: number;
  };
  past?: SquarespaceEvent[];
  upcoming?: SquarespaceEvent[];
  items?: SquarespaceEvent[];
  pagination?: {
    nextPage: boolean;
    nextPageOffset: number;
    nextPageUrl: string;
    pageSize: number;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Strip HTML tags and decode entities from description
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract price from event body/description
 */
function extractPrice(text: string): string {
  if (!text) return 'Unknown';

  const lowerText = text.toLowerCase();

  // Check for free events
  if (/\bfree\b/i.test(text) && !/free\s*parking/i.test(text) && !/free\s*wifi/i.test(text)) {
    return 'Free';
  }

  // Look for price patterns
  const priceMatch =
    text.match(/\$(\d+(?:\.\d{2})?)/i) || text.match(/(\d+(?:\.\d{2})?)\s*(?:dollars?|USD)/i);

  if (priceMatch) {
    const price = parseFloat(priceMatch[1]);
    if (price === 0) return 'Free';
    return `$${Math.round(price)}`;
  }

  // Check for donation-based
  if (/donation|pay what you can|sliding scale/i.test(lowerText)) {
    return 'Free';
  }

  return 'Unknown';
}

/**
 * Format a Squarespace event to ScrapedEvent
 */
function formatEvent(rawEvent: SquarespaceEvent): ScrapedEvent {
  // Parse description from body or excerpt
  const rawDescription = rawEvent.body || rawEvent.excerpt || '';
  const description = stripHtml(rawDescription) || undefined;

  // Extract price from description
  const price = extractPrice(rawDescription);

  // Build the event URL
  const eventPath = rawEvent.fullUrl || `/calendar/${rawEvent.urlId}`;
  const url = eventPath.startsWith('http') ? eventPath : `${BASE_URL}${eventPath}`;

  return {
    sourceId: `littleanimals-${rawEvent.id}`,
    source: 'LITTLE_ANIMALS',
    title: rawEvent.title,
    description,
    startDate: new Date(rawEvent.startDate),
    location: VENUE_ADDRESS,
    zip: VENUE_ZIP,
    organizer: VENUE_NAME,
    price,
    url,
    imageUrl: rawEvent.assetUrl || DEFAULT_IMAGE_URL,
  };
}

// ============================================================================
// SCRAPER FUNCTIONS
// ============================================================================

/**
 * Fetch all calendar events from Squarespace API with pagination
 * Note: Squarespace may put all events in `past` array regardless of date,
 * so we always fetch all arrays and filter by date separately.
 */
async function fetchCalendarEvents(): Promise<SquarespaceEvent[]> {
  console.log('[LittleAnimals] Fetching calendar events...');

  const allEvents: SquarespaceEvent[] = [];
  let currentUrl = CALENDAR_URL;
  let pageCount = 0;
  const maxPages = 10; // Safety limit

  while (currentUrl && pageCount < maxPages) {
    pageCount++;
    console.log(`[LittleAnimals] Fetching page ${pageCount}...`);

    try {
      const response = await fetchWithRetry(
        currentUrl,
        { headers: API_HEADERS, cache: 'no-store' },
        { maxRetries: 3, baseDelay: 1000 }
      );

      const data = (await response.json()) as SquarespaceCalendarResponse;

      if (pageCount === 1) {
        await debugSave('01-littleanimals-response.json', data);
      }

      // Collect events from all arrays - Squarespace may put all in `past`
      // regardless of actual date, so we collect everything and filter later
      const rawEvents: SquarespaceEvent[] = [
        ...(data.past || []),
        ...(data.upcoming || []),
        ...(data.items || []),
      ];

      allEvents.push(...rawEvents);
      console.log(`[LittleAnimals] Page ${pageCount}: Found ${rawEvents.length} events`);

      // Check for next page
      if (data.pagination?.nextPage && data.pagination.nextPageUrl) {
        currentUrl = `${BASE_URL}${data.pagination.nextPageUrl}&format=json`;
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      } else {
        currentUrl = '';
      }
    } catch (error) {
      console.error(`[LittleAnimals] Error fetching page ${pageCount}:`, error);
      break;
    }
  }

  console.log(`[LittleAnimals] Total raw events: ${allEvents.length}`);
  return allEvents;
}

// ============================================================================
// MAIN SCRAPER FUNCTION
// ============================================================================

/**
 * Scrape events from Little Animals Space
 * @param includePast - If true, include past events (for testing). Default: false
 */
export async function scrapeLittleAnimals(includePast = false): Promise<ScrapedEvent[]> {
  console.log('[LittleAnimals] Starting scrape...');

  try {
    // Fetch all events (always get all, filter by date later)
    const rawEvents = await fetchCalendarEvents();

    if (rawEvents.length === 0) {
      console.log('[LittleAnimals] No events found');
      return [];
    }

    // Filter to future events only (unless testing with past events)
    const now = Date.now();
    const filteredEvents = includePast ? rawEvents : rawEvents.filter((ev) => ev.startDate > now);

    console.log(`[LittleAnimals] ${filteredEvents.length} events after date filter`);

    // Format events
    const events: ScrapedEvent[] = filteredEvents.map(formatEvent);

    // Sort by date
    events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    // Save debug output
    await debugSave('02-littleanimals-events.json', events);

    // Generate and save validation report
    const report = generateValidationReport(events);
    await debugSave('03-littleanimals-validation.txt', report);

    console.log(`[LittleAnimals] Finished. Found ${events.length} events`);
    return events;
  } catch (error) {
    console.error('[LittleAnimals] Scrape failed:', error);
    return [];
  }
}

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - ${VENUE_NAME}`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    '=== DATE VALIDATION ===',
  ];

  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  for (const event of events) {
    const date = event.startDate;
    const issues: string[] = [];

    if (isNaN(date.getTime())) {
      issues.push('INVALID DATE');
    } else if (date < now) {
      issues.push('IN PAST');
    } else if (date > oneYearFromNow) {
      issues.push('TOO FAR FUTURE');
    }

    const hours = date.getHours();
    const mins = date.getMinutes();
    if (hours === 0 && mins === 0) {
      issues.push('MIDNIGHT (missing time?)');
    }

    if (issues.length > 0) {
      lines.push(`  ${event.title.slice(0, 50)}`);
      lines.push(
        `    Date: ${date.toISOString()} -> ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
      );
      lines.push(`    Issues: ${issues.join(', ')}`);
    }
  }

  lines.push('', '=== FIELD COMPLETENESS ===');
  const withImages = events.filter((e) => e.imageUrl).length;
  const withPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter((e) => e.description).length;

  lines.push(
    `  With images: ${withImages}/${events.length} (${events.length > 0 ? Math.round((withImages / events.length) * 100) : 0}%)`
  );
  lines.push(
    `  With prices: ${withPrices}/${events.length} (${events.length > 0 ? Math.round((withPrices / events.length) * 100) : 0}%)`
  );
  lines.push(
    `  With descriptions: ${withDescriptions}/${events.length} (${events.length > 0 ? Math.round((withDescriptions / events.length) * 100) : 0}%)`
  );

  lines.push('', '=== SAMPLE EVENTS ===');
  for (const event of events.slice(0, 10)) {
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC): ${event.startDate.toISOString()}`);
    lines.push(
      `  Date (ET): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
    lines.push(`  Location: ${event.location || 'N/A'}`);
    lines.push(`  Price: ${event.price || 'N/A'}`);
    lines.push(`  URL: ${event.url}`);
    if (event.imageUrl) {
      lines.push(`  Image: ${event.imageUrl.substring(0, 60)}...`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
