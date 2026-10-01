/**
 * City of Asheville Scraper - City Council, boards and commissions
 *
 * Source: the city's WordPress "The Events Calendar" (Tribe) REST API,
 *   https://www.ashevillenc.gov/wp-json/tribe/events/v1/events
 * which carries City Council plus ~35 boards and commissions, each its own category.
 *
 * The API rows have no venue and no description; the meeting format lives only in the title
 * ("(In-Person)", "(Virtual)", "(Hybrid)"). The event page itself renders the useful parts from
 * custom fields - the actual location and room, a link to the board's page / meeting materials,
 * and the board's regular meeting schedule - so each in-horizon event's page is fetched once
 * (about 20 a month) and the title-based defaults are only a fallback when that fetch fails.
 *
 * Skipped: "Canceled:" rows, the "Holidays - City Offices Closed" category, and internal staff
 * items that occasionally land in "Community Event". The Helene recovery boards stay in: they
 * are public advisory boards with agendas, staff liaisons and recorded meetings.
 *
 * AVL Today also syndicates this calendar, with the same event URLs. `url` is unique, so both
 * sources upsert into one row; whichever inserted it first keeps the `source` label.
 */

import { type ScrapedEvent } from './types';
import { debugSave } from './base';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import {
  getDayBoundariesEastern,
  getTodayStringEastern,
  parseAsEastern,
} from '@/lib/utils/timezone';

const API_BASE = 'https://www.ashevillenc.gov/wp-json/tribe/events/v1/events';
const ORGANIZER = 'City of Asheville';
const CITY_HALL = 'Asheville City Hall, 70 Court Plaza, Asheville, NC 28801';
const CITY_HALL_ZIP = '28801';
// Not "Online"/"Virtual": the feed query hides any location matching %online% or %virtual%
// (lib/db/queries/events.ts), which would drop these local meetings from every list.
const REMOTE_LOCATION = 'Remote meeting';
const HORIZON_DAYS = 60;
const DATE_ONLY_TIME = '09:00:00';
const PER_PAGE = 50;
const MAX_PAGES = 10;
const PAGE_CONCURRENCY = 4;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const SKIP_CATEGORY_SLUGS = new Set(['holidays-city-offices-closed']);
// Umbrella categories; the specific board is the other category on the row
const GENERIC_CATEGORY_SLUGS = new Set([
  'boards-and-commissions',
  'helene-recovery-boards',
  'council-committee',
]);
const COMMUNITY_CATEGORY_SLUG = 'community-event';

const CANCELED_PREFIX = /^\s*(?:canceled|cancelled)\b\s*:?/i;
const TITLE_DENYLIST = [
  /\bperformance conversation\b/i, // "OA - Performance conversation to start August 24" (HR notice)
];

interface TribeCategory {
  name: string;
  slug: string;
}

interface TribeEvent {
  id: number;
  title: string;
  url: string;
  start_date: string; // "2026-10-13 17:00:00", local (America/New_York)
  utc_start_date?: string; // "2026-10-13 21:00:00", UTC without a zone suffix
  all_day: boolean; // all-day rows carry a meaningless clock time (e.g. "05:00:00")
  categories?: TribeCategory[];
}

interface TribeEventsResponse {
  events: TribeEvent[];
  next_rest_url?: string;
  total?: number;
}

type MeetingFormat = 'in-person' | 'virtual' | 'hybrid' | 'unknown';

interface PageDetails {
  locationLines: string[]; // e.g. ["70 Court Plaza, Asheville, NC 28801, USA", "First Floor Conference Room"]
  infoLink?: { href: string; label: string };
  schedule?: string;
}

/**
 * Timed rows: the API's own UTC timestamp. All-day rows: the calendar date at an Eastern daytime
 * placeholder (stored with timeUnknown), as AVL Today does - their clock time is meaningless.
 */
