import { type ScrapedEvent } from './types';
import { BROWSER_HEADERS, debugSave, fetchEventData } from './base';
import { decodeHtmlEntities, stripHtml } from '@/lib/utils/parsers';
import { parseAsEastern } from '@/lib/utils/timezone';
import { getZipFromCity } from '@/lib/utils/geo';

const API_BASE = 'https://ashevilletheateralliance.org/wp-json/wp/v2/events';
const PER_PAGE = 100;
const MAX_PAGES = 5;
const DELAY_MS = 300;

// Elementor template data-id values (consistent across all event pages)
const SELECTORS = {
  dates: 'data-id="d72f4d3"', // jet-listing-dynamic-repeater
  price: 'data-id="6a9e35b"', // Standard Ticket Price
  venue: 'data-id="c1c2bd7"', // Venue name
  address: 'data-id="34925e9"', // Venue address
  ticketLink: 'data-id="df390a2"', // Tickets/RSVP link
  producedBy: 'data-id="8caa929"', // Produced By
};

interface WPEmbedded {
  author?: Array<{ name?: string }>;
  'wp:featuredmedia'?: Array<{ source_url?: string }>;
}

interface WPEvent {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  slug: string;
  link: string;
  author: number;
  _embedded?: WPEmbedded;
}

interface ParsedPageData {
  dates: Date[];
  price: string;
  venue: string | undefined;
  address: string | undefined;
  ticketUrl: string | undefined;
  producedBy: string | undefined;
}

/**
 * Parse date strings like "Thu - Apr 2, 2026 7:30 pm"
 * Returns a Date in UTC (converted from Eastern)
 */
function parsePerformanceDate(dateStr: string): Date | null {
  // Format: "Day - Mon DD, YYYY H:MM am/pm"
  const match = dateStr.match(/\w+\s*-\s*(\w+)\s+(\d+),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return null;

  const [, monthName, day, year, hourStr, minute, ampm] = match;

  const months: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };

  const monthNum = months[monthName];
  if (!monthNum) return null;

  let hours = parseInt(hourStr, 10);
  if (ampm.toLowerCase() === 'pm' && hours !== 12) hours += 12;
  if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;

  const dateOnly = `${year}-${monthNum}-${day.padStart(2, '0')}`;
  const timeOnly = `${String(hours).padStart(2, '0')}:${minute}:00`;

  return parseAsEastern(dateOnly, timeOnly);
}

/**
 * Extract content from a JetEngine dynamic field by its Elementor data-id.
 * Looks for the pattern: data-id="XXX" ... jet-listing-dynamic-field__content">TEXT</div>
 */
