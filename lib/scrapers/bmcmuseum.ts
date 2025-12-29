/**
 * Black Mountain College Museum + Arts Center Scraper
 *
 * Scrapes events from BMCM+AC website using WordPress REST API.
 * Events are WordPress posts in category 44 (upcoming events).
 *
 * Venue: Black Mountain College Museum + Arts Center
 *        120 College Street, Asheville, NC 28801
 *
 * Data Sources:
 *   - WordPress REST API: /wp-json/wp/v2/posts?categories=44
 *   - Event dates/times: Extracted from post excerpt
 *   - Prices: Extracted from post content HTML
 *   - Images: Fetched via media API using featured_media ID
 *
 * Note: Site requires browser-like headers to avoid 403 errors.
 */

import { ScrapedEvent } from './types';
import { BROWSER_HEADERS, fetchEventData } from './base';
import { decodeHtmlEntities } from '../utils/parsers';
import { parseAsEastern } from '../utils/timezone';

// Config
const API_BASE = 'https://www.blackmountaincollege.org/wp-json/wp/v2';
const EVENTS_CATEGORY = 44;
const PER_PAGE = 50;

// Static venue info
const VENUE_NAME = 'Black Mountain College Museum + Arts Center';
const VENUE_ADDRESS = 'Black Mountain College Museum + Arts Center, 120 College Street, Asheville, NC';
const VENUE_ZIP = '28801';

// Lake Eden Tours location (different from main museum)
const LAKE_EDEN_ADDRESS = 'Lake Eden, Black Mountain, NC';
const LAKE_EDEN_ZIP = '28711';

// Required headers to avoid 403 errors
const API_HEADERS = {
  ...BROWSER_HEADERS,
  Accept: 'application/json',
};

// Rate limiting
const REQUEST_DELAY_MS = 200;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface WPPost {
  id: number;
  date: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  featured_media: number;
}

