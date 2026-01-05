/**
 * Asheville on Bikes Scraper - Google Calendar (ICS)
 *
 * Uses the public Google Calendar iCal feed (no browser scraping).
 * Parses events via node-ical and expands recurring events.
 */

import * as ical from 'node-ical';
import { type ScrapedEvent } from './types';
import { debugSave } from './base';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities, stripHtml, tryExtractPrice } from '@/lib/utils/parsers';
import { parseAsEastern } from '@/lib/utils/timezone';

interface ICalEvent {
  type: string;
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  rrule?: {
    between: (start: Date, end: Date, inc?: boolean) => Date[];
  };
}

const GOOGLE_CALENDAR_URL =
  'https://calendar.google.com/calendar/ical/ashevilleonbikes.com_3eill8djvkjobuhb7hvh5luii0%40group.calendar.google.com/public/full.ics';
const EVENTS_PAGE_URL = 'https://ashevilleonbikes.com/events';
const ORGANIZER_NAME = 'Asheville on Bikes';
const DEFAULT_IMAGE_URL = '/avl_on_bikes.jpg';
const LOOKAHEAD_DAYS = 183;

function normalizeText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = stripHtml(text);
  return cleaned.length > 0 ? cleaned : undefined;
}

function unwrapGoogleUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('google.com') && parsed.pathname.startsWith('/url')) {
      const target = parsed.searchParams.get('q');
      return target ? decodeURIComponent(target) : undefined;
    }
  } catch {
    // ignore invalid URLs
  }
  return undefined;
}

function isGoodEventUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('ashevilleonbikes.com');
  } catch {
    return false;
  }
}

function normalizeCandidateUrl(candidate: string): string | undefined {
  const trimmed = candidate.trim();
  if (trimmed.startsWith('/')) {
    return new URL(trimmed, EVENTS_PAGE_URL).toString();
  }
  if (trimmed.startsWith('http')) {
    return trimmed;
  }
  return undefined;
}

function extractUrlFromDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;

  const decoded = decodeHtmlEntities(description);
  const hrefMatch = decoded.match(/href=["']([^"']+)["']/i);
  const candidates: string[] = [];

  if (hrefMatch?.[1]) {
    candidates.push(hrefMatch[1]);
  }

  const urlMatch = decoded.match(/https?:\/\/[^\s">]+/i);
  if (urlMatch?.[0]) {
    candidates.push(urlMatch[0]);
  }

  for (const candidate of candidates) {
    const normalized = normalizeCandidateUrl(candidate);
    if (!normalized) continue;
    const unwrapped = unwrapGoogleUrl(normalized);
    if (unwrapped) return unwrapped;
    return normalized;
  }

  return undefined;
}

function isDateOnly(date: Date | undefined): boolean {
  return Boolean((date as (Date & { dateOnly?: boolean }) | undefined)?.dateOnly);
}

function buildEventUrl(uid: string, startDate: Date, description?: string): string {
  const extracted = extractUrlFromDescription(description);
  const baseUrl = extracted && isGoodEventUrl(extracted) ? extracted : EVENTS_PAGE_URL;
  const dateFragment = startDate.toISOString().split('T')[0];
  return `${baseUrl}#${uid}-${dateFragment}-${startDate.getTime()}`;
}

function buildScrapedEvent(
  event: ICalEvent,
  startDate: Date,
  timeUnknown: boolean
): ScrapedEvent | null {
  if (!event.summary) return null;
  const title = decodeHtmlEntities(event.summary);
  const description = normalizeText(event.description);
  const location = normalizeText(event.location);
  const url = buildEventUrl(event.uid || 'aob', startDate, event.description);
  const sourceId = `aob-${event.uid || 'aob'}-${startDate.getTime()}`;

  return {
    sourceId,
    source: 'ASHEVILLE_ON_BIKES',
    title,
    description,
    startDate,
    location,
    organizer: ORGANIZER_NAME,
    price: tryExtractPrice(description, 'Unknown', ORGANIZER_NAME),
    url,
    imageUrl: DEFAULT_IMAGE_URL,
    timeUnknown,
  };
}

function extractDateFromText(text: string): string | null {
  const cleaned = decodeHtmlEntities(text)
    .replace(/\s+/g, ' ')
    .replace(/^[\s-–]+/, '')
    .trim();

  if (!cleaned) return null;
  if (/tbd/i.test(cleaned)) return null;

  const match = cleaned.match(
    /(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})/
  );
  if (!match) return null;

  const monthName = match[1].toLowerCase();
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  const month = months[monthName];
  if (!month || !day || !year) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resolveEventHref(href: string): string {
  if (href.startsWith('http')) return href;
  return new URL(href, EVENTS_PAGE_URL).toString();
}

function buildCustomEventUrl(
  baseUrl: string,
  title: string,
  startDate: Date,
  fallbackId: string
): string {
  const normalizedBase = isGoodEventUrl(baseUrl) ? baseUrl : EVENTS_PAGE_URL;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const dateFragment = startDate.toISOString().split('T')[0];
  return `${normalizedBase}#${slug || fallbackId}-${dateFragment}-${startDate.getTime()}`;
}

async function scrapeCustomEvents(): Promise<ScrapedEvent[]> {
  console.log('[AshevilleOnBikes] Fetching custom events page...');

  try {
    const response = await fetchWithRetry(
      EVENTS_PAGE_URL,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      { maxRetries: 3, baseDelay: 1000 }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch events page: ${response.status}`);
    }

    const html = await response.text();
    await debugSave('aob-04-events-page.html', html);

    const events: ScrapedEvent[] = [];
    const now = new Date();
    const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const anchorPattern = /<a\s+href="([^"]+)">([^<]+)<\/a>\s*([^<]*)/gi;

    let match: RegExpExecArray | null;
    while ((match = anchorPattern.exec(html)) !== null) {
      const href = match[1];
      const title = decodeHtmlEntities(match[2].trim());
      const trailingText = match[3] || '';

      if (!title) continue;
      if (title.toLowerCase().includes('bike valet')) continue;

      const dateStr = extractDateFromText(trailingText);
      if (!dateStr) continue;

      const startDate = parseAsEastern(dateStr, '00:00:00');
      if (startDate < now || startDate > horizon) continue;

      const url = buildCustomEventUrl(resolveEventHref(href), title, startDate, 'custom');
      events.push({
        sourceId: `aob-custom-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${startDate.getTime()}`,
        source: 'ASHEVILLE_ON_BIKES',
        title,
        startDate,
        organizer: ORGANIZER_NAME,
        price: 'Unknown',
        url,
        imageUrl: DEFAULT_IMAGE_URL,
        timeUnknown: true,
      });
    }

    console.log(`[AshevilleOnBikes] Found ${events.length} custom events`);
    await debugSave('aob-05-custom-events.json', events);
    return events;
  } catch (error) {
    console.error('[AshevilleOnBikes] Custom events scrape failed:', error);
    return [];
  }
}

export async function scrapeAshevilleOnBikes(): Promise<ScrapedEvent[]> {
  console.log('[AshevilleOnBikes] Starting scrape...');

  try {
    const [calendarResponse, customEvents] = await Promise.all([
      fetchWithRetry(
        GOOGLE_CALENDAR_URL,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        },
        { maxRetries: 3, baseDelay: 1000 }
      ),
      scrapeCustomEvents(),
    ]);

    if (!calendarResponse.ok) {
      throw new Error(`Failed to fetch calendar: ${calendarResponse.status}`);
    }

    const icsData = await calendarResponse.text();
    await debugSave('aob-01-raw.ics', icsData);

    const parsedEvents = await ical.async.parseICS(icsData);
    const eventCount = Object.keys(parsedEvents).filter(
      (k) => parsedEvents[k].type === 'VEVENT'
    ).length;
    await debugSave('aob-02-parsed-count.txt', `${eventCount} VEVENT entries parsed`);

    const now = new Date();
    const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const calendarEvents: ScrapedEvent[] = [];
    const seen = new Set<string>();

    for (const key in parsedEvents) {
      const event = parsedEvents[key] as ICalEvent;
      if (event.type !== 'VEVENT' || !event.summary) continue;

      const baseTimeUnknown = isDateOnly(event.start);

      if (event.rrule) {
        const originalStart = event.start ? new Date(event.start) : null;
        if (!originalStart) continue;

        const originalLocalTime = originalStart.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
        });
        const [localHours, localMinutes] = originalLocalTime.split(':').map(Number);

        const occurrences = event.rrule.between(now, horizon, true);
        for (const occurrence of occurrences) {
          const occDate = new Date(occurrence);
          const occLocalDate = occDate.toLocaleDateString('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
          const [month, day, year] = occLocalDate.split('/').map(Number);
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
            2,
            '0'
          )}`;
          const timeStr = `${String(localHours).padStart(2, '0')}:${String(localMinutes).padStart(
            2,
            '0'
          )}:00`;

          const startDate = baseTimeUnknown
            ? parseAsEastern(dateStr, '00:00:00')
            : parseAsEastern(dateStr, timeStr);

          const dedupKey = `${event.uid || key}-${startDate.toISOString()}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);

          const formatted = buildScrapedEvent(event, startDate, baseTimeUnknown);
          if (formatted) calendarEvents.push(formatted);
        }
      } else if (event.start) {
        const startDate = new Date(event.start);
        if (startDate < now || startDate > horizon) continue;

        const dedupKey = `${event.uid || key}-${startDate.toISOString()}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const formatted = buildScrapedEvent(event, startDate, baseTimeUnknown);
        if (formatted) calendarEvents.push(formatted);
      }
    }

    const allEvents: ScrapedEvent[] = [];
    const combinedSeen = new Set<string>();

    for (const event of [...calendarEvents, ...customEvents]) {
      const dateKey = event.startDate.toISOString().split('T')[0];
      const key = `${event.title.toLowerCase()}-${dateKey}`;
      if (combinedSeen.has(key)) continue;
      combinedSeen.add(key);
      allEvents.push(event);
    }

    allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    console.log(
      `[AshevilleOnBikes] Found ${allEvents.length} upcoming events (${calendarEvents.length} calendar, ${customEvents.length} custom)`
    );
    await debugSave('aob-03-events.json', allEvents);

    return allEvents;
  } catch (error) {
    console.error('[AshevilleOnBikes] Scrape failed:', error);
    return [];
  }
}
