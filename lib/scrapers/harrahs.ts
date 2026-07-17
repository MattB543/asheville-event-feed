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

import { type ScrapedEvent } from './types';
import { fetchEventData } from './base';
import { parseAsEastern } from '../utils/timezone';
import {
  fetchTicketmasterEvents as fetchTicketmasterVenueEvents,
  getLocalDateKey,
  type TicketmasterVenueConfig,
} from './ticketmaster';

const HARRAHS_VENUE_ID = 'KovZpZAJvnIA';

// HTML scraping config (fallback)
const EVENTS_PAGE_URL = 'https://www.harrahscherokeecenterasheville.com/events-tickets/';

const TM_CONFIG: TicketmasterVenueConfig = {
  venueId: HARRAHS_VENUE_ID,
  source: 'HARRAHS',
  sourceIdPrefix: 'tm-',
  location: "Harrah's Cherokee Center Asheville, 87 Haywood St, Asheville, NC",
  zip: '28801',
  organizer: "Harrah's Cherokee Center Asheville",
  defaultTime: '19:00:00',
  logLabel: 'Harrahs-TM',
};

/**
 * Fetch events from Ticketmaster Discovery API
 */
async function fetchTicketmasterEvents(): Promise<ScrapedEvent[]> {
  return fetchTicketmasterVenueEvents(TM_CONFIG);
}

/**
 * Normalize title for comparison - strips venue info and common variations
 */
function normalizeTitle(title: string): string {
  return (
    title
      .toLowerCase()
      // Remove venue suffixes
      .replace(/\s*\|.*harrah.*$/i, '')
      .replace(/\s*-\s*hcca.*$/i, '')
      .replace(/\s*at harrah.*$/i, '')
      // Remove date suffixes
      .replace(
        /\s*\|\s*(january|february|march|april|may|june|july|august|september|october|november|december).*$/i,
        ''
      )
      // Normalize punctuation and whitespace
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      // Normalize common abbreviations
      .replace(/\bmbb\b/g, 'mens basketball')
      .replace(/\bwbb\b/g, 'womens basketball')
      .replace(/\bvs\.?\b/g, 'vs')
      .trim()
  );
}

/**
 * Check if two events are duplicates (same date + similar title)
 */
function isDuplicate(
  event: { title: string; date: string },
  existing: Map<string, Set<string>>
): boolean {
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
    const words1 = normalizedTitle.split(' ').filter((w) => w.length > 2);
    const words2 = existingTitle.split(' ').filter((w) => w.length > 2);
    const shared = words1.filter((w) => words2.includes(w));

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
    const response = await fetchEventData(
      EVENTS_PAGE_URL,
      {
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 },
      'Harrahs-HTML'
    );
    const html = await response.text();

    // Extract event URLs
    const eventUrlPattern =
      /href="(https:\/\/www\.harrahscherokeecenterasheville\.com\/events\/[^"]+)"/g;
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
            description: event.description,
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
      await new Promise((r) => setTimeout(r, 300));
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
        const words1 = tmTitle.split(' ').filter((w) => w.length > 3);
        const words2 = title.split(' ').filter((w) => w.length > 3);
        const shared = words1.filter((w) => words2.includes(w));
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

    console.log(
      `[Harrahs-HTML] Found ${events.length} unique events (${skipped} duplicates skipped)`
    );
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
    const response = await fetchEventData(
      url,
      {
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 1000 },
      'Harrahs-HTML'
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
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    // Parse as Eastern time to handle DST correctly
    const startDate = parseAsEastern(`${year}-${month}-${day}`, '19:00:00');

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
      location: "Harrah's Cherokee Center Asheville, 87 Haywood St, Asheville, NC",
      zip: '28801',
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

  console.log(
    `[Harrahs] Total: ${allEvents.length} events (${tmEvents.length} from TM, ${htmlEvents.length} from HTML)`
  );

  return allEvents;
}

// Export for direct use
export { fetchTicketmasterEvents, fetchHTMLEvents };
