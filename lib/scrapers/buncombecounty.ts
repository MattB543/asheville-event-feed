/**
 * Buncombe County Scraper - CivicPlus calendar iCalendar feeds
 *
 * The county website (CivicPlus) publishes one iCalendar feed per calendar category:
 *   https://www.buncombenc.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=N
 *
 * - Recurring series arrive pre-expanded: every occurrence is its own VEVENT with its own UID and
 *   no RRULE, so there is nothing to expand.
 * - The same VEVENT (same UID) is published in several feeds - a Planning Board meeting sits in
 *   "Boards and Commission Meetings", "Planning - Upcoming Events" and "Planning Board" - and a few
 *   meetings exist twice under different UIDs, so rows are de-duplicated on UID and then on
 *   title + start.
 * - LOCATION is HTML: "<p>Venue</p> - street  City NC zip".
 *
 * Categories are allowlisted (CATEGORIES). The 2026-10-01 inventory of all 44 feeds left out:
 * holiday closings (27, 32), the JRC class schedule (30: court-ordered treatment classes), the
 * Age Friendly calendar (31: ~1,700 mechanically expanded rows to 2045, last edited May 2025, no
 * locations, mostly daily drop-in programs), foster-parent courses (54), Community Paramedics and
 * Public Health Mobile Team outreach clinics (70, 35), tax notices (55, 62), Election Services (53:
 * a superset of 29 + 60 plus office closures and deadlines), payroll/intranet (68, 69), a TEST feed
 * (72) and empty feeds.
 *
 * Early voting is published as one VEVENT per day; those collapse into ONE rolling event (see
 * buildEarlyVotingEvent) instead of ~16 near-identical rows.
 */

import * as ical from 'node-ical';
import { type ScrapedEvent } from './types';
import { BROWSER_HEADERS, debugSave } from './base';
import { createChromeDispatcher, probeAsChrome } from './fetchAsChrome';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities, isFreeEvent, tryExtractPrice } from '@/lib/utils/parsers';
import {
  formatDateEastern,
  getDateStringEastern,
  getDayBoundariesEastern,
  getTodayStringEastern,
  parseAsEastern,
} from '@/lib/utils/timezone';

const FEED_URL = 'https://www.buncombenc.gov/common/modules/iCalendar/iCalendar.aspx';
const EVENT_PAGE_URL = 'https://www.buncombenc.gov/calendar.aspx?EID=';
const EARLY_VOTING_URL = 'https://www.buncombenc.gov/216/Early-Voting';
const ELECTION_DAY_URL = 'https://www.buncombenc.gov/555/Election-Day';
const VOTER_SEARCH_URL = 'https://vt.ncsbe.gov/RegLkup/';

const ORGANIZER = 'Buncombe County';
const HORIZON_DAYS = 60;
// Placeholder clock time for DATE-only rows (stored with timeUnknown), as AVL Today does
const DATE_ONLY_TIME = '09:00:00';
const FEED_CONCURRENCY = 5;
const PAGE_CHECK_CONCURRENCY = 8;

type CategoryKind = 'civic' | 'community';

const CATEGORIES: Record<number, { name: string; kind: CategoryKind }> = {
  // Civic: elected boards, advisory boards and committees, elections
  39: { name: 'Boards and Commission Meetings', kind: 'civic' },
  29: { name: 'Election Services - Board Meeting Schedule', kind: 'civic' },
  60: { name: 'Election Services - Early Voting', kind: 'civic' },
  71: { name: 'Boards and Commissions - Planning Board', kind: 'civic' },
  42: { name: 'Boards and Commissions - Board of Adjustment', kind: 'civic' },
  37: { name: 'Planning - Upcoming Events', kind: 'civic' },
  36: { name: 'Helene Recovery and Resources Calendar', kind: 'civic' },
  38: { name: 'Air Quality', kind: 'civic' },
  41: { name: 'Early Childhood Education Committee', kind: 'civic' },
  43: { name: 'Justice Services', kind: 'civic' },
  44: { name: 'Sustainability', kind: 'civic' },
  47: { name: 'Agricultural Advisory Board', kind: 'civic' },
  48: { name: 'Audit Committee', kind: 'civic' },
  50: { name: 'School Capital Fund Commission', kind: 'civic' },
  51: { name: 'General Obligation Bonds Oversight Committee', kind: 'civic' },
  52: { name: 'Soil and Water Conservation', kind: 'civic' },
  57: { name: 'Home Community Care Block Grant Committee', kind: 'civic' },
  58: { name: 'Affordable Housing Committee', kind: 'civic' },
  59: { name: 'Passive Recreation Lands Subcommittee', kind: 'civic' },
  67: { name: 'Strategic Partnership Grants Committee', kind: 'civic' },
  // Community: public-facing county programs
  14: { name: 'Main Calendar', kind: 'community' },
  26: { name: 'Community Engagement Markets', kind: 'community' },
  40: { name: 'Parks & Recreation - General Calendar', kind: 'community' },
  56: { name: 'HHS - Public Health', kind: 'community' },
  28: { name: 'Solid Waste - Electronics & HHW Schedule', kind: 'community' },
};

