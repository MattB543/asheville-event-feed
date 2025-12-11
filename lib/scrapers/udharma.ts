import { ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ical = require('node-ical');

// Squarespace API types
interface SquarespaceEvent {
  id: string;
  title: string;
  urlId: string;
  startDate: number; // Unix timestamp in milliseconds
  endDate: number;
  excerpt?: string;
  body?: string;
  assetUrl?: string;
  fullUrl: string;
}

interface SquarespaceCollectionResponse {
  collection: {
    id: string;
    title: string;
    itemCount: number;
  };
  past?: SquarespaceEvent[];
  upcoming?: SquarespaceEvent[];
  items?: SquarespaceEvent[];
}

// iCal event type (from node-ical)
interface ICalEvent {
  type: string;
  uid?: string;
  summary?: string;
  description?: string;
  start?: Date;
  end?: Date;
  location?: string;
  rrule?: {
    between: (start: Date, end: Date, inc?: boolean) => Date[];
  };
  recurrences?: Record<string, ICalEvent>;
}

const BASE_URL = 'https://www.udharmanc.com';
const SPECIAL_EVENTS_URL = `${BASE_URL}/special-events?format=json`;
const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/ical/info%40udharmanc.com/public/basic.ics';

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Events to exclude (private/internal meetings, open hours)
const EXCLUDED_TITLES = [
  'private meeting',
  'private event',
  'staff meeting',
  'board meeting',
  'regular open hours',
  'open hours',
];

// Default image for Urban Dharma events
const DEFAULT_IMAGE_URL = '/urban_dharma.jpg';

// Debug helper - saves data to debug folder if DEBUG_DIR is set (local dev only)
async function debugSave(filename: string, data: unknown): Promise<void> {
  const debugDir = process.env.DEBUG_DIR;
  if (!debugDir) return;

  try {
    // Dynamic imports to avoid bundling fs/path in production
    const fs = await import('fs');
    const path = await import('path');
    const filepath = path.join(debugDir, filename);
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filepath, content);
    console.log(`[UDharma Debug] Saved: ${filepath}`);
  } catch {
    // Ignore debug save errors in production
  }
}

// Strip HTML tags from description
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if event should be excluded
function shouldExclude(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return EXCLUDED_TITLES.some(excluded => lowerTitle.includes(excluded));
}

// Convert a local time in a specific timezone to a UTC Date
// This handles DST correctly by using Intl.DateTimeFormat
function getDateInTimezone(
  year: number,
  month: number, // 1-12
  day: number,
  hours: number,
  minutes: number,
  timezone: string
): Date {
  // Create a reference date at noon UTC on the target day (avoids DST edge cases)
  const refDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  // Get the timezone offset for this specific date
  // We compare UTC time with the local time in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Parse the formatted local time to get offset
  const parts = formatter.formatToParts(refDate);
  const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);

  const localHour = getPart('hour');
  const utcHour = refDate.getUTCHours();

  // Calculate offset in hours (positive = behind UTC, negative = ahead)
  let offsetHours = utcHour - localHour;
  // Handle day boundary wraparound
  if (offsetHours > 12) offsetHours -= 24;
  if (offsetHours < -12) offsetHours += 24;

  // Create the target date in UTC by adding the offset
  // Target local time -> UTC: add the offset hours
  return new Date(Date.UTC(year, month - 1, day, hours + offsetHours, minutes, 0));
}

// Scrape special events from Squarespace API
async function scrapeSpecialEvents(): Promise<ScrapedEvent[]> {
  console.log('[UDharma] Fetching special events from Squarespace...');

  try {
    const response = await fetchWithRetry(
      SPECIAL_EVENTS_URL,
      { headers: API_HEADERS, cache: 'no-store' },
      { maxRetries: 3, baseDelay: 1000 }
    );

    const data: SquarespaceCollectionResponse = await response.json();
    debugSave('01-squarespace-response.json', data);

    const allRawEvents: SquarespaceEvent[] = [
      ...(data.past || []),
      ...(data.upcoming || []),
      ...(data.items || []),
    ];

    console.log(`[UDharma] Found ${allRawEvents.length} raw special events`);

    const now = Date.now();
    const futureEvents = allRawEvents.filter(ev => ev.startDate > now);
    console.log(`[UDharma] ${futureEvents.length} future special events`);

    const events: ScrapedEvent[] = [];
    for (const rawEvent of futureEvents) {
      try {
        const eventUrl = `${BASE_URL}${rawEvent.fullUrl}?format=json`;
        const eventResponse = await fetchWithRetry(
          eventUrl,
          { headers: API_HEADERS, cache: 'no-store' },
          { maxRetries: 2, baseDelay: 500 }
        );
        const eventData = await eventResponse.json();

        const fullBody = eventData.body || rawEvent.excerpt || '';
        const description = stripHtml(fullBody);

        events.push(formatSquarespaceEvent(rawEvent, description));
        await new Promise(r => setTimeout(r, 200));
      } catch {
        console.warn(`[UDharma] Failed to fetch details for "${rawEvent.title}"`);
        const description = rawEvent.excerpt ? stripHtml(rawEvent.excerpt) : '';
        events.push(formatSquarespaceEvent(rawEvent, description));
      }
    }

    return events;
  } catch (error) {
    console.error('[UDharma] Special events scrape failed:', error);
    return [];
  }
}

