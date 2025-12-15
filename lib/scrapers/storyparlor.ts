/**
 * Story Parlor Scraper - Squarespace JSON-LD Scraping
 *
 * Scrapes events from Story Parlor website using JSON-LD structured data.
 * Story Parlor is a community-programmed storytelling venue.
 *
 * Venue: Story Parlor - 227 Haywood Road, Asheville, NC 28806
 *
 * Data Sources:
 *   - Event listing: Squarespace ?format=json endpoint
 *   - Event details: JSON-LD structured data on event pages
 *   - Price: Extracted from HTML (not in JSON-LD)
 *
 * Debug Mode:
 *   Set DEBUG_DIR env var to save raw data and validation reports
 */

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '../utils/retry';
import { decodeHtmlEntities } from '../utils/htmlEntities';

// Config
const BASE_URL = 'https://storyparloravl.com';
const EVENTS_URL = `${BASE_URL}/events?format=json`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const VENUE_NAME = 'Story Parlor';
const VENUE_ADDRESS = 'Story Parlor, 227 Haywood Road, Asheville, NC';
const VENUE_ZIP = '28806';

// Rate limiting
const REQUEST_DELAY_MS = 300;

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

// Debug helper - only works when DEBUG_DIR is set (local testing only)
async function debugSave(filename: string, data: unknown): Promise<void> {
  const debugDir = process.env.DEBUG_DIR;
  if (!debugDir) return;

  try {
    // Dynamic import to avoid bundling fs/path in serverless
    const fs = await import('fs');
    const path = await import('path');

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

function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - ${VENUE_NAME}`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
  ];

  // Date validation
  lines.push('='.repeat(60));
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
    lines.push('  All dates valid');
  } else {
    lines.push('');
    lines.push(`  ${dateIssues} events have date issues`);
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

  const pct = (n: number) => total === 0 ? '0' : Math.round((n / total) * 100).toString();

  lines.push(`  Images:       ${withImages}/${total} (${pct(withImages)}%)`);
  lines.push(`  Prices:       ${withPrices}/${total} (${pct(withPrices)}%)`);
  lines.push(`  Descriptions: ${withDescriptions}/${total} (${pct(withDescriptions)}%)`);

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
    lines.push(`  Price:     ${event.price || 'N/A'}`);
    lines.push(`  URL:       ${event.url}`);
    if (event.imageUrl) {
      lines.push(`  Image:     ${event.imageUrl.substring(0, 60)}...`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface JSONLDEvent {
  '@type': string;
  name: string;
  startDate: string;
  endDate?: string;
  url?: string;
  image?: string | string[];
  description?: string;
  location?: {
    '@type'?: string;
    name?: string;
    address?: string;
  };
  offers?: {
    '@type'?: string;
    price?: number | string;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract description from meta tag
 */
function extractMetaDescription(html: string): string | undefined {
  // Try name="description" first (both attribute orders)
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);

  if (metaDesc && metaDesc[1]) {
    const decoded = decodeHtmlEntities(metaDesc[1]);
    // Only return if it's a meaningful description (not just venue info)
    if (decoded.length > 50) {
      return decoded;
    }
  }

  // Fallback to og:description
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);

  if (ogDesc && ogDesc[1]) {
    const decoded = decodeHtmlEntities(ogDesc[1]);
    if (decoded.length > 50) {
      return decoded;
    }
  }

  return undefined;
}

/**
 * Clean title by removing date/time suffix and venue name
 * Example: "T'was the Season | A Storytelling Event | Saturday Dec 13 | 7:30pm — Story Parlor"
 * becomes: "T'was the Season | A Storytelling Event"
 */
function cleanTitle(rawTitle: string): string {
  // Remove " — Story Parlor" or similar suffix
  let title = rawTitle.replace(/\s*[—–-]\s*Story Parlor\s*$/i, '');

  // Remove date/time patterns like "| Saturday Dec 13 | 7:30pm" or "| Friday | February 20 | 7:30pm"
  // Match: | Day (optional |) Month DD and everything after (including time)
  title = title.replace(/\s*\|\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\|?\s*\w+\s+\d{1,2}.*$/i, '');

  // Clean up any trailing pipes
  title = title.replace(/\s*\|\s*$/, '');

  return decodeHtmlEntities(title.trim());
}

/**
 * Extract price from HTML content
 */
function extractPrice(html: string): string {
  // Look for patterns like "Tickets $25" or "$25 tickets"
  const ticketMatch = html.match(/tickets?\s*\$(\d+(?:\.\d{2})?)/i)
    || html.match(/\$(\d+(?:\.\d{2})?)\s*tickets?/i);

  if (ticketMatch) {
    return `$${ticketMatch[1]}`;
  }

  // Look for price range pattern like "$15 - $25"
  const priceRangeMatch = html.match(/\$(\d+(?:\.\d{2})?)\s*[-–]\s*\$(\d+(?:\.\d{2})?)/);
  if (priceRangeMatch) {
    const min = parseFloat(priceRangeMatch[1]);
    const max = parseFloat(priceRangeMatch[2]);
    if (min === max) {
      return `$${min}`;
    }
    return `$${min} - $${max}`;
  }

  // Look for "Free" or "free admission"
  if (/\bfree\b/i.test(html) && !/free\s*parking/i.test(html)) {
    return 'Free';
  }

  // Look for contextual single price
  const contextualMatch = html.match(
    /(?:price|admission|cover|entry|cost)[:\s]*\$(\d+(?:\.\d{2})?)/i
  );
  if (contextualMatch) {
    return `$${contextualMatch[1]}`;
  }

  return 'Unknown';
}

// ============================================================================
// SCRAPER FUNCTIONS
// ============================================================================

/**
 * Fetch all event URLs from the Squarespace events page
 */
async function fetchEventUrls(): Promise<string[]> {
  console.log('[StoryParlor] Fetching events listing...');

  try {
    const response = await fetchWithRetry(
      EVENTS_URL,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 }
    );
    const data = await response.json();

    // Save raw response for debugging
    await debugSave('01-raw-listing-response.json', data);

    // Extract event URLs from mainContent HTML
    const mainContent = data.mainContent || '';
    const urlPattern = /href="(\/calendar\/[^"]+)"/g;
    const urls = new Set<string>();
    let match;

    while ((match = urlPattern.exec(mainContent)) !== null) {
      urls.add(`${BASE_URL}${match[1]}`);
    }

    console.log(`[StoryParlor] Found ${urls.size} event URLs`);
    return [...urls];
  } catch (error) {
    console.error('[StoryParlor] Error fetching events listing:', error);
    return [];
  }
}

/**
 * Scrape a single event page for JSON-LD data
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

    // Extract JSON-LD structured data - find the Event type specifically
    const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    let eventJsonLd: JSONLDEvent | null = null;

    for (const match of jsonLdMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed['@type'] === 'Event') {
          eventJsonLd = parsed;
          break;
        }
      } catch {
        // Skip invalid JSON
      }
    }

    if (!eventJsonLd) {
      console.warn(`[StoryParlor] No Event JSON-LD found: ${url}`);
      return null;
    }

    // Parse date - Squarespace includes timezone offset
    const startDate = new Date(eventJsonLd.startDate);
    if (isNaN(startDate.getTime())) {
      console.warn(`[StoryParlor] Invalid date: ${url}`);
      return null;
    }

    // Get slug for sourceId
    const slug = url.match(/\/calendar\/([^/?]+)/)?.[1] || 'unknown';

    // Clean title
    const title = cleanTitle(eventJsonLd.name);

    // Extract description from meta tag (JSON-LD may not include it)
    const description = extractMetaDescription(html);

    // Extract price from HTML
    const price = extractPrice(html);

    // Get image URL (may be array or string)
    let imageUrl: string | undefined;
    if (eventJsonLd.image) {
      imageUrl = Array.isArray(eventJsonLd.image) ? eventJsonLd.image[0] : eventJsonLd.image;
    }

    return {
      sourceId: `storyparlor-${slug}`,
      source: 'STORY_PARLOR',
      title,
      description,
      startDate,
      location: VENUE_ADDRESS,
      zip: VENUE_ZIP,
      organizer: VENUE_NAME,
      price,
      url,
      imageUrl,
    };
  } catch (error) {
    console.warn(`[StoryParlor] Failed to scrape: ${url}`, error instanceof Error ? error.message : error);
    return null;
  }
}

// ============================================================================
// MAIN SCRAPER FUNCTION
// ============================================================================

/**
 * Scrape events from Story Parlor
 */
export async function scrapeStoryParlor(): Promise<ScrapedEvent[]> {
  console.log('[StoryParlor] Starting scrape...');

  // Get all event URLs
  const urls = await fetchEventUrls();

  if (urls.length === 0) {
    console.log('[StoryParlor] No event URLs found');
    return [];
  }

  // Save URLs for debugging
  await debugSave('02-event-urls.json', urls);

  // Scrape each event page
  console.log(`[StoryParlor] Scraping ${urls.length} event pages...`);
  const events: ScrapedEvent[] = [];
  const rawEvents: Array<{ url: string; event: ScrapedEvent | null }> = [];
  let scraped = 0;
  let failed = 0;

  for (const url of urls) {
    const event = await scrapeEventPage(url);
    rawEvents.push({ url, event });

    if (event) {
      events.push(event);
      scraped++;
    } else {
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }

  // Save raw scraped events for debugging
  await debugSave('03-scraped-events.json', rawEvents);

  // Sort by date
  events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // Save final events
  await debugSave('04-final-events.json', events);

  // Save validation report
  const report = generateValidationReport(events);
  await debugSave('05-validation-report.txt', report);

  console.log(`[StoryParlor] Scraped ${scraped} events (${failed} failed)`);

  return events;
}

// Export for testing
export { fetchEventUrls, scrapeEventPage, cleanTitle, extractPrice };
