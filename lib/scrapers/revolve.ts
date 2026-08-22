/**
 * Revolve Scraper - HTML Event Cards
 *
 * Scrapes events from pools.events (formerly withfriends.events).
 * Currently configured for REVOLVE, an Asheville-based arts/community organization.
 *
 * Data Source:
 *   - Events rendered as HTML "ticketCard" elements on the org's upcoming page
 *   - No API endpoint or machine-readable event JSON available (the only LD+JSON
 *     block describes the organization, not its events)
 *
 * Debug Mode:
 *   Set DEBUG_DIR env var to save raw data and validation reports
 */

import { type ScrapedEvent } from './types';
import { BROWSER_HEADERS, debugSave, fetchEventData } from './base';
import { decodeHtmlEntities } from '../utils/parsers';
import { getZipFromCity } from '../utils/geo';
import { parseAsEastern, getTodayStringEastern } from '../utils/timezone';

// Config
const EVENTS_URL = 'https://pools.events/o/revolve/upcoming/';
const BASE_URL = 'https://pools.events';

// Filter to only include events from these organizers (case-insensitive match)
const ALLOWED_ORGANIZERS = ['REVOLVE'];

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    'VALIDATION REPORT - Revolve',
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
  const withImages = events.filter((e) => e.imageUrl).length;
  const withPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
  const withLocations = events.filter((e) => e.location).length;

  const pct = (n: number) => (total === 0 ? '0' : Math.round((n / total) * 100).toString());

  lines.push(`  Images:    ${withImages}/${total} (${pct(withImages)}%)`);
  lines.push(`  Prices:    ${withPrices}/${total} (${pct(withPrices)}%)`);
  lines.push(`  Locations: ${withLocations}/${total} (${pct(withLocations)}%)`);

  // Sample events
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('SAMPLE EVENTS (first 5)');
  lines.push('='.repeat(60));

  for (const event of events.slice(0, 5)) {
    lines.push('');
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC):     ${event.startDate.toISOString()}`);
    lines.push(
      `  Date (Eastern): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
    lines.push(`  Location:  ${event.location || 'N/A'}`);
    lines.push(`  Price:     ${event.price || 'N/A'}`);
    lines.push(`  URL:       ${event.url}`);
  }

  return lines.join('\n');
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A raw event parsed out of a single HTML "ticketCard" element.
 */
interface RevolveCard {
  publicId: string;
  title: string;
  href: string; // e.g. "/event/Mx8X29ZZ/the-language-of-landscapes.../"
  dateText: string; // human format, e.g. "Sat, Jun 6 at 7:00pm"
  organizer?: string;
  location?: string;
  price?: string;
  imageUrl?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Parse the human-readable event date text into a Date (treated as Eastern time).
 *
 * The site no longer provides a machine ISO datetime, only display strings like:
 *   "Sat, Jun 6 at 7:00pm"
 *   "Thu, Jun 11 at 7:00pm"
 *   "Sat, Jun 6 at 7:00pm thru Jun 27"  (multi-day pass; we use the start)
 *   "Sun, Jun 7 at 12:00pm"
 *   "Fri, Jul 4 at 7pm"                 (minutes optional)
 *
 * There is no year, so we infer it: assume the next occurrence. If the parsed
 * month/day has already passed this year (more than a day ago), roll to next year.
 *
 * Returns null if the text can't be parsed.
 */
function parseEventDate(dateText: string): Date | null {
  if (!dateText) return null;

  // Take only the start portion, dropping any "thru ..." range suffix.
  const startText = dateText.split(/\bthru\b/i)[0];

  // Match "<Mon> <Day> at <H>[:MM]<am|pm>"  (weekday prefix is optional/ignored)
  const match = startText.match(
    /([A-Za-z]{3,})\.?\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i
  );
  if (!match) return null;

  const [, monthName, dayStr, hourStr, minStr, meridiem] = match;
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;

  const day = parseInt(dayStr, 10);
  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toLowerCase() === 'p') hour += 12;
  const minute = minStr ? parseInt(minStr, 10) : 0;

