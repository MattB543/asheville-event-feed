/**
 * Harrah's Cherokee Center Asheville Scraper - Ticketmaster API Version
 *
 * Uses Ticketmaster Discovery API as primary source for stable, structured data.
 * Falls back to HTML scraping for events not on Ticketmaster.
 *
 * Venue ID: KovZpZAJvnIA (Harrah's Cherokee Center - Asheville)
 *
 * Requires: TICKETMASTER_API_KEY in environment
 */

import { ScrapedEvent } from '../lib/scrapers/types';
import { fetchWithRetry } from '../lib/utils/retry';

// Ticketmaster API config
const TM_API_KEY = process.env.TICKETMASTER_API_KEY;
const TM_BASE_URL = 'https://app.ticketmaster.com/discovery/v2';
const HARRAHS_VENUE_ID = 'KovZpZAJvnIA';

// HTML scraping config (fallback)
const EVENTS_PAGE_URL = 'https://www.harrahscherokeecenterasheville.com/events-tickets/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

interface TMEvent {
  id: string;
  name: string;
  url: string;
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
  };
  priceRanges?: Array<{
    min: number;
    max: number;
    currency: string;
  }>;
  images?: Array<{
    url: string;
    width: number;
    height: number;
    ratio: string;
  }>;
  info?: string;        // Event info/logistics
  pleaseNote?: string;  // Additional notes
  description?: string; // Rarely populated
  _embedded?: {
    venues?: Array<{ name: string }>;
    attractions?: Array<{ name: string; description?: string }>;
  };
}