interface WPMedia {
  id: number;
  source_url: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse event date and time from excerpt or content
 * Handles formats like:
 *   - "January 10, 2025 at 7PM"
 *   - "Saturday, January 10, 2025 at 7PM"
 *   - "Friday, Sept. 12, 2025, 10am-12pm"
 */
function parseEventDate(excerpt: string, content: string): Date | null {
  // Clean HTML and decode entities
  const cleanExcerpt = decodeHtmlEntities(excerpt);
  const cleanContent = decodeHtmlEntities(content);

  // Try to find date patterns in excerpt first, then content
  const textSources = [cleanExcerpt, cleanContent];

  for (const text of textSources) {
    // Pattern: "Month DD, YYYY at H:MMPM" or "Month DD, YYYY at HPM"
    const dateTimeMatch = text.match(
      /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?[,\s]*(\w+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+at\s+|\s*,\s*)(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/i
    );

    if (dateTimeMatch) {
      const [, monthStr, dayStr, yearStr, hourStr, minuteStr, ampm] = dateTimeMatch;

      // Convert month name to number
      const monthMap: Record<string, number> = {
        'january': 0, 'jan': 0,
        'february': 1, 'feb': 1,
        'march': 2, 'mar': 2,
        'april': 3, 'apr': 3,
        'may': 4,
        'june': 5, 'jun': 5,
        'july': 6, 'jul': 6,
        'august': 7, 'aug': 7,
        'september': 8, 'sept': 8, 'sep': 8,
        'october': 9, 'oct': 9,
        'november': 10, 'nov': 10,
        'december': 11, 'dec': 11,
      };

      const month = monthMap[monthStr.toLowerCase()];
      if (month === undefined) continue;

      const day = parseInt(dayStr, 10);
      const year = parseInt(yearStr, 10);
      let hour = parseInt(hourStr, 10);
      const minute = minuteStr ? parseInt(minuteStr, 10) : 0;

      // Handle 12-hour format
      const period = ampm?.toUpperCase() || 'PM'; // Default to PM for evening events
      if (period === 'PM' && hour !== 12) {
        hour += 12;
      } else if (period === 'AM' && hour === 12) {
        hour = 0;
      }

      // Build date string and parse as Eastern
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

      return parseAsEastern(dateStr, timeStr);
    }
  }

  return null;
}

/**
 * Extract price from content HTML
 * Handles formats like:
 *   - "TICKETS – $12 General Admission"
 *   - "$15 General Admission / $12 for members"
 *   - "FREE"
 */
function extractPrice(content: string): string {
  const cleanContent = decodeHtmlEntities(content).toLowerCase();

  // Check for free
  if (/\bfree\b/.test(cleanContent) && !/free\s*parking/i.test(cleanContent)) {
    return 'Free';
  }

  // Look for price patterns
  const pricePatterns = [
    // "TICKETS – $12" or "Tickets: $12"
    /tickets?\s*[–—:-]\s*\$(\d+)/i,
    // "$12 General Admission"
    /\$(\d+)\s*(?:general|admission|per\s*person)/i,
    // "General: $12" or "Admission: $12"
    /(?:general|admission|tickets?)[:\s]*\$(\d+)/i,
    // Just "$XX" in TICKETS context
    /tickets?[^$]*\$(\d+)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = content.match(pattern);
    if (match) {
      return `$${match[1]}`;
    }
  }

  // Look for price range
  const rangeMatch = content.match(/\$(\d+)\s*[-–—]\s*\$(\d+)/);
  if (rangeMatch) {
    return `$${rangeMatch[1]} - $${rangeMatch[2]}`;
  }

  return 'Unknown';
}

/**
 * Parse Lake Eden tour dates from content
 * Returns array of dates for recurring tour events
 */
function parseLakeEdenTourDates(content: string): Date[] {
  const dates: Date[] = [];
  const cleanContent = decodeHtmlEntities(content);

  // Match patterns like "Friday, Sept. 12, 2025, 10am-12pm" or "Friday, Feb. 27, 2026, 10am-12pm"
  const datePattern = /Friday,?\s+(\w+)\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi;

  let match;
  while ((match = datePattern.exec(cleanContent)) !== null) {
    const [, monthStr, dayStr, yearStr, hourStr, minuteStr, ampm] = match;

    const monthMap: Record<string, number> = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'sept': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11,
    };

    const month = monthMap[monthStr.toLowerCase()];
    if (month === undefined) continue;

    const day = parseInt(dayStr, 10);
    const year = parseInt(yearStr, 10);
    let hour = parseInt(hourStr, 10);
    const minute = minuteStr ? parseInt(minuteStr, 10) : 0;

    // Handle AM/PM
    if (ampm.toLowerCase() === 'pm' && hour !== 12) {
      hour += 12;
    } else if (ampm.toLowerCase() === 'am' && hour === 12) {
      hour = 0;
    }

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

    dates.push(parseAsEastern(dateStr, timeStr));
  }

  return dates;
}

/**
 * Extract clean description from content
 */
function extractDescription(excerpt: string, content: string): string | undefined {
  // Try excerpt first (usually cleaner)
  const cleanExcerpt = decodeHtmlEntities(excerpt).trim();

  // Remove date/location suffix like "January 10, 2025 at 7PM | BMCM+AC"
  const withoutDateLoc = cleanExcerpt.replace(/[A-Za-z]+\s+\d{1,2},?\s+\d{4}[^|]*\|[^|]+$/i, '').trim();

  if (withoutDateLoc && withoutDateLoc.length > 20) {
    return withoutDateLoc;
  }

  // Try first paragraph from content
  const firstPara = content.match(/<p[^>]*>([^<]+)<\/p>/i);
  if (firstPara && firstPara[1]) {
    const cleaned = decodeHtmlEntities(firstPara[1]).trim();
    if (cleaned.length > 20 && !cleaned.includes('Back to EVENTS')) {
      return cleaned.slice(0, 500);
    }
  }

  return undefined;
}

/**
 * Fetch featured image URL from media API
 */
async function fetchFeaturedImage(mediaId: number): Promise<string | undefined> {
  if (!mediaId) return undefined;

  try {
    const response = await fetchEventData(
      `${API_BASE}/media/${mediaId}?_fields=source_url`,
      {
        headers: API_HEADERS,
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 500 },
      'BMCMuseum'
    );

    const media: WPMedia = await response.json();
    return media.source_url;
  } catch {
    // Image fetch is optional, don't fail the event
    return undefined;
  }
}

// ============================================================================
// MAIN SCRAPER FUNCTION
// ============================================================================

/**
 * Scrape events from Black Mountain College Museum + Arts Center
 */
export async function scrapeBMCMuseum(): Promise<ScrapedEvent[]> {
  console.log('[BMCMuseum] Starting scrape...');

  const events: ScrapedEvent[] = [];

  try {
    // Fetch posts from category 44 (upcoming events)
    const url = new URL(`${API_BASE}/posts`);
    url.searchParams.set('categories', EVENTS_CATEGORY.toString());
    url.searchParams.set('per_page', PER_PAGE.toString());
    url.searchParams.set('_fields', 'id,link,title,content,excerpt,featured_media');

    console.log('[BMCMuseum] Fetching events...');

    const response = await fetchEventData(
      url.toString(),
      {
        headers: API_HEADERS,
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 },
      'BMCMuseum'
    );

    const posts: WPPost[] = await response.json();
    console.log(`[BMCMuseum] Found ${posts.length} posts`);

    // Process each post
    const now = new Date();
    let skippedPast = 0;
    let skippedNoDate = 0;

    for (const post of posts) {
      const title = decodeHtmlEntities(post.title.rendered);

      // Special handling for Lake Eden Tours (recurring event with multiple dates)
      if (post.link.includes('lake-eden-tours')) {
        const tourDates = parseLakeEdenTourDates(post.content.rendered);
        const futureDates = tourDates.filter(d => d > now);

        if (futureDates.length > 0) {
          console.log(`[BMCMuseum] Lake Eden Tours: found ${futureDates.length} future dates`);

          // Fetch image once for all tour dates
          let imageUrl: string | undefined;
          if (post.featured_media) {
            await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
            imageUrl = await fetchFeaturedImage(post.featured_media);
          }

          // Create an event for each future tour date
          for (const tourDate of futureDates) {
            const dateStr = tourDate.toISOString().split('T')[0]; // YYYY-MM-DD for unique ID
            events.push({
              sourceId: `bmc-${post.id}-${dateStr}`,
              source: 'BMC_MUSEUM',
              title,
              description: 'Two-hour walking tour of the historic Black Mountain College campus at Lake Eden, covering the Dining Hall, Lodges, Quiet House, Studies Building, and Jean Charlot frescos.',
              startDate: tourDate,
              location: LAKE_EDEN_ADDRESS,
              zip: LAKE_EDEN_ZIP,
              organizer: VENUE_NAME,
              price: 'Ticketed',
              url: post.link,
              imageUrl,
            });
          }
        } else {
          skippedPast += tourDates.length;
        }
        continue;
      }

      // Regular event handling
      const startDate = parseEventDate(post.excerpt.rendered, post.content.rendered);

      if (!startDate) {
        console.log(`[BMCMuseum] No date found for: ${title.slice(0, 40)}`);
        skippedNoDate++;
        continue;
      }

      // Skip past events
      if (startDate < now) {
        skippedPast++;
        continue;
      }

      // Extract other fields
      const description = extractDescription(post.excerpt.rendered, post.content.rendered);
      const price = extractPrice(post.content.rendered);

      // Fetch featured image (with delay)
      let imageUrl: string | undefined;
      if (post.featured_media) {
        await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
        imageUrl = await fetchFeaturedImage(post.featured_media);
      }

      events.push({
        sourceId: `bmc-${post.id}`,
        source: 'BMC_MUSEUM',
        title,
        description,
        startDate,
        location: VENUE_ADDRESS,
        zip: VENUE_ZIP,
        organizer: VENUE_NAME,
        price,
        url: post.link,
        imageUrl,
      });
    }

    // Sort by date
    events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    console.log(`[BMCMuseum] Complete. Found ${events.length} future events (skipped: ${skippedPast} past, ${skippedNoDate} no date)`);
  } catch (error) {
    console.error('[BMCMuseum] Error:', error);
  }

  return events;
}
