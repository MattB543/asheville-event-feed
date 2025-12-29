/**
 * [VENUE NAME] Scraper
 *
 * [Brief description of the venue and data sources]
 *
 * Scraper Type: [API-based | HTML/JSON-LD | Hybrid]
 * Data Sources:
 *   - [Primary source description]
 *   - [Secondary source if applicable]
 *
 * Debug Mode:
 *   Set DEBUG_DIR env var to save raw data and validation reports
 */

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { formatPrice } from '@/lib/utils/parsers';
import { isNonNCEvent } from '@/lib/utils/geo';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import { parseAsEastern } from '@/lib/utils/timezone';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_URL = 'https://example.com';
const API_URL = `${BASE_URL}/api/events`;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Rate limiting (adjust based on site behavior)
const PAGE_DELAY_MS = 500;
const REQUEST_DELAY_MS = 150; // eslint-disable-line @typescript-eslint/no-unused-vars -- Template placeholder
const MAX_PAGES = 10;

// Venue constants
const VENUE_NAME = 'Venue Name';
const SOURCE_ID = 'YOUR_SOURCE'; // Must match types.ts

// API headers
const API_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

/**
 * Save data to debug folder if DEBUG_DIR is set
 */
function debugSave(filename: string, data: unknown): void {
  const debugDir = process.env.DEBUG_DIR;
  if (!debugDir) return;

  try {
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const filepath = path.join(debugDir, filename);
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filepath, content);
    console.log(`[DEBUG] Saved: ${filepath}`);
  } catch (err) {
    console.warn(`[DEBUG] Failed to save ${filename}:`, err);
  }
}

/**
 * Generate validation report for scraped events
 */
function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - ${VENUE_NAME}`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
  ];

  // Date validation
  lines.push('=' .repeat(60));
  lines.push('DATE VALIDATION');
  lines.push('='.repeat(60));

  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  let dateIssues = 0;

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

    // Check for midnight (might indicate missing time)
    const etDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (etDate.getHours() === 0 && etDate.getMinutes() === 0) {
      issues.push('MIDNIGHT (missing time?)');
    }

    if (issues.length > 0) {
      dateIssues++;
      lines.push('');
      lines.push(`  "${event.title.slice(0, 50)}"`);
      lines.push(`    UTC:     ${date.toISOString()}`);
      lines.push(`    Eastern: ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
      lines.push(`    Issues:  ${issues.join(', ')}`);
    }
  }

  if (dateIssues === 0) {
    lines.push('  ✓ All dates valid');
  } else {
    lines.push('');
    lines.push(`  ⚠️  ${dateIssues} events have date issues`);
  }

  // Field completeness
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('FIELD COMPLETENESS');
  lines.push('='.repeat(60));

  const total = events.length;
  const withImages = events.filter(e => e.imageUrl).length;
  const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter(e => e.description).length;
  const withLocations = events.filter(e => e.location).length;
  const withOrganizers = events.filter(e => e.organizer).length;

  const pct = (n: number) => total === 0 ? '0' : Math.round((n / total) * 100).toString();

  lines.push(`  Images:       ${withImages}/${total} (${pct(withImages)}%)`);
  lines.push(`  Prices:       ${withPrices}/${total} (${pct(withPrices)}%)`);
  lines.push(`  Descriptions: ${withDescriptions}/${total} (${pct(withDescriptions)}%)`);
  lines.push(`  Locations:    ${withLocations}/${total} (${pct(withLocations)}%)`);
  lines.push(`  Organizers:   ${withOrganizers}/${total} (${pct(withOrganizers)}%)`);

  // Price distribution
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('PRICE DISTRIBUTION');
  lines.push('='.repeat(60));

  const priceCounts: Record<string, number> = {};
  for (const event of events) {
    const price = event.price || 'Unknown';
    priceCounts[price] = (priceCounts[price] || 0) + 1;
  }

  const sortedPrices = Object.entries(priceCounts).sort((a, b) => b[1] - a[1]);
  for (const [price, count] of sortedPrices.slice(0, 10)) {
    lines.push(`  ${count.toString().padStart(4)} - ${price}`);
  }

  // Sample events
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('SAMPLE EVENTS (first 5)');
  lines.push('='.repeat(60));

  for (const event of events.slice(0, 5)) {
    lines.push('');
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC):     ${event.startDate.toISOString()}`);
    lines.push(`  Date (Eastern): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    lines.push(`  Location:  ${event.location || 'N/A'}`);
    lines.push(`  Organizer: ${event.organizer || 'N/A'}`);
    lines.push(`  Price:     ${event.price || 'N/A'}`);
    lines.push(`  URL:       ${event.url}`);
    if (event.imageUrl) {
      lines.push(`  Image:     ${event.imageUrl.substring(0, 60)}...`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// TYPE DEFINITIONS (customize based on API/page structure)
// ============================================================================

interface ApiEvent {
  id: string;
  title: string;
  description?: string;
  date: string;
  time?: string;
  price?: number | string;
  url: string;
  image?: string;
}

interface ApiResponse {
  events: ApiEvent[];
  pagination?: {
    currentPage: number;
    totalPages: number;
    hasNext: boolean;
  };
}

// For JSON-LD parsing
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
  };
  offers?: {
    price?: number | string;
  };
}