// Rows inside allowlisted feeds that are not public events.
const TITLE_DENYLIST = [
  /\bbirthday\b/i, // "Hadleigh's Birthday" (a staff calendar entry in the boards feed)
  /\bmachine testing\b/i, // "Board of Elections Early Voting Machine Testing"
  /\bpay day\b/i,
  /\bholiday\b.*\bclos/i, // "Holiday Closing - ...", "Holiday - Board of Elections Closed"
  /\bdeadline\b/i, // "Voter Registration Deadline ..." - a date, not an event
  /\babsentee meeting\b/i, // Board of Elections absentee-ballot sessions, ~2 a week before elections
];

const CANCELED_PREFIX = /^\s*cancel+ed\b/i;

interface ICalValue {
  val?: string;
}

interface ICalEvent {
  type: string;
  uid?: string;
  summary?: string | ICalValue;
  description?: string | ICalValue;
  location?: string | ICalValue;
  start?: Date & { dateOnly?: boolean };
  end?: Date;
  lastmodified?: Date;
}

interface FeedEvent {
  uid: string;
  title: string;
  description: string;
  locationHtml: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  lastModified: number;
  categories: Set<number>;
}

function text(value: string | ICalValue | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.val || '';
}

/** HTML -> plain text, keeping paragraph and list-item breaks as newlines. */
function htmlToText(html: string): string {
  return html
    .split(/<\/(?:p|li|h\d|div)>|<br\s*\/?>/i)
    .map((part) => decodeHtmlEntities(part))
    .filter(Boolean)
    .join('\n');
}