function formatSquarespaceEvent(rawEvent: SquarespaceEvent, description: string): ScrapedEvent {
  return {
    sourceId: `udharma-sq-${rawEvent.id}`,
    source: 'UDHARMA',
    title: rawEvent.title,
    description: description || undefined,
    startDate: new Date(rawEvent.startDate),
    location: 'Urban Dharma, 697 Haywood Rd, Asheville, NC',
    zip: '28806',
    organizer: 'Urban Dharma',
    price: 'Free',
    url: `${BASE_URL}${rawEvent.fullUrl}`,
    imageUrl: rawEvent.assetUrl || DEFAULT_IMAGE_URL,
  };
}

// Scrape recurring events from Google Calendar
async function scrapeGoogleCalendarEvents(): Promise<ScrapedEvent[]> {
  console.log('[UDharma] Fetching events from Google Calendar...');

  try {
    // Fetch iCal feed
    const response = await fetch(GOOGLE_CALENDAR_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.status}`);
    }

    const icsData = await response.text();
    debugSave('02-google-calendar.ics', icsData);

    // Parse iCal
    const now = new Date();
    const threeMonthsLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const parsedEvents = await ical.async.parseICS(icsData);
    const eventCount = Object.keys(parsedEvents).filter(k => parsedEvents[k].type === 'VEVENT').length;
    debugSave('03-parsed-ical.json', `${eventCount} VEVENT entries parsed`);

    const events: ScrapedEvent[] = [];
    const seenEvents = new Set<string>(); // For deduplication

    for (const key in parsedEvents) {
      const event = parsedEvents[key] as ICalEvent;

      if (event.type !== 'VEVENT') continue;
      if (!event.summary) continue;

      const title = event.summary;

      // Skip excluded events
      if (shouldExclude(title)) continue;

      const description = event.description ? stripHtml(event.description) : undefined;
      const location = event.location || 'Urban Dharma, 697 Haywood Rd, Asheville, NC';
      const zip = '28806';

      // Handle recurring events using rrule
      if (event.rrule) {
        try {
          // Get all occurrences in our date range
          const occurrences = event.rrule.between(now, threeMonthsLater, true);

          // Get the original event's local time in America/New_York
          // node-ical parses the timezone correctly, so event.start is the correct instant
          const originalStart = event.start ? new Date(event.start) : null;
          if (!originalStart) continue;

          // Extract the local time (hour:minute) in America/New_York timezone
          // This works regardless of server timezone
          const originalLocalTime = originalStart.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
          });
          const [localHours, localMinutes] = originalLocalTime.split(':').map(Number);

          for (const occurrence of occurrences) {
            // Get the occurrence date components in America/New_York timezone
            const occDate = new Date(occurrence);
            const occLocalDate = occDate.toLocaleDateString('en-US', {
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            });
            const [month, day, year] = occLocalDate.split('/').map(Number);

            // Create the target datetime in America/New_York and convert to UTC
            // We use the fact that getTimezoneOffset gives us the offset we need
            const startDate = getDateInTimezone(year, month, day, localHours, localMinutes, 'America/New_York');

            // Create dedup key (same title + same day)
            const dedupKey = `${title}-${startDate.toISOString().split('T')[0]}`;
            if (seenEvents.has(dedupKey)) continue;
            seenEvents.add(dedupKey);

            // Create unique URL with date fragment (DB uses URL as unique key)
            const dateFragment = startDate.toISOString().split('T')[0];
            events.push({
              sourceId: `udharma-gc-${event.uid || key}-${startDate.getTime()}`,
              source: 'UDHARMA',
              title: title,
              description: description,
              startDate: startDate,
              location: location,
              zip: zip,
              organizer: 'Urban Dharma',
              price: 'Free',
              url: `${BASE_URL}/events#${dateFragment}-${startDate.getTime()}`,
              imageUrl: DEFAULT_IMAGE_URL,
            });
          }
        } catch (rruleError) {
          console.warn(`[UDharma] Failed to expand rrule for "${title}":`, rruleError);
        }
      } else if (event.start) {
        // Non-recurring event
        const startDate = new Date(event.start);

        // Skip past events
        if (startDate < now) continue;

        // Skip events too far in the future
        if (startDate > threeMonthsLater) continue;

        // Create dedup key
        const dedupKey = `${title}-${startDate.toISOString().split('T')[0]}`;
        if (seenEvents.has(dedupKey)) continue;
        seenEvents.add(dedupKey);

        // Create unique URL with date fragment (DB uses URL as unique key)
        const dateFragment = startDate.toISOString().split('T')[0];
        events.push({
          sourceId: `udharma-gc-${event.uid || key}`,
          source: 'UDHARMA',
          title: title,
          description: description,
          startDate: startDate,
          location: location,
          zip: zip,
          organizer: 'Urban Dharma',
          price: 'Free',
          url: `${BASE_URL}/events#${dateFragment}-${startDate.getTime()}`,
          imageUrl: DEFAULT_IMAGE_URL,
        });
      }
    }

    console.log(`[UDharma] Found ${events.length} future calendar events (from ${eventCount} base events)`);
    return events;
  } catch (error) {
    console.error('[UDharma] Google Calendar scrape failed:', error);
    return [];
  }
}