// ============================================================================
// MAIN SCRAPER FUNCTION
// ============================================================================

/**
 * Scrape events from [VENUE NAME]
 */
export async function scrapeYourSource(): Promise<ScrapedEvent[]> {
  console.log(`[${VENUE_NAME}] Starting scrape...`);

  const allEvents: ScrapedEvent[] = [];

  // ── Option A: API-based approach ──
  // Uncomment and customize if the site has a JSON API

  let page = 1;
  let hasMore = true;
  const rawResponses: ApiResponse[] = [];

  while (hasMore && page <= MAX_PAGES) {
    try {
      console.log(`[${VENUE_NAME}] Fetching page ${page}...`);

      const response = await fetchWithRetry(
        `${API_URL}?page=${page}`,
        { headers: API_HEADERS, cache: 'no-store' },
        { maxRetries: 3, baseDelay: 1000 }
      );

      const data: ApiResponse = await response.json();
      rawResponses.push(data);

      const formatted = data.events.map(formatApiEvent);
      allEvents.push(...formatted);

      hasMore = data.pagination?.hasNext ?? false;
      page++;

      // Rate limiting
      if (hasMore) {
        await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
      }
    } catch (error) {
      console.error(`[${VENUE_NAME}] Error on page ${page}:`, error);
      hasMore = false;
    }
  }

  // Save raw API responses
  debugSave('01-raw-api-responses.json', rawResponses);

  // ── Option B: HTML/JSON-LD approach ──
  // Uncomment and customize if the site uses structured data
  /*
  const urls = await fetchEventUrls();
  debugSave('01-raw-event-urls.json', urls);

  console.log(`[${VENUE_NAME}] Found ${urls.length} event URLs`);

  const rawPages: Array<{ url: string; html: string }> = [];

  for (const url of urls) {
    const event = await scrapeEventPage(url, rawPages);
    if (event) {
      allEvents.push(event);
    }
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }

  debugSave('01-raw-html-pages.json', rawPages);
  */

  // Save transformed events (before filtering)
  debugSave('02-transformed-events.json', allEvents);

  // Filter non-NC events
  const ncEvents = allEvents.filter(ev => !isNonNCEvent(ev.title, ev.location));
  const filteredCount = allEvents.length - ncEvents.length;

  if (filteredCount > 0) {
    console.log(`[${VENUE_NAME}] Filtered out ${filteredCount} non-NC events`);
  }

  // Sort by date
  ncEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // Save final events
  debugSave('03-final-events.json', ncEvents);

  // Save validation report
  const report = generateValidationReport(ncEvents);
  debugSave('04-validation-report.txt', report);

  console.log(`[${VENUE_NAME}] Finished. Found ${ncEvents.length} events.`);
  return ncEvents;
}

// ============================================================================
// FORMATTING FUNCTIONS
// ============================================================================

/**
 * Format an API event to ScrapedEvent
 */