/** CivicPlus appends the event page URL to every DESCRIPTION; drop it (the event links there). */
function cleanDescription(raw: string): string {
  return raw
    .replace(/\s*https?:\/\/www\.buncombenc\.gov\/calendar\.aspx\?EID=\d+\s*$/i, '')
    .split(/\n+/)
    .map((line) => htmlToText(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function cleanTitle(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/\s+@\s+/g, ' at ')
    .replace(/\s+\d{1,2}(?::\d{2})?\s*[AP]\.?M\.?$/i, '') // "Market @ Grant Center 3PM"
    .trim();
}

/**
 * The county's November 2026 Board of Commissioners meetings were entered under their CivicClerk
 * agenda names ("November 5, 2026, Regular Meeting" / "... Briefing Meeting") - the same naming the
 * Board's other agendas use. Restore the board name so the row means something in a feed.
 */
function normalizeBoardTitle(title: string, categories: Set<number>): string {
  if (!categories.has(39)) return title;
  const match = title.match(/^[A-Z][a-z]+ \d{1,2},? \d{4},?\s+(Regular|Briefing) Meeting$/);
  if (!match) return title;
  return match[1] === 'Regular'
    ? 'Board of Commissioners Meeting'
    : 'Board of Commissioners Briefing';
}

interface ParsedLocation {
  location?: string;
  zip?: string;
  remote: boolean;
  note?: string; // free text the county put in the location field
}

/** "<p>Venue</p> - street  City NC zip" -> location string, zip, and any note. */
function parseLocation(raw: string): ParsedLocation {
  const sep = raw.lastIndexOf(' - ');
  const namePart = sep >= 0 ? raw.slice(0, sep) : raw;
  let address = (sep >= 0 ? raw.slice(sep + 3) : '').replace(/\s+/g, ' ').trim();

  const paragraphs = /<p\b/i.test(namePart)
    ? [...namePart.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decodeHtmlEntities(m[1]))
    : [decodeHtmlEntities(namePart)];
  const nonEmpty = paragraphs.filter(Boolean);
  let venue = nonEmpty[0] || '';
  // "<p>Big Ivy Community Center</p><p>540 Dillingham Rd. Barnardsville NC 28709</p> - 540 Dillingham Rd."
  if (!/\b\d{5}\b/.test(address) && nonEmpty[1] && /\b\d{5}\b/.test(nonEmpty[1])) {
    address = nonEmpty[1];
  }

  let note: string | undefined;
  const allNameText = nonEmpty.join(' ');
  const links = [...namePart.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
  // Long free text ("meetings are usually held at ... check the Engage page") is a note, not a venue
  if (venue.length > 60 || /\b(online|virtual|livestream)\b/i.test(allNameText)) {
    note = nonEmpty.join('\n');
    for (const link of links) if (!note.includes(link)) note += `\n${link}`;
    venue = '';
    // "...usually held at 200 College Street in Asheville..." with only "Asheville NC 28807" as address
    const heldAt = allNameText.match(/\bheld at (\d+\s+[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*)/);
    if (heldAt && !/^\d+\s+\S/.test(address))
      address = [heldAt[1], address].filter(Boolean).join(', ');
  }

  const hasStreet = /^\d+\s+\S/.test(address);
  const remote = !hasStreet && /\b(online|virtual|livestream)\b/i.test(allNameText);
  const zip = address.match(/\b(2[78]\d{3})\b/)?.[1];

  // Not "Online"/"Virtual": the feed query hides any location matching %online% or %virtual%
  // (lib/db/queries/events.ts), which would drop these local meetings from every list.
  if (remote) return { location: 'Remote meeting', remote, note };
  const location = [venue, address].filter(Boolean).join(', ') || undefined;
  return { location, zip, remote, note };
}

function isCivic(event: FeedEvent): boolean {
  return [...event.categories].some((id) => CATEGORIES[id]?.kind === 'civic');
}

async function fetchFeed(catId: number): Promise<{ catId: number; ics: string }> {
  const url = `${FEED_URL}?feed=calendar&catID=${catId}`;
  const response = await fetchWithRetry(
    url,
    { headers: BROWSER_HEADERS, cache: 'no-store' },
    { maxRetries: 3, baseDelay: 1000 }
  );
  return { catId, ics: await response.text() };
}

async function fetchAllFeeds(): Promise<{
  feeds: { catId: number; ics: string }[];
  failed: number[];
}> {
  const ids = Object.keys(CATEGORIES).map(Number);
  const feeds: { catId: number; ics: string }[] = [];
  const failed: number[] = [];
  for (let i = 0; i < ids.length; i += FEED_CONCURRENCY) {
    const batch = ids.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchFeed));
    results.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        feeds.push(result.value);
      } else {
        failed.push(batch[j]);
        console.warn(
          `[BuncombeCounty] Feed catID=${batch[j]} failed:`,
          result.reason instanceof Error ? result.reason.message : result.reason
        );
      }
    });
  }
  return { feeds, failed };
}

/**
 * node-ical builds a DATE-only DTSTART as midnight in the *server's* zone (00:00Z on Vercel, which
 * reads as the previous day in Eastern), so read the calendar date back with local getters and
 * re-anchor it to an Eastern daytime placeholder, the way AVL Today does for date-only rows.
 */
function startOf(raw: ICalEvent & { start: Date & { dateOnly?: boolean } }): Date {
  if (!raw.start.dateOnly) return new Date(raw.start);
  const d = raw.start;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return parseAsEastern(date, DATE_ONLY_TIME);
}

/**
 * Every VEVENT across the feeds, merged by UID (one row, the union of its categories). A feed
 * node-ical cannot parse (it throws on e.g. a duplicate DTSTART) is skipped, not fatal.
 */
