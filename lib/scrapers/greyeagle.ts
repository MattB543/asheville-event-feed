/**
 * Grey Eagle Scraper - Website JSON-LD Scraping
 *
 * Scrapes events from The Grey Eagle website using JSON-LD structured data
 * combined with meta description for event details.
 * No Ticketmaster integration (venue has no TM events listed).
 *
 * Venue: The Grey Eagle - 185 Clingman Ave, Asheville, NC
 */

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '../utils/retry';

// Config
const CALENDAR_URL = 'https://www.thegreyeagle.com/calendar/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const VENUE_NAME = 'The Grey Eagle';

/**
 * Decode HTML entities in a string
 */
function decodeHtmlEntities(text: string): string {
  return text
    // Named entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    // Numeric entities for common characters
    .replace(/&#8211;/g, '–')  // en-dash
    .replace(/&#8212;/g, '—')  // em-dash
    .replace(/&#8217;/g, "'")  // right single quote
    .replace(/&#8216;/g, "'")  // left single quote
    .replace(/&#8220;/g, '"')  // left double quote
    .replace(/&#8221;/g, '"')  // right double quote
    .replace(/&#8230;/g, '…')  // ellipsis
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    // Named entities for special chars
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

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
    const response = await fetchWithRetry(
      CALENDAR_URL,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 }
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

    // Extract JSON-LD structured data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!jsonLdMatch) return null;

    let jsonLd: JSONLDEvent;
    try {
      jsonLd = JSON.parse(jsonLdMatch[1]);
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
    let location = VENUE_NAME;
    if (jsonLd.location?.name) {
      if (jsonLd.location.name.includes('Special Event')) {
        location = `${VENUE_NAME} (Special Event)`;
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
      // Look for single price anywhere
      const singlePriceMatch = html.match(/\$(\d+(?:\.\d{2})?)/);
      if (singlePriceMatch) {
        price = `$${singlePriceMatch[1]}`;
      }
    }

    return {
      sourceId: `ge-${slug}`,
      source: 'GREY_EAGLE',
      title,
      description,
      startDate,
      location,
      organizer: VENUE_NAME,
      price,
      url: jsonLd.url || url,
      imageUrl: jsonLd.image,
    };
  } catch (error) {
    // Silent fail for individual pages
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
    await new Promise(r => setTimeout(r, 150));
  }

  // Sort by date
  events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  console.log(`[GreyEagle] Scraped ${scraped} events (${failed} failed)`);

  return events;
}

// Export for testing
export { fetchEventUrls, scrapeEventPage };