function formatApiEvent(ev: ApiEvent): ScrapedEvent {
  // Parse date - adjust based on API format
  let startDate: Date;
  if (ev.time) {
    // If separate date and time fields
    startDate = parseAsEastern(ev.date, ev.time);
  } else {
    // If ISO date or needs default time
    const parsed = new Date(ev.date);
    if (isNaN(parsed.getTime())) {
      startDate = parseAsEastern(ev.date, '19:00:00');
    } else {
      startDate = parsed;
    }
  }

  return {
    sourceId: `${SOURCE_ID.toLowerCase()}-${ev.id}`,
    source: SOURCE_ID as ScrapedEvent['source'],
    title: decodeHtmlEntities(ev.title),
    description: ev.description ? decodeHtmlEntities(ev.description) : undefined,
    startDate,
    location: VENUE_NAME,
    organizer: VENUE_NAME,
    price: formatPrice(ev.price),
    url: ev.url.startsWith('http') ? ev.url : `${BASE_URL}${ev.url}`,
    imageUrl: ev.image,
  };
}

/**
 * Fetch event URLs from calendar/listing page (for HTML scraping)
 */
async function fetchEventUrls(): Promise<string[]> {
  try {
    const response = await fetchWithRetry(
      `${BASE_URL}/events`,
      {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 }
    );

    const html = await response.text();

    // Customize regex pattern based on site's URL structure
    const pattern = /href="(https?:\/\/[^"]*\/event\/[^"]+)"/g;
    const urls = new Set<string>();
    let match;

    while ((match = pattern.exec(html)) !== null) {
      urls.add(match[1]);
    }

    return [...urls];
  } catch (error) {
    console.error(`[${VENUE_NAME}] Error fetching event URLs:`, error);
    return [];
  }
}

/**
 * Scrape a single event page for JSON-LD data
 */
async function scrapeEventPage(
  url: string,
  rawPages?: Array<{ url: string; html: string }>
): Promise<ScrapedEvent | null> {
  try {
    const response = await fetchWithRetry(
      url,
      {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 500 }
    );

    const html = await response.text();

    // Save raw HTML if collecting
    if (rawPages) {
      rawPages.push({ url, html: html.substring(0, 5000) }); // Truncate to save space
    }

    // Extract JSON-LD
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!jsonLdMatch) {
      console.warn(`[${VENUE_NAME}] No JSON-LD found: ${url}`);
      return null;
    }

    let jsonLd: JSONLDEvent;
    try {
      jsonLd = JSON.parse(jsonLdMatch[1]);
    } catch {
      console.warn(`[${VENUE_NAME}] Invalid JSON-LD: ${url}`);
      return null;
    }

    if (jsonLd['@type'] !== 'Event') {
      return null;
    }

    // Parse date
    const startDate = new Date(jsonLd.startDate);
    if (isNaN(startDate.getTime())) {
      console.warn(`[${VENUE_NAME}] Invalid date: ${url}`);
      return null;
    }

    // Extract slug for sourceId
    const slug = url.match(/\/event\/([^/]+)/)?.[1] || 'unknown';

    // Extract price if available
    let price = 'Unknown';
    if (jsonLd.offers?.price !== undefined) {
      price = formatPrice(jsonLd.offers.price);
    }

    return {
      sourceId: `${SOURCE_ID.toLowerCase()}-${slug}`,
      source: SOURCE_ID as ScrapedEvent['source'],
      title: decodeHtmlEntities(jsonLd.name),
      description: jsonLd.description ? decodeHtmlEntities(jsonLd.description) : undefined,
      startDate,
      location: jsonLd.location?.name || VENUE_NAME,
      organizer: VENUE_NAME,
      price,
      url: jsonLd.url || url,
      imageUrl: jsonLd.image,
    };
  } catch (error) {
    console.warn(`[${VENUE_NAME}] Failed to scrape: ${url}`, error);
    return null;
  }
}

// ============================================================================
// UTILITY FUNCTIONS (for deduplication in hybrid scrapers)
// ============================================================================

/**
 * Normalize title for comparison (available for deduplication)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Template utility function
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get local date key (YYYY-MM-DD) without timezone conversion (available for deduplication)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Template utility function
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Export for testing
export { fetchEventUrls, scrapeEventPage, formatApiEvent };