async function collectEvents(
  feeds: { catId: number; ics: string }[]
): Promise<{ events: FeedEvent[]; parsedFeeds: number }> {
  const byUid = new Map<string, FeedEvent>();
  let parsedFeeds = 0;
  for (const { catId, ics } of feeds) {
    let parsed: Awaited<ReturnType<typeof ical.async.parseICS>>;
    try {
      parsed = await ical.async.parseICS(ics);
    } catch (error) {
      console.warn(
        `[BuncombeCounty] Feed catID=${catId} could not be parsed, skipping:`,
        error instanceof Error ? error.message : error
      );
      continue;
    }
    parsedFeeds++;
    for (const key in parsed) {
      const raw = parsed[key] as unknown as ICalEvent;
      if (raw.type !== 'VEVENT' || !raw.start) continue;
      const uid = raw.uid || key;
      const existing = byUid.get(uid);
      if (existing) {
        existing.categories.add(catId);
        continue;
      }
      byUid.set(uid, {
        uid,
        title: cleanTitle(text(raw.summary)),
        description: cleanDescription(text(raw.description)),
        locationHtml: text(raw.location),
        start: startOf({ ...raw, start: raw.start }),
        end: raw.end && !raw.start.dateOnly ? new Date(raw.end) : undefined,
        allDay: Boolean(raw.start.dateOnly),
        lastModified: raw.lastmodified ? new Date(raw.lastmodified).getTime() : 0,
        categories: new Set([catId]),
      });
    }
  }
  return { events: [...byUid.values()], parsedFeeds };
}

// ---------------------------------------------------------------------------
// Elections
// ---------------------------------------------------------------------------

const EARLY_VOTING_CATEGORY = 60;

/**
 * "First Day of Early Voting-2026 General Election", "Early Voting-2026 General Election" and the
 * older "Last day of 2025 Municipal Election-Early Voting" all name the election the same way.
 */
function earlyVotingElection(title: string): string {
  return (
    title
      .replace(/^(?:first|last) day of\s+/i, '')
      .replace(/\bearly voting\b/i, '')
      .replace(/^[\s\-–:]+|[\s\-–:]+$/g, '')
      .trim() || 'Election'
  );
}

/** "Thu Oct 15" */
function dayLabel(date: Date): string {
  return formatDateEastern(date, { weekday: 'short', month: 'short', day: 'numeric' }).replace(
    ',',
    ''
  );
}

