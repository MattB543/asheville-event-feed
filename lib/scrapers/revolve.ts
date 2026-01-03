/**
 * Revolve Scraper - Embedded JSON Data
 *
 * Scrapes events from withfriends.events platform.
 * Currently configured for REVOLVE, an Asheville-based arts/community organization.
 *
 * Data Source:
 *   - Events embedded as JSON array in HTML page
 *   - No API endpoint available
 *
 * Debug Mode:
 *   Set DEBUG_DIR env var to save raw data and validation reports
 */

import { type ScrapedEvent } from './types';
import { BROWSER_HEADERS, debugSave, fetchEventData } from './base';
import { decodeHtmlEntities } from '../utils/parsers';
import { getZipFromCity } from '../utils/geo';
import { parseAsEastern } from '../utils/timezone';
import { isRecord, isString } from '../utils/validation';

// Config
const EVENTS_URL = 'https://withfriends.events/o/revolve/upcoming/';
const BASE_URL = 'https://withfriends.events';

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

interface WithFriendsEvent {
  unique_code_public: string;
  event_name: string;
  event_datetime: string; // "2026-01-04 18:30:00+00:00"
  event_datetime_text?: string; // "Sun, Jan 4 at 6:30 PM"
  organization_name: string;
  format_one_line_address?: string;
  city?: string;
  state?: string;
  venue_address_state_raw?: string;
  get_public_price?: string;
  resize_poster_image_url?: string;
  profile_url: string; // "/event/v81shAMe/"
  is_cancelled?: boolean;
  venue_address_google_maps_url?: string;
}

function isWithFriendsEvent(value: unknown): value is WithFriendsEvent {
  if (!isRecord(value)) return false;
  return (
    isString(value.unique_code_public) &&
    isString(value.event_name) &&
    isString(value.event_datetime) &&
    isString(value.organization_name) &&
    isString(value.profile_url)
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse the event datetime from withfriends format
 * Input: "2026-01-04 18:30:00+00:00"
 *
 * NOTE: Despite having +00:00 suffix, the API appears to return local Eastern time
 * with an incorrect UTC offset. The event_datetime_text confirms local time.
 * We parse the date/time portion and treat it as Eastern time.
 */
function parseEventDate(dateStr: string): Date {
  // Extract date and time parts, ignoring the timezone offset
  // Input format: "2026-01-04 18:30:00+00:00"
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (!match) {
    // Fallback: try parsing as-is
    return new Date(dateStr.replace(' ', 'T'));
  }

  const [, datePart, timePart] = match;
  // Parse as Eastern time (the time shown is actually local to Asheville)
  return parseAsEastern(datePart, timePart);
}

/**
 * Format price from API
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
 * Format event as ScrapedEvent
 */
function formatEvent(event: WithFriendsEvent): ScrapedEvent | null {
  // Skip cancelled events
  if (event.is_cancelled) {
    return null;
  }

  // Filter to only allowed organizers
  if (!isAllowedOrganizer(event.organization_name)) {
    return null;
  }

  // Parse date
  const startDate = parseEventDate(event.event_datetime);
  if (isNaN(startDate.getTime())) {
    console.warn(`[Revolve] Invalid date for: ${event.event_name}`);
    return null;
  }

  // Skip past events
  if (startDate < new Date()) {
    return null;
  }

  // Build event URL
  const url = `${BASE_URL}${event.profile_url}`;

  // Get location
  const location =
    event.format_one_line_address ||
    (event.city && event.state ? `${event.city}, ${event.state}` : undefined);

  // Get zip from city
  const zip = getZipFromCity(event.city);

  return {
    sourceId: `revolve-${event.unique_code_public}`,
    source: 'REVOLVE',
    title: decodeHtmlEntities(event.event_name),
    startDate,
    location,
    zip,
    organizer: event.organization_name,
    price: formatPrice(event.get_public_price),
    url,
    imageUrl: event.resize_poster_image_url,
  };
}

/**
 * Extract events JSON from HTML page
 * The data is embedded as a JavaScript array in the page
 */
function extractEventsFromHtml(html: string): WithFriendsEvent[] {
  // The events are embedded in a script tag or JavaScript variable
  // Look for the array pattern starting with unique_code_public

  // Try to find an array of event objects
  // Pattern: [...{"unique_code_public":...]
  const patterns = [
    // JSON array embedded in script
    /\[(?:\s*\{[^[]*?"unique_code_public"[^[]*?\}(?:\s*,\s*\{[^[]*?"unique_code_public"[^[]*?\})*\s*)\]/g,
    // Alternative: capture JSON array with events
    /events['"]*\s*[:=]\s*(\[[\s\S]*?\])\s*[,;}\n]/i,
  ];

  // First, try to find a clean JSON array
  // Look for content that starts with [{ and contains unique_code_public
  const jsonArrayMatch = html.match(/\[\s*\{\s*"unique_code_public"[\s\S]*?\}\s*\]/);

  if (jsonArrayMatch) {
    try {
      const parsed = JSON.parse(jsonArrayMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        const events = parsed.filter(isWithFriendsEvent);
        if (events.length > 0) {
          console.log(`[Revolve] Found ${events.length} events via direct JSON match`);
          return events;
        }
      }
    } catch {
      // Continue to other patterns
    }
  }

  // Try each pattern
  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const jsonStr = match[1] || match[0];
      try {
        const parsed = JSON.parse(jsonStr) as unknown;
        if (Array.isArray(parsed)) {
          const events = parsed.filter(isWithFriendsEvent);
          if (events.length > 0) {
            console.log(`[Revolve] Found ${events.length} events via pattern match`);
            return events;
          }
        }
      } catch {
        // Continue to next match
      }
    }
  }

  // Fallback: look for individual event objects and collect them
  const eventObjects: WithFriendsEvent[] = [];
  const objectPattern =
    /\{\s*"unique_code_public"\s*:\s*"[^"]+"\s*,[\s\S]*?"profile_url"\s*:\s*"[^"]+"\s*\}/g;
  const objectMatches = html.matchAll(objectPattern);

  for (const match of objectMatches) {
    try {
      const obj = JSON.parse(match[0]) as unknown;
      if (isWithFriendsEvent(obj)) {
        eventObjects.push(obj);
      }
    } catch {
      // Skip invalid JSON
    }
  }

  if (eventObjects.length > 0) {
    console.log(`[Revolve] Found ${eventObjects.length} events via individual object extraction`);
    return eventObjects;
  }

  console.warn('[Revolve] Could not extract events from HTML');
  return [];
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