export async function scrapeUDharma(): Promise<ScrapedEvent[]> {
  console.log('[UDharma] Starting scrape...');

  // Scrape both sources in parallel
  const [specialEvents, calendarEvents] = await Promise.all([
    scrapeSpecialEvents(),
    scrapeGoogleCalendarEvents(),
  ]);

  // Combine and deduplicate
  const allEvents: ScrapedEvent[] = [...specialEvents];
  const specialTitles = new Set(specialEvents.map(e => e.title.toLowerCase()));

  // Add calendar events that don't duplicate special events
  for (const calEvent of calendarEvents) {
    if (!specialTitles.has(calEvent.title.toLowerCase())) {
      allEvents.push(calEvent);
    }
  }

  debugSave('04-combined-events.json', allEvents);

  // Generate validation report
  const report = generateValidationReport(allEvents);
  debugSave('05-validation-report.txt', report);

  console.log(`[UDharma] Finished. Found ${allEvents.length} total events (${specialEvents.length} special, ${calendarEvents.length} calendar)`);
  return allEvents;
}

function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - UDharma NC`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    '=== DATE VALIDATION ===',
  ];

  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

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

    const hours = date.getHours();
    const mins = date.getMinutes();
    if (hours === 0 && mins === 0) {
      issues.push('MIDNIGHT (missing time?)');
    }

    if (issues.length > 0) {
      lines.push(`  ${event.title.slice(0, 50)}`);
      lines.push(`    Date: ${date.toISOString()} -> ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
      lines.push(`    Issues: ${issues.join(', ')}`);
    }
  }

  lines.push('', '=== FIELD COMPLETENESS ===');
  const withImages = events.filter(e => e.imageUrl).length;
  const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter(e => e.description).length;

  lines.push(`  With images: ${withImages}/${events.length} (${events.length > 0 ? Math.round(withImages/events.length*100) : 0}%)`);
  lines.push(`  With prices: ${withPrices}/${events.length} (${events.length > 0 ? Math.round(withPrices/events.length*100) : 0}%)`);
  lines.push(`  With descriptions: ${withDescriptions}/${events.length} (${events.length > 0 ? Math.round(withDescriptions/events.length*100) : 0}%)`);

  lines.push('', '=== SAMPLE EVENTS ===');
  for (const event of events.slice(0, 10)) {
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC): ${event.startDate.toISOString()}`);
    lines.push(`  Date (ET): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    lines.push(`  Location: ${event.location || 'N/A'}`);
    lines.push(`  Price: ${event.price || 'N/A'}`);
    lines.push(`  URL: ${event.url}`);
    lines.push(`  Source ID: ${event.sourceId}`);
    lines.push('');
  }

  return lines.join('\n');
}