interface TMResponse {
  _embedded?: {
    events?: TMEvent[];
  };
  page?: {
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

/**
 * Fetch events from Ticketmaster Discovery API
 */
async function fetchTicketmasterEvents(): Promise<ScrapedEvent[]> {
  if (!TM_API_KEY) {
    console.log('[Harrahs-TM] No TICKETMASTER_API_KEY set, skipping API fetch');
    return [];
  }

  console.log('[Harrahs-TM] Fetching from Ticketmaster API...');

  const events: ScrapedEvent[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${TM_BASE_URL}/events.json`);
    url.searchParams.set('apikey', TM_API_KEY);
    url.searchParams.set('venueId', HARRAHS_VENUE_ID);
    url.searchParams.set('size', '50');
    url.searchParams.set('page', page.toString());
    url.searchParams.set('sort', 'date,asc');

    try {
      const response = await fetchWithRetry(
        url.toString(),
        { cache: 'no-store' },
        { maxRetries: 3, baseDelay: 1000 }
      );
      const data: TMResponse = await response.json();

      if (data._embedded?.events) {
        for (const event of data._embedded.events) {
          const scraped = formatTMEvent(event);
          if (scraped) {
            events.push(scraped);
          }
        }
      }

      // Check pagination
      if (data.page) {
        const { number, totalPages } = data.page;
        hasMore = number < totalPages - 1;
        page++;
      } else {
        hasMore = false;
      }

      // Rate limit: 200ms between requests
      await new Promise(r => setTimeout(r, 200));

    } catch (error) {
      console.error('[Harrahs-TM] API error:', error);
      hasMore = false;
    }
  }

  console.log(`[Harrahs-TM] Found ${events.length} events from Ticketmaster`);
  return events;
}

/**
 * Format Ticketmaster event to ScrapedEvent
 */
function formatTMEvent(event: TMEvent): ScrapedEvent | null {
  if (!event.dates?.start?.localDate) {
    return null;
  }

  // Parse date
  const dateStr = event.dates.start.localDate;
  const timeStr = event.dates.start.localTime || '19:00:00';
  const startDate = new Date(`${dateStr}T${timeStr}`);

  // Get best image (prefer 16:9 ratio, largest size)
  let imageUrl: string | undefined;
  if (event.images?.length) {
    const preferred = event.images
      .filter(img => img.ratio === '16_9')
      .sort((a, b) => b.width - a.width)[0];
    imageUrl = preferred?.url || event.images[0].url;
  }

  // Format price if available
  let price = 'Unknown';
  if (event.priceRanges?.length) {
    const range = event.priceRanges[0];
    if (range.min === range.max) {
      price = `$${range.min}`;
    } else {
      price = `$${range.min} - $${range.max}`;
    }
  }

  // Build description from available fields
  const description = event.description
    || event.info
    || event.pleaseNote
    || event._embedded?.attractions?.[0]?.description
    || undefined;

  return {
    sourceId: `tm-${event.id}`,
    source: 'HARRAHS',
    title: event.name,
    description,
    startDate,
    location: "Harrah's Cherokee Center Asheville",
    organizer: "Harrah's Cherokee Center Asheville",
    price,
    url: event.url,
    imageUrl,
  };
}

/**
 * Normalize title for comparison - strips venue info and common variations
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove venue suffixes
    .replace(/\s*\|.*harrah.*$/i, '')
    .replace(/\s*-\s*hcca.*$/i, '')
    .replace(/\s*at harrah.*$/i, '')
    // Remove date suffixes
    .replace(/\s*\|\s*(january|february|march|april|may|june|july|august|september|october|november|december).*$/i, '')
    // Normalize punctuation and whitespace
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    // Normalize common abbreviations
    .replace(/\bmbb\b/g, 'mens basketball')
    .replace(/\bwbb\b/g, 'womens basketball')
    .replace(/\bvs\.?\b/g, 'vs')
    .trim();
}

/**
 * Get local date string (YYYY-MM-DD) without timezone conversion
 */
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if two events are duplicates (same date + similar title)
 */
function isDuplicate(event: { title: string; date: string }, existing: Map<string, Set<string>>): boolean {
  const normalizedTitle = normalizeTitle(event.title);
  const titlesOnDate = existing.get(event.date);

  if (!titlesOnDate) return false;

  // Check for similar titles on same date
  for (const existingTitle of titlesOnDate) {
    // Check if one contains the other or they share significant words
    if (normalizedTitle.includes(existingTitle) || existingTitle.includes(normalizedTitle)) {
      return true;
    }

    // Check for shared significant words (more than 2 chars)
    const words1 = normalizedTitle.split(' ').filter(w => w.length > 2);
    const words2 = existingTitle.split(' ').filter(w => w.length > 2);
    const shared = words1.filter(w => words2.includes(w));

    if (shared.length >= 2 || (shared.length >= 1 && shared[0].length > 5)) {
      return true;
    }
  }

  return false;
}

/**
 * Fetch additional events from HTML (not on Ticketmaster)
 */
async function fetchHTMLEvents(tmEvents: ScrapedEvent[]): Promise<ScrapedEvent[]> {
  console.log('[Harrahs-HTML] Checking for additional events...');

  // Build index of existing events by date -> normalized titles
  const existingByDate = new Map<string, Set<string>>();
  for (const event of tmEvents) {
    const dateKey = getLocalDateKey(event.startDate);
    if (!existingByDate.has(dateKey)) {
      existingByDate.set(dateKey, new Set());
    }
    existingByDate.get(dateKey)!.add(normalizeTitle(event.title));
  }

  try {
    const response = await fetchWithRetry(
      EVENTS_PAGE_URL,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
        },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 }
    );
    const html = await response.text();

    // Extract event URLs
    const eventUrlPattern = /href="(https:\/\/www\.harrahscherokeecenterasheville\.com\/events\/[^"]+)"/g;
    const urls = new Set<string>();
    let match;

    while ((match = eventUrlPattern.exec(html)) !== null) {
      if (!match[1].includes('?ical=1') && !match[1].includes('legacy-events')) {
        urls.add(match[1]);
      }
    }

    const newUrls = Array.from(urls);

    if (newUrls.length === 0) {
      console.log('[Harrahs-HTML] No event URLs found');
      return [];
    }

    console.log(`[Harrahs-HTML] Found ${newUrls.length} URLs, checking for non-duplicates...`);

    // Scrape each event and filter duplicates, but collect ALL descriptions
    const events: ScrapedEvent[] = [];
    const allDescriptions: Array<{ date: string; title: string; description: string }> = [];
    let skipped = 0;

    for (const url of newUrls) {
      const event = await scrapeEventPage(url);
      if (event) {
        const dateKey = getLocalDateKey(event.startDate);

        // Always collect description for enrichment
        if (event.description) {
          allDescriptions.push({
            date: dateKey,
            title: normalizeTitle(event.title),
            description: event.description
          });
        }

        if (isDuplicate({ title: event.title, date: dateKey }, existingByDate)) {
          skipped++;
        } else {
          events.push(event);
          // Add to existing to prevent HTML duplicates too
          if (!existingByDate.has(dateKey)) {
            existingByDate.set(dateKey, new Set());
          }
          existingByDate.get(dateKey)!.add(normalizeTitle(event.title));
        }
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // Enrich TM events with HTML descriptions (including from duplicates)
    let enriched = 0;
    for (const tmEvent of tmEvents) {
      if (tmEvent.description) continue;

      const tmDateKey = getLocalDateKey(tmEvent.startDate);
      const tmTitle = normalizeTitle(tmEvent.title);

      for (const { date, title, description } of allDescriptions) {
        if (date !== tmDateKey) continue;

        // Match by title similarity
        if (tmTitle.includes(title) || title.includes(tmTitle)) {
          tmEvent.description = description;
          enriched++;
          break;
        }

        // Check shared significant words
        const words1 = tmTitle.split(' ').filter(w => w.length > 3);
        const words2 = title.split(' ').filter(w => w.length > 3);
        const shared = words1.filter(w => words2.includes(w));
        if (shared.length >= 2) {
          tmEvent.description = description;
          enriched++;
          break;
        }
      }
    }

    if (enriched > 0) {
      console.log(`[Harrahs-HTML] Enriched ${enriched} TM events with HTML descriptions`);
    }

    console.log(`[Harrahs-HTML] Found ${events.length} unique events (${skipped} duplicates skipped)`);
    return events;

  } catch (error) {
    console.error('[Harrahs-HTML] Error:', error);
    return [];
  }
}

/**
 * Scrape a single event page (for non-Ticketmaster events)
 */
async function scrapeEventPage(url: string): Promise<ScrapedEvent | null> {
  try {
    const response = await fetchWithRetry(
      url,
      {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 1000 }
    );
    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
    if (!titleMatch) return null;

    // Decode HTML entities FIRST, then clean venue suffixes
    const title = titleMatch[1]
      .replace(/&#039;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      // Now remove venue/date suffixes (use flexible pattern)
      .replace(/\s*\|.*$/i, '') // Remove everything after first |
      .replace(/\s*-\s*HCCA$/i, '')
      .trim();

    // Extract date from Google Calendar link
    const gcalMatch = html.match(/dates=(\d{8})T/);
    if (!gcalMatch) return null;

    const dateStr = gcalMatch[1];
    const year = parseInt(dateStr.slice(0, 4), 10);
    const month = parseInt(dateStr.slice(4, 6), 10) - 1;
    const day = parseInt(dateStr.slice(6, 8), 10);
    const startDate = new Date(year, month, day, 19, 0, 0);

    // Extract description
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
    const description = descMatch
      ? descMatch[1].replace(/&#039;/g, "'").replace(/&amp;/g, '&')
      : undefined;

    // Extract image
    const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
    const imageUrl = imageMatch ? imageMatch[1] : undefined;

    // Generate sourceId from URL slug
    const slug = url.split('/events/')[1]?.replace(/\/$/, '') || 'unknown';

    return {
      sourceId: `harrahs-${slug}`,
      source: 'HARRAHS',
      title,
      description,
      startDate,
      location: "Harrah's Cherokee Center Asheville",
      organizer: "Harrah's Cherokee Center Asheville",
      price: 'Unknown',
      url,
      imageUrl,
    };
  } catch (error) {
    console.error(`[Harrahs-HTML] Error scraping ${url}:`, error);
    return null;
  }
}

/**
 * Main scraper function - combines Ticketmaster API and HTML scraping
 */
export async function scrapeHarrahs(): Promise<ScrapedEvent[]> {
  console.log('[Harrahs] Starting hybrid scrape...');

  // Primary: Ticketmaster API
  const tmEvents = await fetchTicketmasterEvents();

  // Secondary: HTML scraping for non-TM events + enriches TM events with descriptions
  const htmlEvents = await fetchHTMLEvents(tmEvents);

  // Combine and sort
  const allEvents = [...tmEvents, ...htmlEvents];
  allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  console.log(`[Harrahs] Total: ${allEvents.length} events (${tmEvents.length} from TM, ${htmlEvents.length} from HTML)`);

  return allEvents;
}

// Export for direct use
export { fetchTicketmasterEvents, fetchHTMLEvents };