function startDateOf(event: TribeEvent): Date | null {
  const [datePart, timePart = '00:00:00'] = event.start_date.split(' ');
  let date: Date;
  if (event.all_day) {
    date = parseAsEastern(datePart, DATE_ONLY_TIME);
  } else if (event.utc_start_date) {
    date = new Date(`${event.utc_start_date.replace(' ', 'T')}Z`);
  } else {
    date = parseAsEastern(datePart, timePart);
  }
  return isNaN(date.getTime()) ? null : date;
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function formatFromTitle(title: string): MeetingFormat {
  if (/\(\s*in[- ]person\s*\)/i.test(title)) return 'in-person';
  if (/\(\s*virtual\s*\)/i.test(title)) return 'virtual';
  if (/\(\s*hybrid\s*\)/i.test(title)) return 'hybrid';
  return 'unknown';
}

function cleanTitle(raw: string): { title: string; rescheduled: boolean } {
  let title = decodeHtmlEntities(raw).replace(/\(\s*in[- ]person\s*\)/i, '(In-Person)');
  const rescheduled = /^\s*rescheduled\s*:/i.test(title);
  title = title.replace(/^\s*rescheduled\s*:\s*/i, '').trim();
  return { title, rescheduled };
}

/** The specific board/commission for a row, e.g. "Historic Resources Commission". */
function boardName(event: TribeEvent): string | undefined {
  const specific = (event.categories ?? []).filter(
    (c) => !GENERIC_CATEGORY_SLUGS.has(c.slug) && c.slug !== COMMUNITY_CATEGORY_SLUG
  );
  const category = specific[specific.length - 1];
  return category ? decodeHtmlEntities(category.name) : undefined;
}

function sectionAfterHeading(html: string, heading: string): string | undefined {
  const match = html.match(
    new RegExp(`<h[2-4][^>]*>\\s*${heading}\\s*</h[2-4]>\\s*([\\s\\S]*?)</div>`, 'i')
  );
  return match?.[1];
}

function paragraphs(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeHtmlEntities(m[1]).replace(/\s+([.,])/g, '$1'))
    .filter(Boolean);
}

/** Pull location, the board page link and the regular schedule out of an event page. */
function parseEventPage(html: string): PageDetails {
  const locationHtml = sectionAfterHeading(html, 'Location');
  const infoHtml = sectionAfterHeading(html, 'Additional Information');
  const scheduleHtml = sectionAfterHeading(html, 'Regular Meeting Schedule');

  const link = infoHtml?.match(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  // A paragraph ending in ":" introduces a <ul> of one-off dates; too long for a description
  const schedule = scheduleHtml
    ? paragraphs(scheduleHtml)
        .filter((p) => !p.endsWith(':'))
        .join(' ')
    : '';
  return {
    locationLines: locationHtml ? paragraphs(locationHtml) : [],
    infoLink: link ? { href: link[1], label: decodeHtmlEntities(link[2]) } : undefined,
    schedule: schedule || undefined,
  };
}

async function fetchEventPage(url: string): Promise<PageDetails | null> {
  try {
    const response = await fetchWithRetry(
      url,
      { headers: { ...HEADERS, Accept: 'text/html' }, cache: 'no-store' },
      { maxRetries: 2, baseDelay: 1000 }
    );
    return parseEventPage(await response.text());
  } catch (error) {
    console.warn(
      `[CityOfAsheville] Event page fetch failed, using title defaults: ${url}`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

async function fetchEventList(startDate: string, endDate: string): Promise<TribeEvent[]> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: `${endDate} 23:59:59`,
    per_page: String(PER_PAGE),
    status: 'publish',
  });
  let url: string | undefined = `${API_BASE}?${params}`;
  const events: TribeEvent[] = [];
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    const response = await fetchWithRetry(
      url,
      { headers: { ...HEADERS, Accept: 'application/json' }, cache: 'no-store' },
      { maxRetries: 3, baseDelay: 1000 }
    );
    const data = (await response.json()) as TribeEventsResponse;
    events.push(...(data.events ?? []));
    url = data.next_rest_url;
  }
  return events;
}

