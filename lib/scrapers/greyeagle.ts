/**
 * Grey Eagle Scraper - Website JSON-LD Scraping
 *
 * Scrapes events from The Grey Eagle website using JSON-LD structured data
 * combined with meta description for event details.
 * No Ticketmaster integration (venue has no TM events listed).
 *
 * Venue: The Grey Eagle - 185 Clingman Ave, Asheville, NC
 */

import { type ScrapedEvent } from './types';
import { fetchEventData } from './base';
import { decodeHtmlEntities } from '../utils/parsers';

// Config
const CALENDAR_URL = 'https://www.thegreyeagle.com/calendar/';
const VENUE_NAME = 'The Grey Eagle';
const VENUE_ADDRESS = 'The Grey Eagle, 185 Clingman Ave, Asheville, NC';
const VENUE_ZIP = '28801';

/**
 * Extract description from meta tag
 */
function extractMetaDescription(html: string): string | undefined {
  // Try name="description" first (both attribute orders)
  const metaDesc =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);

  if (metaDesc && metaDesc[1]) {
    const decoded = decodeHtmlEntities(metaDesc[1]);
    // Only return if it's a meaningful description (not just venue info)
    if (decoded.length > 50) {
      return decoded;
    }
  }

  // Fallback to og:description
  const ogDesc =
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);

  if (ogDesc && ogDesc[1]) {
    const decoded = decodeHtmlEntities(ogDesc[1]);
    if (decoded.length > 50) {
      return decoded;
    }
  }

  return undefined;
}

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
 * Fetch all event URLs from the calendar page
 */
async function fetchEventUrls(): Promise<string[]> {
  console.log('[GreyEagle] Fetching calendar page...');

  try {
    const response = await fetchEventData(
      CALENDAR_URL,
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 },
      'GreyEagle'
    );
    const html = await response.text();

    // Extract event URLs
    const eventUrlPattern = /href="(https:\/\/www\.thegreyeagle\.com\/event\/[^"]+)"/g;
    const urls = new Set<string>();
    let match;

    while ((match = eventUrlPattern.exec(html)) !== null) {
      urls.add(match[1]);
    }

    console.log(`[GreyEagle] Found ${urls.size} event URLs`);
    return [...urls];
  } catch (error) {
    console.error('[GreyEagle] Error fetching calendar:', error);
    return [];
  }
}

/**
 * Scrape a single event page for JSON-LD data
 */
async function scrapeEventPage(url: string): Promise<ScrapedEvent | null> {
  try {
    const response = await fetchEventData(
      url,
      {
        headers: {
          Accept: 'text/html',
        },
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 500 },
      'GreyEagle'
    );
    const html = await response.text();

    // Extract JSON-LD structured data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!jsonLdMatch) return null;

    let jsonLd: JSONLDEvent;
    try {
      jsonLd = JSON.parse(jsonLdMatch[1]) as JSONLDEvent;
    } catch {
      return null;
    }

    if (jsonLd['@type'] !== 'Event') return null;

    // Parse date
    const startDate = new Date(jsonLd.startDate);
    if (isNaN(startDate.getTime())) return null;

    // Get slug for sourceId
    const slug = url.match(/\/event\/([^/]+)/)?.[1] || 'unknown';

    // Clean title (decode HTML entities)
    const title = decodeHtmlEntities(jsonLd.name);

    // Extract description from meta tag (JSON-LD doesn't include it)
    const description = extractMetaDescription(html);

    // Determine venue from location
    let location = VENUE_ADDRESS;
    if (jsonLd.location?.name) {
      if (jsonLd.location.name.includes('Special Event')) {
        location = `${VENUE_ADDRESS} (Special Event)`;
      }
    }

    // Try to extract price from HTML since JSON-LD price is always 0
    let price = 'Unknown';
    // Look for price range pattern like "$15 - $21.84" or "$15–$21.84"
    const priceRangeMatch = html.match(/\$(\d+(?:\.\d{2})?)\s*[-–]\s*\$(\d+(?:\.\d{2})?)/);
    if (priceRangeMatch) {
      const min = parseFloat(priceRangeMatch[1]);
      const max = parseFloat(priceRangeMatch[2]);
      if (min === max) {
        price = `$${min}`;
      } else {
        price = `$${min} - $${max}`;
      }
    } else {
      // Look for single price in ticket/price context to avoid matching unrelated dollar amounts
      // Matches patterns like "Tickets: $25", "Price: $30", "$25 advance", "$30 door"
      const contextualPriceMatch =
        html.match(
          /(?:tickets?|price|admission|cover|entry|advance|door)[:\s]*\$(\d+(?:\.\d{2})?)/i
        ) || html.match(/\$(\d+(?:\.\d{2})?)\s*(?:advance|door|cover|tickets?)/i);
      if (contextualPriceMatch) {
        price = `$${contextualPriceMatch[1]}`;
      }
    }

    return {
      sourceId: `ge-${slug}`,
      source: 'GREY_EAGLE',
      title,
      description,
      startDate,
      location,
      zip: VENUE_ZIP,
      organizer: VENUE_NAME,
      price,
      url: jsonLd.url || url,
      imageUrl: jsonLd.image,
    };
  } catch (error) {
    console.warn(
      `[GreyEagle] Failed to scrape: ${url}`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Main scraper function
 */
export async function scrapeGreyEagle(): Promise<ScrapedEvent[]> {
  console.log('[GreyEagle] Starting scrape...');

  // Get all event URLs
  const urls = await fetchEventUrls();

  if (urls.length === 0) {
    console.log('[GreyEagle] No event URLs found');
    return [];
  }

  // Scrape each event page
  console.log(`[GreyEagle] Scraping ${urls.length} event pages...`);
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

  // Sort by date
  events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  console.log(`[GreyEagle] Scraped ${scraped} events (${failed} failed)`);

  return events;
}

// Export for testing
export { fetchEventUrls, scrapeEventPage };
