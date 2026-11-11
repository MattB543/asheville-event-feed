/**
 * Bountiful Cities scraper - public Google Calendar (ICS)
 *
 * The calendar embedded at bountifulcities.org/calendar: no-cost produce Share Markets, community
 * garden workdays, workshops, plant sales and potlucks. Recurring series are expanded here, with
 * each series' cancelled dates (EXDATE) and moved dates (RECURRENCE-ID) applied.
 *
 * Known limit, shared with the other calendar scrapers: a date cancelled after we stored it stays
 * in the feed, because the calendar page it links to still loads.
 */

import * as ical from 'node-ical';
import { type ScrapedEvent } from './types';
import { debugSave } from './base';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities, stripHtml, tryExtractPrice } from '@/lib/utils/parsers';
import { getDateStringEastern, parseAsEastern } from '@/lib/utils/timezone';

const CALENDAR_ICS_URL =
  'https://calendar.google.com/calendar/ical/rcife1drre74ovtk05b6a9215s%40group.calendar.google.com/public/basic.ics';
const CALENDAR_PAGE_URL = 'https://www.bountifulcities.org/calendar';
const ORGANIZER = 'Bountiful Cities';
// Weekly workdays repeat forever, so a long window would fill the feed with them.
const LOOKAHEAD_DAYS = 60;

// Calendar entries that aren't public events: the newsletter reminder, garden rentals, staff days,
// booked school and company groups, meetings, and anything marked cancelled. Judged against every
// title the calendar has used since 2020; it is a word list, so a new kind of entry can slip by.
const NOT_PUBLIC_TITLE =
  /newsletter|private|rental|reservation|staff|rehearsal|meeting|tabling|orientation|service day|americorps|volunteer group|volunteers? at|students? (?:at|workday|volunteers|tour)|cancel+ed|virtual/i;
const VIDEO_CALL_LOCATION = /meet\.google\.com|zoom\.us|video call/i;
const FREE_TITLE = /no[- ]cost|\bfree\b|share market|workday/i;

// Some entries leave the location blank and only name the garden in the title.
const GARDEN_ADDRESSES: [RegExp, string][] = [
  [
    /carver/i,
    'Dr. George Washington Carver Edible Park, 30 George Washington Carver Ave, Asheville, NC 28801',
  ],
  [/pearson/i, 'Pearson Garden, 408 Pearson Dr, Asheville, NC 28801'],
];

interface CalendarEntry {
  type: string;
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: Date & { dateOnly?: boolean };
  recurrenceid?: Date;
  rrule?: { between: (after: Date, before: Date, inclusive?: boolean) => Date[] };
  exdate?: Record<string, Date>;
  recurrences?: Record<string, CalendarEntry>;
}

/** Eastern wall-clock time of an instant, as HH:MM:00. */
function easternTime(date: Date): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${time}:00`;
}

function cleanText(html: string | undefined): string | undefined {
  if (typeof html !== 'string') return undefined;
  const text = stripHtml(html.replace(/<br\s*\/?>|<\/p>/gi, '\n'))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

function locationFor(title: string, raw: string | undefined): string | undefined {
  const location = cleanText(raw)?.replace(/,\s*USA$/i, '');
  if (location) return location;
  return GARDEN_ADDRESSES.find(([pattern]) => pattern.test(title))?.[1];
}

function buildEvent(entry: CalendarEntry, id: string, startDate: Date): ScrapedEvent | null {
  if (typeof entry.summary !== 'string' || entry.status === 'CANCELLED') return null;
  const title = decodeHtmlEntities(entry.summary).replace(/\s+/g, ' ').trim();
  if (!title || NOT_PUBLIC_TITLE.test(title)) return null;
  if (typeof entry.location === 'string' && VIDEO_CALL_LOCATION.test(entry.location)) return null;

  // No place to send anyone: the entry is a note to staff or isn't filled in yet.
  const location = locationFor(title, entry.location);
  if (!location) return null;

  const description = cleanText(entry.description);
  return {
    sourceId: `bountifulcities-${id}`,
    source: 'BOUNTIFUL_CITIES',
    title,
    description,
    startDate,
    location,
    zip: location.match(/\b28\d{3}\b/)?.[0],
    organizer: ORGANIZER,
    price: FREE_TITLE.test(title) ? 'Free' : tryExtractPrice(description, 'Unknown', ORGANIZER),
    // Every event shares the one calendar page, so the fragment is what makes the URL unique.
    url: `${CALENDAR_PAGE_URL}#${id}`,
  };
}

