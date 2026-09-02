/**
 * Revolve Scraper - HTML Event Cards + per-event JSON-LD
 *
 * Scrapes events from pools.events (formerly withfriends.events).
 * Currently configured for REVOLVE, an Asheville-based arts/community organization.
 *
 * Data Source:
 *   - The org's upcoming page lists events as HTML "ticketCard" elements. Its
 *     only LD+JSON block describes the organization, so the cards are the index.
 *   - Each /event/<id>/<slug>/ page does carry an LD+JSON "Event" block with an
 *     offset-qualified startDate, so we read it per card and prefer it over the
 *     card's display date text. That text is only a display string and the site
 *     renders it differently per tab, so it is the brittlest part of the card.
 *
 * Debug Mode:
 *   Set DEBUG_DIR env var to save raw data and validation reports
 */

import { type ScrapedEvent } from './types';
import { BROWSER_HEADERS, debugSave, fetchEventData } from './base';
import { findJsonLdEvent } from './jsonld';
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

/**
 * The subset of an event page's LD+JSON "Event" block that we use.
 */
interface RevolveEventJsonLd {
  name?: string;
  startDate?: string;
  description?: string;
  image?: string | string[];
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
 * The card only carries a display string, and the site renders two shapes:
 *   "Sat, Jun 6 at 7:00pm"              (upcoming tab: weekday, no year)
 *   "Jun 27, 2026 at 7:00 PM"           (past tab: year, no weekday)
 *   "Sat, Jun 6 at 7:00pm thru Jun 27"  (multi-day pass; we use the start)
 *   "Fri, Jul 4 at 7pm"                 (minutes optional)
 *
 * When no year is printed we infer it: assume the next occurrence. If the parsed
 * month/day has already passed this year (more than a day ago), roll to next year.
 *
 * Returns null if the text can't be parsed.
 */
function parseEventDate(dateText: string): Date | null {
  if (!dateText) return null;

  // Take only the start portion, dropping any "thru ..." range suffix.
  const startText = dateText.split(/\bthru\b/i)[0];

  // Match "<Mon> <Day>[, <Year>] at <H>[:MM] <am|pm>" (weekday prefix is optional/ignored)
  const match = startText.match(
    /([A-Za-z]{3,})\.?\s+(\d{1,2})(?:\s*,\s*(\d{4}))?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i
  );
  if (!match) return null;

  const [, monthName, dayStr, yearStr, hourStr, minStr, meridiem] = match;
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;

  const day = parseInt(dayStr, 10);
  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toLowerCase() === 'p') hour += 12;
  const minute = minStr ? parseInt(minStr, 10) : 0;

  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const buildDateStr = (y: number) =>
    `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  if (yearStr) {
    const parsed = parseAsEastern(buildDateStr(parseInt(yearStr, 10)), timeStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // No printed year: assume the next occurrence relative to "now". Both the
  // current year and the candidate are Eastern, so the roll-forward decision
  // doesn't shift near day boundaries on UTC hosts.
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
 * Fetch a single event page and pull its LD+JSON "Event" block.
 * Returns null when the page is unreachable or carries no Event block.
 */
async function fetchEventDetail(href: string): Promise<RevolveEventJsonLd | null> {
  try {
    const response = await fetchEventData(
      `${BASE_URL}${href}`,
      {
        headers: { Accept: 'text/html' },
        cache: 'no-store',
      },
      { maxRetries: 2, baseDelay: 500 },
      'Revolve'
    );
    const html = await response.text();
    return findJsonLdEvent<RevolveEventJsonLd>(html);
  } catch (error) {
    console.warn(
      `[Revolve] Failed to fetch detail page ${href}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Resolve a card's start time, preferring the detail page's offset-qualified
 * ISO date over the card's display text.
 */
function resolveStartDate(card: RevolveCard, detail?: RevolveEventJsonLd | null): Date | null {
  if (detail?.startDate) {
    const parsed = new Date(detail.startDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return parseEventDate(card.dateText);
}

/**
 * Format a parsed card as a ScrapedEvent (or null to skip).
 */
function formatEvent(card: RevolveCard, detail?: RevolveEventJsonLd | null): ScrapedEvent | null {
  // Filter to only allowed organizers (org name is rendered as "by REVOLVE")
  if (card.organizer && !isAllowedOrganizer(card.organizer)) {
    return null;
  }

  // Parse date
  const startDate = resolveStartDate(card, detail);
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

  // Card images are pre-resized; the LD+JSON one is the full-size original.
  const detailImage = Array.isArray(detail?.image) ? detail.image[0] : detail?.image;

  return {
    sourceId: `revolve-${card.publicId}`,
    source: 'REVOLVE',
    title: decodeHtmlEntities(card.title || detail?.name || ''),
    description: detail?.description ? decodeHtmlEntities(detail.description) : undefined,
    startDate,
    location,
    zip,
    organizer: card.organizer,
    price: formatPrice(card.price),
    url,
    imageUrl: card.imageUrl || detailImage,
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
    // The site server-renders an explicit marker when an org has nothing listed.
    // That is a normal state; a missing marker means the selector broke.
    if (html.includes('wf-empty-pool-state')) {
      console.log('[Revolve] Pool is empty - no events listed on this page');
    } else {
      console.error(
        '[Revolve] STRUCTURAL FAILURE: no ticketCard elements and no empty-pool marker - the page markup likely changed'
      );
    }
    return [];
  }

  const cards: RevolveCard[] = [];
  for (const chunk of chunks) {
    const card = parseCard(chunk);
    if (card) cards.push(card);
  }

  if (cards.length === 0) {
    console.error(
      `[Revolve] STRUCTURAL FAILURE: found ${chunks.length} ticketCard elements but parsed none of them - the card markup likely changed`
    );
    return [];
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

    // Pull each event's LD+JSON for an exact start time and a description.
    const details: (RevolveEventJsonLd | null)[] = [];
    for (const rawEvent of rawEvents) {
      details.push(await fetchEventDetail(rawEvent.href));
      await new Promise((r) => setTimeout(r, 150));
    }

    if (rawEvents.length > 0) {
      const dated = rawEvents.filter((card, i) => resolveStartDate(card, details[i])).length;
      console.log(
        `[Revolve] Read JSON-LD from ${details.filter(Boolean).length}/${rawEvents.length} detail pages`
      );
      if (dated === 0) {
        console.error(
          `[Revolve] STRUCTURAL FAILURE: parsed ${rawEvents.length} cards but could not read a start date from any of them - the date format likely changed (sample: "${rawEvents[0].dateText}")`
        );
      }
    }

    // Format events
    const events: ScrapedEvent[] = [];
    let skipped = 0;

    for (let i = 0; i < rawEvents.length; i++) {
      const formatted = formatEvent(rawEvents[i], details[i]);
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