  // Infer the year: assume the next occurrence relative to "now". Both the
  // current year and the candidate are Eastern, so the roll-forward decision
  // doesn't shift near day boundaries on UTC hosts.
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const buildDateStr = (y: number) =>
    `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  let year = parseInt(getTodayStringEastern().slice(0, 4), 10);
  const oneDayMs = 24 * 60 * 60 * 1000;
  let parsed = parseAsEastern(buildDateStr(year), timeStr);

  // If it's well in the past, roll forward a year.
  if (parsed.getTime() < Date.now() - oneDayMs) {
    year += 1;
    parsed = parseAsEastern(buildDateStr(year), timeStr);
  }

  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Format price from the card
 * Input: "$17.18" or "Free" or undefined
 */
function formatPrice(price?: string): string {
  if (!price) return 'Unknown';

  const trimmed = price.trim();
  if (!trimmed) return 'Unknown';

  // Already formatted like "$17.18" or "Free"
  if (trimmed.toLowerCase() === 'free' || trimmed === '$0' || trimmed === '$0.00') {
    return 'Free';
  }

  // Round to nearest dollar if it has cents
  const match = trimmed.match(/\$(\d+)\.(\d+)/);
  if (match) {
    const dollars = parseInt(match[1], 10);
    const cents = parseInt(match[2], 10);
    const rounded = cents >= 50 ? dollars + 1 : dollars;
    return rounded === 0 ? 'Free' : `$${rounded}`;
  }

  // Just return as-is if it's already in a good format
  if (trimmed.startsWith('$')) {
    return trimmed;
  }

  return 'Unknown';
}

/**
 * Check if organizer is in the allowed list
 */
function isAllowedOrganizer(organizer: string): boolean {
  const orgLower = organizer.toLowerCase();
  return ALLOWED_ORGANIZERS.some((allowed) => orgLower.includes(allowed.toLowerCase()));
}

/**
 * Strip HTML tags and collapse whitespace from a snippet.
 */
function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Format a parsed card as a ScrapedEvent (or null to skip).
 */
function formatEvent(card: RevolveCard): ScrapedEvent | null {
  // Filter to only allowed organizers (org name is rendered as "by REVOLVE")
  if (card.organizer && !isAllowedOrganizer(card.organizer)) {
    return null;
  }

  // Parse date
  const startDate = parseEventDate(card.dateText);
  if (!startDate) {
    console.warn(
      `[Revolve] Could not parse date "${card.dateText}" for: ${card.title || card.publicId}`
    );
    return null;
  }

  // Skip past events
  if (startDate < new Date()) {
    return null;
  }

  // Build absolute event URL
  const url = `${BASE_URL}${card.href}`;

  // Location is org-level only (e.g. "Asheville, North Carolina")
  const location = card.location || undefined;
  const city = location ? location.split(',')[0].trim() : undefined;
  const zip = getZipFromCity(city);

  return {
    sourceId: `revolve-${card.publicId}`,
    source: 'REVOLVE',
    title: decodeHtmlEntities(card.title),
    startDate,
    location,
    zip,
    organizer: card.organizer,
    price: formatPrice(card.price),
    url,
    imageUrl: card.imageUrl,
  };
}

// ============================================================================
// HTML PARSING
// ============================================================================

/**
 * Split the page into individual ticketCard chunks.
 * Each chunk starts at a `<div class="...ticketCard...">` and runs until the
 * next ticketCard (or end of document).
 */
function splitCards(html: string): string[] {
  const markerRe = /<div[^>]*\bclass="[^"]*\bticketCard\b[^"]*"[^>]*>/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(html)) !== null) {
    starts.push(m.index);
  }

  const chunks: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    chunks.push(html.slice(start, end));
  }
  return chunks;
}

/**
 * Parse a single ticketCard chunk into a RevolveCard.
 */
function parseCard(chunk: string): RevolveCard | null {
  // Public ID: prefer the data attribute, fall back to the /event/<id>/ href.
  let publicId: string | undefined;
  const idAttr = chunk.match(/data-event-public-id="([^"]+)"/);
  if (idAttr) publicId = idAttr[1];

  // Anchor to the event (also the source of the slug/href).
  const hrefMatch = chunk.match(/href="(\/event\/([A-Za-z0-9]+)\/[^"]*)"/);
  const href = hrefMatch ? hrefMatch[1] : undefined;
  if (!publicId && hrefMatch) publicId = hrefMatch[2];

  if (!publicId || !href) return null;

  // Title
  const titleMatch = chunk.match(/<div class="eventTitleMobile">([\s\S]*?)<\/div>/);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  if (!title) return null;

  // Date (human text inside imageTextUpperLeft)
  const dateMatch = chunk.match(/imageTextUpperLeft"[\s\S]*?<div>([\s\S]*?)<\/div>/);
  const dateText = dateMatch ? stripTags(dateMatch[1]) : '';

  // Organizer ("by REVOLVE")
  const orgMatch = chunk.match(/<div>\s*by\s+([\s\S]*?)<\/div>/i);
  const organizer = orgMatch ? stripTags(orgMatch[1]) : undefined;

  // Location (google maps link text, e.g. "Asheville, North Carolina")
  const locMatch = chunk.match(/event-googlemaps"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
  const location = locMatch ? stripTags(locMatch[1]) : undefined;

  // Price (a bare "$..." or "Free" div in the card)
  const priceMatch = chunk.match(/<div>\s*(\$[\d.,]+|Free)\s*<\/div>/i);
  const price = priceMatch ? priceMatch[1].trim() : undefined;

  // Image
  const imgMatch = chunk.match(/<img[^>]*class="upperCardImage"[^>]*src="([^"]+)"/);
  const imageUrl = imgMatch ? decodeHtmlEntities(imgMatch[1]) : undefined;

  return { publicId, title, href, dateText, organizer, location, price, imageUrl };
}

/**
 * Extract events from the rendered HTML cards.
 */
function extractEventsFromHtml(html: string): RevolveCard[] {
  const chunks = splitCards(html);
  if (chunks.length === 0) {
    console.warn('[Revolve] No ticketCard elements found in HTML');
    return [];
  }

  const cards: RevolveCard[] = [];
  for (const chunk of chunks) {
    const card = parseCard(chunk);
    if (card) cards.push(card);
  }

  console.log(`[Revolve] Parsed ${cards.length} cards from ${chunks.length} ticketCard elements`);
  return cards;
}

// ============================================================================
// MAIN SCRAPER FUNCTION
// ============================================================================

/**
 * Scrape events from Revolve
 */
export async function scrapeRevolve(): Promise<ScrapedEvent[]> {
  console.log('[Revolve] Starting scrape...');

  try {
    // Fetch the events page
    const response = await fetchEventData(
      EVENTS_URL,
      {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 },
      'Revolve'
    );

    const html = await response.text();
    await debugSave('01-raw-html.html', html);

    // Extract events from HTML
    const rawEvents = extractEventsFromHtml(html);
    console.log(`[Revolve] Extracted ${rawEvents.length} raw events`);

    await debugSave('02-raw-events.json', rawEvents);

    // Format events
    const events: ScrapedEvent[] = [];
    let skipped = 0;

    for (const rawEvent of rawEvents) {
      const formatted = formatEvent(rawEvent);
      if (formatted) {
        events.push(formatted);
      } else {
        skipped++;
      }
    }

    // Sort by date
    events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    await debugSave('03-formatted-events.json', events);

    // Generate validation report
    const report = generateValidationReport(events);
    await debugSave('04-validation-report.txt', report);

    console.log(`[Revolve] Returning ${events.length} events (${skipped} skipped)`);

    return events;
  } catch (error) {
    console.error('[Revolve] Scrape failed:', error);
    return [];
  }
}

// Export for testing
export { formatEvent, formatPrice, parseEventDate, extractEventsFromHtml };