/**
 * When a moved date (a VEVENT with RECURRENCE-ID) comes before its series in the file, node-ical
 * starts the series from the moved copy and the series keeps whatever it doesn't set itself, so a
 * series with no LOCATION takes one from a single moved date. Putting moved copies last avoids it.
 */
function movedCopiesLast(ics: string): string {
  const blocks = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  if (!blocks) return ics;
  const isMoved = (block: string) => /^RECURRENCE-ID/m.test(block);
  const ordered = [...blocks.filter((b) => !isMoved(b)), ...blocks.filter(isMoved)];
  return `${ics.slice(0, ics.indexOf('BEGIN:VEVENT'))}${ordered.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

/** Every timed, public, in-person event starting between `now` and `horizon`. */
export async function eventsFromCalendar(
  ics: string,
  now: Date,
  horizon: Date
): Promise<ScrapedEvent[]> {
  const parsed = await ical.async.parseICS(movedCopiesLast(ics));
  const events: ScrapedEvent[] = [];
  const add = (entry: CalendarEntry, id: string, startDate: Date) => {
    if (startDate < now || startDate > horizon) return;
    const event = buildEvent(entry, id, startDate);
    if (event) events.push(event);
  };

  for (const [key, value] of Object.entries(parsed)) {
    const entry = value as CalendarEntry;
    // All-day entries are skipped: the calendar has had one in five years.
    if (entry.type !== 'VEVENT' || !entry.start || entry.start.dateOnly) continue;
    // A one-off is identified by its UID and a date in a series by UID + the date the series
    // gives it, which a moved copy keeps. So a rescheduled event updates its row instead of
    // leaving the old date behind, and a date moved onto another one doesn't replace it.
    const uid = (entry.uid || key).replace(/@google\.com$/, '');
    const moved = Object.values(entry.recurrences ?? {}).filter(
      (copy): copy is CalendarEntry & { recurrenceid: Date } => copy.recurrenceid instanceof Date
    );

    if (entry.rrule) {
      // Dates this series skips: cancelled ones, and ones a moved copy replaces.
      const skipped = new Set(
        [...Object.values(entry.exdate ?? {}), ...moved.map((copy) => copy.recurrenceid)]
          .filter((d): d is Date => d instanceof Date)
          .map(getDateStringEastern)
      );
      const time = easternTime(entry.start);
      // Pad the search by a day and let add() apply the exact window. Depending on the version,
      // rrule returns each occurrence as its real instant or as its Eastern wall time written in
      // UTC; either way the Eastern calendar day is right for anything starting after 5am, and
      // the time of day comes from the series' own start so it holds across DST.
      const from = new Date(now.getTime() - 86400000);
      const to = new Date(horizon.getTime() + 86400000);
      for (const occurrence of entry.rrule.between(from, to, true)) {
        const day = getDateStringEastern(occurrence);
        if (!skipped.has(day)) add(entry, `${uid}-${day}`, parseAsEastern(day, time));
      }
    } else if (!entry.recurrenceid) {
      add(entry, uid, new Date(entry.start));
    }

    for (const copy of moved) {
      if (!copy.start || copy.start.dateOnly) continue;
      add(copy, `${uid}-${getDateStringEastern(copy.recurrenceid)}`, new Date(copy.start));
    }
  }

  return events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

export async function scrapeBountifulCities(): Promise<ScrapedEvent[]> {
  console.log('[BountifulCities] Fetching calendar...');
  // Throws on a failed fetch or an unreadable feed, so the scrape job records a failure
  // instead of a healthy-looking 0 events.
  const response = await fetchWithRetry(
    CALENDAR_ICS_URL,
    { cache: 'no-store' },
    { maxRetries: 3, baseDelay: 1000 }
  );
  const ics = await response.text();
  if (!ics.includes('BEGIN:VCALENDAR')) throw new Error('Calendar response is not an iCal feed');
  await debugSave('bountifulcities-01-raw.ics', ics);

  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
  const events = await eventsFromCalendar(ics, now, horizon);
  await debugSave('bountifulcities-02-events.json', events);
  console.log(`[BountifulCities] Found ${events.length} events in the next ${LOOKAHEAD_DAYS} days`);
  return events;
}