/** "8 AM", "7:30 PM" */
function timeLabel(date: Date): string {
  return formatDateEastern(date, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

/** YYYY-MM-DD plus N calendar days (pure date arithmetic, no time zone involved). */
function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * One event for the whole early-voting period, instead of one per day.
 *
 * `recurringType: 'daily'` was considered and rejected: the scrape route's upsert does not write
 * recurringType at all (dropped when the cron was split in Jan 2026), and where it is set the feed
 * hides the row by default behind "Show daily recurring events" and auto-scores it 5/30 - wrong
 * for the single most important civic event of the season. Instead the event "rolls": its start is
 * the next early-voting day that has not finished yet, so it sits on today's feed throughout the
 * period, and the description carries the full schedule and the site list.
 */
function buildEarlyVotingEvent(
  election: string,
  days: FeedEvent[],
  now: Date
): ScrapedEvent | null {
  const sorted = [...days].sort((a, b) => a.start.getTime() - b.start.getTime());
  const current = sorted.find((day) => (day.end ?? day.start).getTime() > now.getTime());
  if (!current) return null;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const range = `${formatDateEastern(first.start, { month: 'short', day: 'numeric' })}–${
    formatDateEastern(first.start, { month: 'short' }) ===
    formatDateEastern(last.start, { month: 'short' })
      ? formatDateEastern(last.start, { day: 'numeric' })
      : formatDateEastern(last.start, { month: 'short', day: 'numeric' })
  }`;

  // Sites: the LOCATION field holds an <ol> of "Name: address" items
  const sites = [...last.locationHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => decodeHtmlEntities(m[1]))
    .filter(Boolean);

  // Hours, grouped by identical opening times
  const groups = new Map<string, FeedEvent[]>();
  for (const day of sorted) {
    const hours = day.end ? `${timeLabel(day.start)}–${timeLabel(day.end)}` : timeLabel(day.start);
    groups.set(hours, [...(groups.get(hours) ?? []), day]);
  }
  const openKeys = new Set(sorted.map((day) => getDateStringEastern(day.start)));
  const allWeekdays: string[] = [];
  const closed: string[] = [];
  for (let t = first.start.getTime(); t <= last.start.getTime(); t += 86400000) {
    const date = new Date(t);
    const weekday = formatDateEastern(date, { weekday: 'short' });
    if (!['Sat', 'Sun'].includes(weekday)) allWeekdays.push(getDateStringEastern(date));
    if (!openKeys.has(getDateStringEastern(date))) closed.push(dayLabel(date));
  }
  const hourLines = [...groups.entries()].map(([hours, group]) => {
    const keys = group.map((day) => getDateStringEastern(day.start));
    const isAllWeekdays =
      keys.length === allWeekdays.length && allWeekdays.every((key) => keys.includes(key));
    const label = isAllWeekdays
      ? 'Weekdays'
      : group
          .map((day) => (day === last ? `${dayLabel(day.start)} (last day)` : dayLabel(day.start)))
          .join(', ');
    return `${label}: ${hours}`;
  });
  if (closed.length > 0) hourLines.push(`Closed: ${closed.join(', ')}`);

  const siteCount = sites.length > 0 ? `${sites.length} ` : '';
  const description = [
    `Vote early in the ${election} at any of Buncombe County's ${siteCount}early voting sites, ${range}. Any registered voter can use any site, and eligible residents who are not yet registered can register and vote at the same time.`,
    '',
    'Hours (all sites):',
    ...hourLines,
    ...(sites.length > 0 ? ['', 'Sites:', ...sites.map((site) => `• ${site}`)] : []),
    '',
    `Early voting plan, site lookup and wait-time map: ${EARLY_VOTING_URL}`,
  ].join('\n');

  return {
    sourceId: `bc-early-voting-${slugify(election)}`,
    source: 'BUNCOMBE_COUNTY',
    title: `Early Voting: ${election} (${range})`,
    description,
    startDate: current.start,
    location: `${siteCount}early voting sites across Buncombe County, NC`.replace(/^./, (c) =>
      c.toUpperCase()
    ),
    organizer: ORGANIZER,
    price: 'Free',
    url: `${EARLY_VOTING_URL}#${slugify(election)}`,
    timeUnknown: false,
  };
}

function buildElectionDayEvent(event: FeedEvent): ScrapedEvent {
  const where = parseLocation(event.locationHtml).location; // "80 Polling sites around the County"
  const description = [
    event.description,
    `Vote at your assigned polling place${where ? ` (${where.toLowerCase()})` : ''}. Find yours with the NC voter search: ${VOTER_SEARCH_URL}`,
    `Election Day details from Buncombe County: ${ELECTION_DAY_URL}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    sourceId: `bc-${event.uid}`,
    source: 'BUNCOMBE_COUNTY',
    title: event.title,
    description,
    startDate: event.start,
    location: 'Your assigned polling place, Buncombe County, NC',
    organizer: ORGANIZER,
    price: 'Free',
    url: `${EVENT_PAGE_URL}${event.uid}`,
    timeUnknown: event.allDay,
  };
}

// ---------------------------------------------------------------------------
// Meetings and programs
// ---------------------------------------------------------------------------

function buildEvent(event: FeedEvent): ScrapedEvent {
  const civic = isCivic(event);
  const title = normalizeBoardTitle(event.title, event.categories);
  const loc = parseLocation(event.locationHtml);

  const lines: string[] = [];
  if (civic) {
    lines.push('Public meeting on the Buncombe County government calendar.');
  } else if (event.categories.has(26)) {
    lines.push(
      "Buncombe County's Community Engagement Markets hand out food and other resources at no cost, and are open to the whole community."
    );
  }
  if (event.description) lines.push(event.description);
  if (loc.note) lines.push(loc.note);
  if (civic) lines.push('Check the county event page for the agenda and any schedule changes.');
  if (lines.length === 0) {
    lines.push(`${categoryName(event)}. Details on the Buncombe County calendar.`);
  }
  const description = lines.join('\n');

  const text = `${title}\n${event.description}`;
  // Anything still "Unknown" here gets the event page's own Cost field (see checkEventPages)
  const price =
    civic || event.categories.has(26) || saysFree(text)
      ? 'Free'
      : tryExtractPrice(text, 'Unknown', ORGANIZER);

  return {
    sourceId: `bc-${event.uid}`,
    source: 'BUNCOMBE_COUNTY',
    title,
    description,
    startDate: event.start,
    location: loc.location,
    zip: loc.zip,
    organizer: ORGANIZER,
    price,
    url: `${EVENT_PAGE_URL}${event.uid}`,
    timeUnknown: event.allDay,
  };
}

/** The most specific feed an event came from ("Main Calendar" only when it is in no other). */
function categoryName(event: FeedEvent): string {
  const ids = [...event.categories].sort((a, b) => Number(a === 14) - Number(b === 14));
  return CATEGORIES[ids[0]]?.name ?? 'Buncombe County event';
}

/** Explicit wording only ("is free", "at no cost", "no charge", "free admission") - never inferred. */
function saysFree(text: string): boolean {
  return (
    isFreeEvent(text) ||
    /\b(?:is|are) free\b|\b(?:at )?no (?:cost|charge)\b|\bfree of charge\b/i.test(text)
  );
}

/** Same meeting published under two UIDs (e.g. two "Planning Board Meeting" rows at 9:30 AM). */
function dedupeByTitleAndStart(events: FeedEvent[]): FeedEvent[] {
  const byKey = new Map<string, FeedEvent>();
  for (const event of events) {
    const key = `${event.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()}|${event.start.getTime()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      continue;
    }
    // Content from the most recently edited copy, but the identity (and so the URL, the DB's
    // unique key) is always the lowest EID: editing either copy must not mint a new row.
    const newer = event.lastModified > existing.lastModified ? event : existing;
    byKey.set(key, {
      ...newer,
      uid: lowerUid(event.uid, existing.uid),
      categories: new Set([...existing.categories, ...event.categories]),
    });
  }
  return [...byKey.values()];
}

function lowerUid(a: string, b: string): string {
  const [na, nb] = [Number(a), Number(b)];
  if (Number.isFinite(na) && Number.isFinite(nb)) return na <= nb ? a : b;
  return a <= b ? a : b;
}

export async function scrapeBuncombeCounty(): Promise<ScrapedEvent[]> {
  console.log('[BuncombeCounty] Starting scrape of CivicPlus calendar feeds...');

  const { feeds, failed } = await fetchAllFeeds();
  if (feeds.length === 0) {
    throw new Error(`All ${failed.length} Buncombe County calendar feeds failed`);
  }
  await debugSave(
    '01-feed-sizes.json',
    feeds.map((f) => ({ catId: f.catId, bytes: f.ics.length })),
    { label: 'BuncombeCounty' }
  );

  const { events: all, parsedFeeds } = await collectEvents(feeds);
  if (parsedFeeds === 0) {
    throw new Error(`None of the ${feeds.length} Buncombe County calendar feeds could be parsed`);
  }
  console.log(
    `[BuncombeCounty] ${parsedFeeds}/${feeds.length + failed.length} feeds usable, ${all.length} unique VEVENTs`
  );

  // Eastern day boundaries: a date-only row counts for all of its day, a timed one until it starts
  const now = new Date();
  const today = getTodayStringEastern();
  // Not parseAsEastern(day, '00:00:00'): that uses the noon offset, an hour off on DST days
  const startOfToday = getDayBoundariesEastern(today).start;
  const horizon = getDayBoundariesEastern(addDays(today, HORIZON_DAYS)).start;

  const results: ScrapedEvent[] = [];
  const earlyVoting = new Map<string, FeedEvent[]>();
  const candidates: FeedEvent[] = [];
  let skippedCanceled = 0;
  let skippedDenylist = 0;

  for (const event of all) {
    if (!event.title) continue;
    if (CANCELED_PREFIX.test(event.title)) {
      skippedCanceled++;
      continue;
    }
    if (TITLE_DENYLIST.some((pattern) => pattern.test(event.title))) {
      skippedDenylist++;
      continue;
    }
    if (event.categories.has(EARLY_VOTING_CATEGORY) && /\bearly voting\b/i.test(event.title)) {
      const election = earlyVotingElection(event.title);
      earlyVoting.set(election, [...(earlyVoting.get(election) ?? []), event]);
      continue;
    }
    if (event.start >= horizon || event.start < (event.allDay ? startOfToday : now)) continue;
    candidates.push(event);
  }

  for (const event of dedupeByTitleAndStart(candidates)) {
    results.push(
      /^election day\b/i.test(event.title) ? buildElectionDayEvent(event) : buildEvent(event)
    );
  }

  for (const [election, days] of earlyVoting) {
    const event = buildEarlyVotingEvent(election, days, now);
    if (event && event.startDate < horizon) results.push(event);
  }

  const published = await checkEventPages(results);
  published.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  await debugSave('02-events.json', published, { label: 'BuncombeCounty' });

  console.log(
    `[BuncombeCounty] Found ${published.length} events in the next ${HORIZON_DAYS} days (skipped ${skippedCanceled} canceled, ${skippedDenylist} non-events, ${results.length - published.length} with unpublished event pages)`
  );
  return published;
}

/**
 * One request per county event page, for two things the ICS feed does not carry.
 *
 * 1. Unpublished pages. The feeds still carry some events whose calendar page is gone (404), e.g.
 *    the Nov 12 2026 Library Advisory Board meeting. The link would be dead, and the cleanup cron
 *    never re-checks a URL the scraper keeps confirming, so drop them here. A 404/410 is only a
 *    suspicion, because a blocked request can 404 a live page (see the cleanup cron), so it is
 *    re-checked with a Chrome-handshake GET (probeAsChrome) and dropped only if that agrees.
 *    Timeouts, 5xx and network errors keep the event.
 * 2. Price. The page has a structured "Cost:" field ("Free", "$10") that the feed drops, so events
 *    still "Unknown" get a GET and take that value when it is exactly "Free" or a dollar amount.
 *    Every other page only needs a HEAD (~80ms, no body).
 */
async function checkEventPages(events: ScrapedEvent[]): Promise<ScrapedEvent[]> {
  const isGone = (status: number) => status === 404 || status === 410;
  const suspects: ScrapedEvent[] = [];
  const toCheck = events.filter((e) => e.url.startsWith(EVENT_PAGE_URL));
  for (let i = 0; i < toCheck.length; i += PAGE_CHECK_CONCURRENCY) {
    await Promise.all(
      toCheck.slice(i, i + PAGE_CHECK_CONCURRENCY).map(async (event) => {
        const needsPrice = event.price === 'Unknown';
        try {
          const response = await fetch(event.url, {
            method: needsPrice ? 'GET' : 'HEAD',
            headers: BROWSER_HEADERS,
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
          });
          if (isGone(response.status)) {
            suspects.push(event);
          } else if (needsPrice && response.ok) {
            const cost = (await response.text()).match(
              /itemprop="price"[^>]*>([\s\S]*?)<\/div>/i
            )?.[1];
            const value = cost ? decodeHtmlEntities(cost) : '';
            if (/^free$/i.test(value)) event.price = 'Free';
            else if (/^\$\d+(?:\.\d{2})?$/.test(value)) event.price = value;
          }
        } catch {
          // Unknown - keep the event as it is
        }
      })
    );
  }
  if (suspects.length === 0) return events;

  const gone = new Set<string>();
  const dispatcher = await createChromeDispatcher();
  try {
    for (const event of suspects) {
      const status = await probeAsChrome(event.url, dispatcher);
      if (isGone(status)) {
        gone.add(event.url);
        console.warn(`[BuncombeCounty] Dropping "${event.title}": ${event.url} is ${status}`);
      }
    }
  } finally {
    await dispatcher.close();
  }
  return events.filter((e) => !gone.has(e.url));
}