function extractFieldByDataId(html: string, dataId: string): string | undefined {
  // Find the section with this data-id
  const escapedId = dataId.replace(/"/g, '\\"');
  const regex = new RegExp(
    `${escapedId}[\\s\\S]*?jet-listing-dynamic-field__content">([^<]+)</div>`,
    'i'
  );
  const match = html.match(regex);
  return match ? match[1].trim() : undefined;
}

/**
 * Extract link href from a JetEngine dynamic link by its Elementor data-id.
 */
function extractLinkByDataId(html: string, dataId: string): string | undefined {
  const escapedId = dataId.replace(/"/g, '\\"');
  const regex = new RegExp(`${escapedId}[\\s\\S]*?<a\\s+href="([^"]+)"`, 'i');
  const match = html.match(regex);
  return match ? match[1].trim() : undefined;
}

/**
 * Parse an individual event page HTML to extract JetEngine fields.
 */
function parseEventPage(html: string): ParsedPageData {
  // Extract performance dates from repeater
  const dates: Date[] = [];
  const datesSection = html.match(
    /data-id="d72f4d3"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/i
  );
  if (datesSection) {
    const dateRegex = /jet-listing-dynamic-repeater__item[^>]*>\s*<span>([^<]+)<\/span>/gi;
    let dateMatch;
    while ((dateMatch = dateRegex.exec(datesSection[0])) !== null) {
      const parsed = parsePerformanceDate(dateMatch[1].trim());
      if (parsed && !isNaN(parsed.getTime())) {
        dates.push(parsed);
      }
    }
  }

  // Extract price
  let price = 'Unknown';
  const priceText = extractFieldByDataId(html, SELECTORS.price);
  if (priceText) {
    // Handle formats like "Standard Ticket Price: $ 30" or "Standard Ticket Price: $ $25"
    const priceMatch = priceText.match(/\$?\s*\$?\s*(\d+)/);
    if (priceMatch) {
      price = priceMatch[1] === '0' ? 'Free' : `$${priceMatch[1]}`;
    }
  }

  // Extract venue
  let venue: string | undefined;
  const venueText = extractFieldByDataId(html, SELECTORS.venue);
  if (venueText) {
    // Double-decode to handle double-encoded entities like &amp;amp;
    venue = decodeHtmlEntities(decodeHtmlEntities(venueText.replace(/^Venue:\s*/i, '').trim()));
  }

  // Extract address
  let address: string | undefined;
  const addressText = extractFieldByDataId(html, SELECTORS.address);
  if (addressText) {
    address = decodeHtmlEntities(decodeHtmlEntities(addressText.trim()));
  }

  // Extract ticket URL
  const ticketUrl = extractLinkByDataId(html, SELECTORS.ticketLink);

  // Extract produced by
  let producedBy: string | undefined;
  const producedByText = extractFieldByDataId(html, SELECTORS.producedBy);
  if (producedByText) {
    producedBy = producedByText.replace(/^Produced By:\s*/i, '').trim();
  }

  return { dates, price, venue, address, ticketUrl, producedBy };
}

/**
 * Build a location string from venue name and address.
 */
function buildLocation(venue: string | undefined, address: string | undefined): string | undefined {
  if (!venue && !address) return undefined;
  if (venue && address) return `${venue}, ${address}`;
  return venue || address;
}

/**
 * Extract zip code from an address string like "20 Commerce Street Asheville, NC 28801"
 */
function extractZipFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : undefined;
}

/**
 * Extract city from an address string like "20 Commerce Street Asheville, NC 28801"
 */
function extractCityFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  // Try pattern "City, NC" or "City, North Carolina"
  const match = address.match(/(\w[\w\s]*?),\s*(?:NC|North Carolina)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Scrape events from Asheville Theater Alliance performance calendar.
 *
 * Strategy: Hybrid approach
 * 1. WP REST API for event metadata (title, description, image, author/producer)
 * 2. Individual event page HTML for JetEngine fields (dates, venue, price, ticket URL)
 * 3. One ScrapedEvent per performance date
 */
export async function scrapeTheaterAlliance(): Promise<ScrapedEvent[]> {
  console.log('[TheaterAlliance] Starting scrape...');

  const allEvents: ScrapedEvent[] = [];
  const now = new Date();

  try {
    // Step 1: Fetch all events from WP REST API
    const wpEvents: WPEvent[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES) {
      const url = `${API_BASE}?per_page=${PER_PAGE}&page=${page}&_embed`;
      console.log(`[TheaterAlliance] Fetching API page ${page}...`);

      try {
        const response = await fetchEventData(
          url,
          {
            headers: {
              ...BROWSER_HEADERS,
              Accept: 'application/json',
            },
          },
          { maxRetries: 3, baseDelay: 1000 },
          'TheaterAlliance'
        );

        const data = (await response.json()) as WPEvent[];
        console.log(`[TheaterAlliance] API page ${page}: ${data.length} events`);
        wpEvents.push(...data);

        // WP REST API returns fewer than per_page when on last page
        hasMore = data.length === PER_PAGE;
        page++;

        if (hasMore) await new Promise((r) => setTimeout(r, DELAY_MS));
      } catch (error) {
        console.error(`[TheaterAlliance] API page ${page} failed:`, error);
        break;
      }
    }

    console.log(`[TheaterAlliance] Total events from API: ${wpEvents.length}`);
    await debugSave('01-wp-events.json', wpEvents, { label: 'TheaterAlliance' });

    // Step 2: For each event, fetch the individual page and parse JetEngine fields
    let eventIndex = 0;
    for (const wpEvent of wpEvents) {
      eventIndex++;
      const title = decodeHtmlEntities(wpEvent.title.rendered);
      const eventUrl = wpEvent.link;

      console.log(`[TheaterAlliance] (${eventIndex}/${wpEvents.length}) Fetching page: ${title}`);

      await new Promise((r) => setTimeout(r, DELAY_MS));

      try {
        const pageResponse = await fetchEventData(
          eventUrl,
          { headers: BROWSER_HEADERS },
          { maxRetries: 2, baseDelay: 1000 },
          'TheaterAlliance'
        );

        const pageHtml = await pageResponse.text();
        const pageData = parseEventPage(pageHtml);

        // Get metadata from API response
        const description = wpEvent.content?.rendered
          ? stripHtml(wpEvent.content.rendered)
          : undefined;

        const imageUrl = wpEvent._embedded?.['wp:featuredmedia']?.[0]?.source_url || undefined;

        // Producer: prefer page-parsed value, fallback to API author name
        const organizer = pageData.producedBy || wpEvent._embedded?.author?.[0]?.name || undefined;

        // Build location
        const location = buildLocation(pageData.venue, pageData.address);

        // Zip code: try address first, then city lookup
        let zip = extractZipFromAddress(pageData.address);
        if (!zip) {
          const city = extractCityFromAddress(pageData.address);
          zip = getZipFromCity(city) || undefined;
        }

        // If no dates found on the page, skip this event
        if (pageData.dates.length === 0) {
          console.log(`[TheaterAlliance] No dates found for: ${title}, skipping`);
          continue;
        }

        // Create one ScrapedEvent per future performance date
        for (const perfDate of pageData.dates) {
          if (perfDate < now) continue;

          const scrapedEvent: ScrapedEvent = {
            sourceId: `ta-${wpEvent.id}-${perfDate.getTime()}`,
            source: 'THEATER_ALLIANCE',
            title,
            description: description || undefined,
            startDate: perfDate,
            location,
            zip,
            organizer,
            price: pageData.price,
            url: `${eventUrl}#${perfDate.toISOString()}`,
            imageUrl,
          };

          allEvents.push(scrapedEvent);
        }

        console.log(
          `[TheaterAlliance] ${title}: ${pageData.dates.filter((d) => d >= now).length} future performances`
        );
      } catch (error) {
        console.error(`[TheaterAlliance] Failed to fetch page for: ${title}`, error);
      }
    }

    console.log(`[TheaterAlliance] Total scraped events: ${allEvents.length}`);
    await debugSave('02-final-events.json', allEvents, { label: 'TheaterAlliance' });

    return allEvents;
  } catch (error) {
    console.error('[TheaterAlliance] Scrape failed:', error);
    return [];
  }
}