function buildEvent(event: TribeEvent, startDate: Date, page: PageDetails | null): ScrapedEvent {
  const { title, rescheduled } = cleanTitle(event.title);
  const board = boardName(event);
  const isCommunityEvent = (event.categories ?? []).some((c) => c.slug === COMMUNITY_CATEGORY_SLUG);

  const pageLocation = page?.locationLines ?? [];
  const pageSaysRemote = pageLocation.length > 0 && /\b(online|virtual)\b/i.test(pageLocation[0]);
  let format = formatFromTitle(title);
  if (format === 'unknown' && pageSaysRemote) format = 'virtual';

  // Location: the event page's address (+ room), else City Hall for board meetings
  let location: string | undefined;
  let zip: string | undefined;
  let room: string | undefined;
  if (format === 'virtual') {
    location = REMOTE_LOCATION;
  } else if (pageLocation.length > 0 && !pageSaysRemote) {
    const address = pageLocation[0].replace(/,\s*USA$/i, '');
    location = /^70 Court Plaza\b/i.test(address) ? `Asheville City Hall, ${address}` : address;
    zip = address.match(/\b(2[78]\d{3})\b/)?.[1];
    room = pageLocation.slice(1).join(', ') || undefined;
  } else if (!isCommunityEvent) {
    location = CITY_HALL;
    zip = CITY_HALL_ZIP;
  }

  const lines: string[] = [];
  if (isCommunityEvent) {
    // The API carries no description for these; same fallback shape as the county scraper
    lines.push('Community Event. Details on the City of Asheville calendar.');
  } else {
    const formatText = {
      'in-person': 'held in person',
      virtual: 'held online only',
      hybrid: 'held in a hybrid format (attend in person or online)',
      unknown: '',
    }[format];
    const who = board ? `the City of Asheville's ${board}` : 'a City of Asheville board';
    lines.push(
      `Public meeting of ${who}${formatText ? `, ${formatText}` : ''}. City board and commission meetings are open to the public.`
    );
  }
  if (rescheduled) lines.push('Rescheduled from its usual date.');
  if (room) lines.push(`Room: ${room}.`);
  if (page?.schedule) lines.push(`Regular schedule: ${page.schedule}`);
  if (page?.infoLink) lines.push(`${page.infoLink.label}: ${page.infoLink.href}`);
  if (!isCommunityEvent) {
    lines.push('Agendas and meeting materials are posted on the event page.');
  }

  return {
    sourceId: `coa-${event.id}`,
    source: 'CITY_OF_ASHEVILLE',
    title,
    description: lines.join('\n'),
    startDate,
    location,
    zip,
    organizer: ORGANIZER,
    price: isCommunityEvent && !/\bmeeting\b/i.test(title) ? 'Unknown' : 'Free',
    url: event.url,
    timeUnknown: event.all_day,
  };
}

export async function scrapeCityOfAsheville(): Promise<ScrapedEvent[]> {
  const today = getTodayStringEastern();
  const lastDay = addDays(today, HORIZON_DAYS - 1);
  console.log(`[CityOfAsheville] Fetching city calendar ${today} to ${lastDay}...`);

  const rawEvents = await fetchEventList(today, lastDay);
  await debugSave('01-api-events.json', rawEvents, { label: 'CityOfAsheville' });

  const now = new Date();
  // Not parseAsEastern(day, '00:00:00'): that uses the noon offset, an hour off on DST days
  const startOfToday = getDayBoundariesEastern(today).start;
  const horizon = getDayBoundariesEastern(addDays(today, HORIZON_DAYS)).start;
  const kept: { event: TribeEvent; startDate: Date }[] = [];
  let skippedCanceled = 0;
  let skippedOther = 0;
  for (const event of rawEvents) {
    const title = decodeHtmlEntities(event.title || '');
    if (!title) continue;
    if (CANCELED_PREFIX.test(title)) {
      skippedCanceled++;
      continue;
    }
    if (
      (event.categories ?? []).some((c) => SKIP_CATEGORY_SLUGS.has(c.slug)) ||
      TITLE_DENYLIST.some((pattern) => pattern.test(title))
    ) {
      skippedOther++;
      continue;
    }
    const startDate = startDateOf(event);
    if (!startDate) continue;
    // Eastern day boundaries: an all-day row counts for all of its day, a timed one until it starts
    if (startDate >= horizon || startDate < (event.all_day ? startOfToday : now)) continue;
    kept.push({ event, startDate });
  }

  // One page fetch per event for location / board link / schedule, a few at a time
  const results: ScrapedEvent[] = [];
  let pageFailures = 0;
  for (let i = 0; i < kept.length; i += PAGE_CONCURRENCY) {
    const batch = kept.slice(i, i + PAGE_CONCURRENCY);
    const pages = await Promise.all(batch.map(({ event }) => fetchEventPage(event.url)));
    batch.forEach(({ event, startDate }, j) => {
      if (!pages[j]) pageFailures++;
      results.push(buildEvent(event, startDate, pages[j]));
    });
  }

  results.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  await debugSave('02-events.json', results, { label: 'CityOfAsheville' });

  console.log(
    `[CityOfAsheville] Found ${results.length} events (skipped ${skippedCanceled} canceled, ${skippedOther} holidays/internal; ${pageFailures} page fetches fell back to title defaults)`
  );
  return results;
}
