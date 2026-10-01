/**
 * City of Asheville water notices: fetch the Everbridge alerts feed and decide
 * which notices amount to a major water issue right now.
 *
 * The feed (what ashevillenc.gov/service/water-quality-advisories/ renders) is a
 * rolling ~2-week list of {notificationId, startDate, startDateEpoch, title,
 * textMessage, categories}. It has no end times and no status field, so
 * "active" is inferred, deliberately simply. The badge means a genuinely major
 * issue (Matt's call: boil-water, scheduled shutdowns, major outages):
 *
 * - Boil-water advisories always count: until lifted, at most 14 days. A false
 *   all-clear here is the worst error, so any doubt resolves toward showing it.
 * - Scheduled interruptions count during their stated shutdown window ("This
 *   shutdown is scheduled for <date> from 7PM to 6AM", "...has been extended to
 *   11 AM"), or for their whole scheduled Eastern day when no window is stated.
 * - Unplanned outages count only with evidence of a large impact: a water main
 *   break, a title naming several streets, or "Number Affected" >= 200. Single-
 *   address repairs (most of the feed) never carry a count; the two counts seen
 *   in two weeks were 274 (a scheduled shutdown) and 1,064 (a main break).
 *   They count until lifted, at most 24 hours.
 * - A lift ("Lift of ...", "... Lifted") is recognized from its title and
 *   categories only, never its body. It clears earlier notices of the same kind
 *   at the same location (boil: the exact location; outages: the same street,
 *   house number ignored), or all of that kind if it says citywide. A lift
 *   whose location can't be read clears nothing.
 * - Routine "Valve Assessment" contractor checks are never outages. That
 *   exclusion never applies to a boil-water notice.
 *
 * The rule is pure with an explicit `now`, so it can be replayed over a saved
 * copy of the feed to see how often the badge would have shown.
 */

import { unstable_cache } from 'next/cache';
import { getDayBoundariesEastern, parseAsEastern } from '@/lib/utils/timezone';
import type { WaterNotice, WaterNoticeKind, WaterStatus } from './types';

export const WATER_ALERTS_URL =
  'https://xvl6na3ozhw4wlikndho6434pq0arwue.lambda-url.us-east-1.on.aws/getAlerts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const OUTAGE_MAX_AGE_MS = 24 * HOUR_MS;
export const BOIL_MAX_AGE_MS = 14 * DAY_MS;
/** Cached feed data older than this is "unavailable", never an all-clear. */
export const WATER_FEED_MAX_AGE_MS = 20 * 60 * 1000;
/** An unplanned outage reporting at least this many affected customers is major. */
export const MAJOR_OUTAGE_MIN_AFFECTED = 200;

export interface RawWaterAlert {
  notificationId: string;
  startDateEpoch: number;
  title: string;
  textMessage: string;
  categories: string[];
}

export interface WaterFeed {
  alerts: RawWaterAlert[];
  /** When the feed was fetched (epoch ms) */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** One uncached, time-boxed read of the feed. Throws on anything unusable. */
async function requestWaterFeed(): Promise<WaterFeed> {
  const res = await fetch(WATER_ALERTS_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`water feed HTTP ${res.status}`);
  return { alerts: parseWaterAlerts(await res.json()), fetchedAt: Date.now() };
}

/**
 * The validated feed, cached for 5 minutes. Throwing keeps a bad response out of
 * the cache; a stale entry left behind by failing refreshes is caught by the
 * max-age check in fetchWaterFeed.
 */
const getCachedWaterFeed = unstable_cache(requestWaterFeed, ['city-status-water-feed-v2'], {
  revalidate: 300,
});

/** The feed if we have a valid copy younger than WATER_FEED_MAX_AGE_MS, else null. */
export async function fetchWaterFeed(now: number): Promise<WaterFeed | null> {
  try {
    let feed = await getCachedWaterFeed();
    // A quiet spell leaves an old entry behind: read the feed directly once
    if (now - feed.fetchedAt > WATER_FEED_MAX_AGE_MS) feed = await requestWaterFeed();
    return now - feed.fetchedAt <= WATER_FEED_MAX_AGE_MS ? feed : null;
  } catch (error) {
    console.warn('[city-status] water alerts feed failed:', error);
    return null;
  }
}

/** Lowercase, with hyphens/slashes/underscores as spaces: "Boil-Water" -> "boil water" */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_/–]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const ROAD_RE = /\broad closures?\b/;

/**
 * Validate the feed. Road-closure items that are malformed are dropped, but a
 * malformed item that could be a water notice throws: the whole feed is then
 * "unavailable" rather than a possible false all-clear.
 */
export function parseWaterAlerts(json: unknown): RawWaterAlert[] {
  if (!Array.isArray(json)) throw new Error('water feed is not an array');
  const alerts: RawWaterAlert[] = [];
  for (const item of json as unknown[]) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const categories = Array.isArray(r.categories)
      ? r.categories.filter((c): c is string => typeof c === 'string')
      : typeof r.categories === 'string'
        ? [r.categories]
        : [];
    const epoch =
      typeof r.startDateEpoch === 'number' ? r.startDateEpoch : Number(r.startDateEpoch);
    if (!Number.isFinite(epoch) || typeof r.title !== 'string') {
      const roadOnly = categories.length > 0 && categories.every((c) => ROAD_RE.test(norm(c)));
      if (roadOnly) continue;
      throw new Error('malformed water notice in feed');
    }
    alerts.push({
      notificationId:
        typeof r.notificationId === 'string' || typeof r.notificationId === 'number'
          ? String(r.notificationId)
          : `${epoch}:${r.title}`,
      startDateEpoch: epoch,
      title: r.title,
      textMessage: typeof r.textMessage === 'string' ? r.textMessage : '',
      categories,
    });
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const BOIL_RE = /\bboil(?:ing)? (?:your )?water\b|\bboil (?:advisory|notice|order)\b/;
const OUTAGE_RE = /\bwater\b|\bpressure\b|\boutage\b|\binterruption\b/;
/** Affirmative lift wording, in the title only */
const LIFT_RE = /^(?:update ?:? )?lift(?:ing)? of\b|\b(?:lifted|rescinded|cancell?ed|all clear)\b/;
/** "has not yet been lifted", "isn't lifted", "remains in effect" */
const NOT_LIFTED_RE =
  /(?:\bnot|n['’]t) (?:yet )?(?:been )?(?:lifted|rescinded|cancell?ed)\b|\b(?:remains?|still) in effect\b/;
const CITYWIDE_RE =
  /\b(?:city ?wide|system ?wide|all (?:city of asheville )?(?:water )?customers|entire (?:city|water system|system|service area))\b/;
const MAIN_BREAK_RE =
  /\bwater main break\b|\bmain break\b|\bbreak in (?:a |the )?(?:large )?(?:water )?main\b/;

// ---------------------------------------------------------------------------
// Locations (exact matching only)
// ---------------------------------------------------------------------------

const MONTH_DATE_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/i;
const NUMERIC_DATE_RE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/;
const TIME_SRC = String.raw`\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?|\bnoon\b|\bmidnight\b`;
const TIME_RE = new RegExp(TIME_SRC, 'i');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "[Location]"-style template leftovers the city sometimes sends unfilled */
const PLACEHOLDER_RE = /^(?:location|date|time|address|area|#)$/i;

/** The notice-type wording in titles, stripped to leave the location */
const TITLE_TYPE_RE = new RegExp(
  [
    String.raw`^\s*update\s*[-:–]\s*`,
    String.raw`\blift(?:ed)?\s+of\b`,
    String.raw`\bvalve assessment\b\s*[-–]?\s*(?:city of asheville\s+)?(?:contractor)?`,
    String.raw`\bschedul(?:e|ed)\s+water\s+(?:interruption|outage|shutdown)`,
    String.raw`\bboil[-\s]+water\s+(?:advisory|notice)(?:\s+(?:lifted|rescinded))?`,
    String.raw`\bpotential\b`,
    String.raw`\blow\s+pressure\b`,
    String.raw`\bno\s+water\b`,
    String.raw`\bdiscolou?red\s+water\b`,
    String.raw`\bnotification\b`,
  ].join('|'),
  'gi'
);

/** Where a title's location ends and its date/time begins */
const TITLE_CUT_RE =
  /\s(?:on|at)\s|@|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i;

function looksLikeDateOrTime(s: string): boolean {
  return (
    MONTH_DATE_RE.test(s) ||
    NUMERIC_DATE_RE.test(s) ||
    /^\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?\s*$/i.test(s) ||
    (TIME_RE.test(s) && s.length < 12)
  );
}

/** The location a title names, e.g. "75 Rumbough Place", or null. */
export function titleLocation(title: string): string | null {
  const brackets = [...title.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  if (brackets.length > 0) {
    // Filled templates bracket each field: [location] on [date] @ [time]
    return brackets.find((b) => !PLACEHOLDER_RE.test(b) && !looksLikeDateOrTime(b)) ?? null;
  }
  // What's left of "Potential Low Pressure/No Water/ Discolored Water @" is slashes and an @
  const lead = title
    .replace(TITLE_TYPE_RE, ' ')
    .replace(/^[\s/@:,–-]*(?:(?:at|on|for|in)\s+)?/i, '');
  const cut = lead.search(TITLE_CUT_RE);
  const location = (cut >= 0 ? lead.slice(0, cut) : lead).replace(/[\s,.;:–-]+$/, '').trim();
  return location.length >= 3 ? location : null;
}

const STREET_ABBREVIATIONS: Record<string, string> = {
  avenue: 'ave',
  road: 'rd',
  street: 'st',
  drive: 'dr',
  circle: 'cir',
  place: 'pl',
  lane: 'ln',
  boulevard: 'blvd',
  parkway: 'pkwy',
  highway: 'hwy',
  court: 'ct',
  terrace: 'ter',
  mount: 'mt',
};

/**
 * The comparable form of a location: "Wood Avenue" and "[Wood Ave]" both become
 * "wood ave". Nothing is split or partially matched, so "Haw Creek Rd" never
 * clears "Old Haw Creek Rd" and a one-street lift never clears a multi-street
 * notice.
 */
export function locationKey(location: string | null): string | null {
  if (!location) return null;
  const key = location
    .toLowerCase()
    .replace(/\b(?:and|&)\s+(?:all\s+)?surrounding\s+areas?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => STREET_ABBREVIATIONS[word] ?? word)
    .join(' ');
  return key.length >= 3 ? key : null;
}

/** How many places a title's location names: "Starnes Cove Rd, Holbrook Rd" -> 2 */
function placeCount(location: string | null): number {
  if (!location) return 0;
  return location
    .replace(/\b(?:and|&)\s+(?:all\s+)?surrounding\s+areas?\b/gi, '')
    .split(/,|;|&|\band\b/i)
    .filter((part) => /[a-z]{3}/i.test(part)).length;
}

/** The affected area as the message words it, for display only. */
function messageArea(text: string): string | null {
  const patterns = [
    /affected areas? (?:are|is)\s*,?\s*([^\n]+?)(?:\.(?:\s|$)|\n|$)/i,
    /working in the area of\s+([^\n]+?)(?:\.(?:\s|$)|\n|$)/i,
    /will occur at\s+(.+?)\s+on\s/i,
  ];
  for (const re of patterns) {
    const area = text.match(re)?.[1]?.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
    if (area && area.length >= 3) return area;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates and the scheduled window (Eastern calendar dates)
// ---------------------------------------------------------------------------

function toDateString(year: number, month: number, day: number): string {
  // Date.UTC normalizes overflow (Sep 31 -> Oct 1) on the calendar, not the clock
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return toDateString(y, m, d + 1);
}

function easternDateString(epoch: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(epoch));
}

/** The first date written in `text`, as YYYY-MM-DD, with the year inferred from `posted`. */
function findDate(text: string, posted: number): string | null {
  const named = text.match(MONTH_DATE_RE);
  const numeric = text.match(NUMERIC_DATE_RE);
  let month: number;
  let day: number;
  let year: number | null = null;
  if (named && (!numeric || (named.index ?? 0) <= (numeric.index ?? 0))) {
    month = MONTHS.indexOf(named[1].toLowerCase().slice(0, 3)) + 1;
    day = Number(named[2]);
    if (named[3]) year = Number(named[3]);
  } else if (numeric) {
    month = Number(numeric[1]);
    day = Number(numeric[2]);
    year = Number(numeric[3]) + (numeric[3].length === 2 ? 2000 : 0);
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year === null) {
    year = Number(easternDateString(posted).slice(0, 4));
    // Posted in late December about early January
    if (Date.UTC(year, month - 1, day) < posted - 180 * DAY_MS) year += 1;
  }
  return toDateString(year, month, day);
}

/** "8:00 AM" / "7PM" / "4:30 p.m." -> "HH:MM:00" */
function clockTime(match: RegExpMatchArray): string | null {
  const word = match[0].toLowerCase();
  if (word === 'noon') return '12:00:00';
  if (word === 'midnight') return '00:00:00';
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = match[3].toLowerCase() === 'p';
  if (pm && hour !== 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

interface ScheduledWindow {
  start: number;
  end: number;
  /** No shutdown hours stated: the window is the whole scheduled day */
  allDay: boolean;
}

/**
 * When planned work is on: the hours in the message's own shutdown sentence
 * ("This shutdown is scheduled for ... from 7PM to 6AM", "This shutdown has been
 * extended to 11 AM", start from the title's "@ 7 AM"), read only from that
 * sentence's paragraph so the office-hours footer ("from 8 AM to 5 PM") can never
 * be mistaken for it. Without stated hours, the whole scheduled Eastern day.
 */
function scheduledWindow(alert: RawWaterAlert): ScheduledWindow | null {
  const scheduledFor = alert.textMessage.match(/scheduled for\s+([^\n]+)/i)?.[1];
  const date =
    findDate(alert.title.replace(/[[\]]/g, ' '), alert.startDateEpoch) ??
    (scheduledFor ? findDate(scheduledFor, alert.startDateEpoch) : null);
  if (!date) return null;

  const day = getDayBoundariesEastern(date);
  const allDay = { start: day.start.getTime(), end: day.end.getTime() + 1, allDay: true };

  const sentence = alert.textMessage.match(
    /\b(?:shutdown|interruption|outage)\s+(?:is|has been|will be)\s+(?:scheduled|extended)[^\n]*/i
  )?.[0];
  if (!sentence) return allDay;
  const times = [...sentence.matchAll(new RegExp(TIME_SRC, 'gi'))].map(clockTime);
  const titleTime = [
    ...alert.title.split('@').slice(1).join(' ').matchAll(new RegExp(TIME_SRC, 'gi')),
  ]
    .map(clockTime)
    .find(Boolean);

  const extended = /\bextended\b/i.test(sentence);
  const startTime = extended ? titleTime : times[0];
  const endTime = extended ? times[times.length - 1] : times[1];
  if (!startTime || !endTime) return allDay;

  const start = parseAsEastern(date, startTime).getTime();
  let end = parseAsEastern(date, endTime).getTime();
  // Overnight work ("from 7PM to 6AM") ends on the next calendar date
  if (end <= start) end = parseAsEastern(nextDate(date), endTime).getTime();
  return { start, end, allDay: false };
}

// ---------------------------------------------------------------------------
// Classification + the active rule
// ---------------------------------------------------------------------------

interface ClassifiedAlert {
  raw: RawWaterAlert;
  kind: WaterNoticeKind;
  posted: number;
  isLift: boolean;
  isCitywide: boolean;
  isRoutine: boolean;
  /** Unplanned outage with evidence of a large impact */
  isMajor: boolean;
  /** Scheduled interruptions whose date could be read */
  window: ScheduledWindow | null;
  location: string | null;
  key: string | null;
  /** The key without a leading house number, for matching outage lifts */
  streetKey: string | null;
}

function classify(raw: RawWaterAlert): ClassifiedAlert | null {
  const categories = norm(raw.categories.join(' | '));
  const title = norm(raw.title);
  const body = norm(raw.textMessage);
  const roadOnly =
    (raw.categories.length > 0 && raw.categories.every((c) => ROAD_RE.test(norm(c)))) ||
    ROAD_RE.test(title);

  // A lift is recognized from its title alone, and its kind from its title and
  // categories alone: an outage lift whose body says "the boil water advisory
  // remains in effect" must not clear that advisory.
  const isLift = LIFT_RE.test(title.trim()) && !NOT_LIFTED_RE.test(title);
  const kind: WaterNoticeKind | null = isLift
    ? BOIL_RE.test(`${categories} ${title}`)
      ? 'boil'
      : roadOnly || !OUTAGE_RE.test(`${categories} ${title}`)
        ? null
        : 'outage'
    : BOIL_RE.test(`${categories} ${title} ${body}`)
      ? 'boil'
      : roadOnly || !OUTAGE_RE.test(`${categories} ${title}`)
        ? null
        : 'outage';
  if (!kind) return null;

  const isRoutine =
    kind === 'outage' &&
    (/\bvalve assessment\b/.test(title) || /performing checks on system infrastructure/.test(body));
  const isScheduled =
    kind === 'outage' &&
    (/\bscheduled outage\b/.test(categories) ||
      /\bschedul(?:e|ed) water (?:interruption|outage|shutdown)\b/.test(title));
  const location = titleLocation(raw.title);
  const key = locationKey(location);
  const affected = Number(
    raw.textMessage.match(/number affected:?\s*(\d[\d,]*)/i)?.[1]?.replace(/,/g, '') ?? 0
  );

  return {
    raw,
    kind,
    posted: raw.startDateEpoch,
    isLift,
    isCitywide: isLift && CITYWIDE_RE.test(`${title} ${body}`),
    isRoutine,
    isMajor:
      kind === 'outage' &&
      (MAIN_BREAK_RE.test(`${title} ${body}`) ||
        affected >= MAJOR_OUTAGE_MIN_AFFECTED ||
        placeCount(location) >= 2),
    window: isScheduled && !isLift ? scheduledWindow(raw) : null,
    location,
    key,
    streetKey: key ? key.replace(/^\d+[a-z]?\s+/, '') : null,
  };
}

function isLiftedBy(notice: ClassifiedAlert, lift: ClassifiedAlert): boolean {
  if (lift.kind !== notice.kind || lift.posted <= notice.posted) return false;
  if (lift.isCitywide) return true;
  // An unreadable location on either side clears nothing
  if (notice.kind === 'boil') return lift.key !== null && lift.key === notice.key;
  return lift.streetKey !== null && lift.streetKey === notice.streetKey;
}

function isActive(notice: ClassifiedAlert, lifts: ClassifiedAlert[], now: number): boolean {
  if (notice.posted > now || notice.isRoutine) return false;
  if (lifts.some((lift) => lift.posted <= now && isLiftedBy(notice, lift))) return false;

  if (notice.kind === 'boil') return now - notice.posted <= BOIL_MAX_AGE_MS;
  if (notice.window) return now >= notice.window.start && now < notice.window.end;
  return notice.isMajor && now - notice.posted <= OUTAGE_MAX_AGE_MS;
}

/** A template field the city left unfilled, e.g. "[Date & Time Written Out]", "[#]" */
const UNFILLED_FIELD_RE = /\[(?:location|date|time|address|area|#|[^\]]*written out[^\]]*)\]/i;

/**
 * The message as readers should see it: template brackets removed ("[75 Rumbough
 * Place]" -> "75 Rumbough Place"), sentences built around an unfilled field and
 * the internal "Issued By" / "Sent BY" / "Number Affected" lines dropped, and
 * (like the city's page) runs of 3+ newlines collapsed to a paragraph break.
 */
function cleanMessage(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*(?:issued by|sent by|number affected)\b.*$/gim, '')
    .replace(new RegExp(String.raw`[^.\n]*${UNFILLED_FIELD_RE.source}[^.\n]*\.?`, 'gi'), '')
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PLACE_ABBREVIATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(STREET_ABBREVIATIONS).map(([word, abbr]) => [
    word,
    abbr.charAt(0).toUpperCase() + abbr.slice(1),
  ])
);

/**
 * A short place for the badge: "75 Rumbough Place" -> "Rumbough Pl",
 * "Haw Creek and surrounding areas" -> "Haw Creek", "Starnes Cove Rd, Holbrook Rd"
 * -> "Starnes Cove Rd". Display only; matching uses locationKey.
 */
export function shortPlace(location: string | null): string | null {
  if (!location) return null;
  const first = location
    .replace(/[[\]]/g, '')
    .replace(/\b(?:and|&)\s+(?:all\s+)?surrounding\s+areas?\b/gi, '')
    .split(/,|;|&|\band\b/i)[0]
    .trim()
    .replace(/^\d+[a-z]?\s+/i, '')
    .split(/\s+/)
    .map((word) => PLACE_ABBREVIATIONS[word.toLowerCase()] ?? word)
    .join(' ');
  return first.length >= 3 ? first : null;
}

function toNotice(alert: ClassifiedAlert): WaterNotice {
  return {
    id: alert.raw.notificationId,
    kind: alert.kind,
    area: messageArea(alert.raw.textMessage) ?? alert.location,
    place: shortPlace(alert.location ?? messageArea(alert.raw.textMessage)),
    postedAt: new Date(alert.posted).toISOString(),
    scheduled: alert.window
      ? {
          start: new Date(alert.window.start).toISOString(),
          end: new Date(alert.window.end).toISOString(),
          allDay: alert.window.allDay,
        }
      : null,
    message: cleanMessage(alert.raw.textMessage),
  };
}

/**
 * The active water notices at `now`, boil-water first, then newest first.
 * Returns null when nothing is active.
 */
export function getActiveWaterStatus(alerts: RawWaterAlert[], now: number): WaterStatus | null {
  const byId = new Map<string, ClassifiedAlert>();
  for (const raw of alerts) {
    const alert = classify(raw);
    if (alert) byId.set(raw.notificationId, alert);
  }
  const classified = [...byId.values()];
  const lifts = classified.filter((a) => a.isLift);

  const active = classified.filter((a) => !a.isLift && isActive(a, lifts, now));
  if (active.length === 0) return null;

  // Collapse only true repeats, always within one kind: an identical message (the
  // city sometimes resends one with an unfilled "[Location]" title), then the same
  // exact location (an "Update - ..." for one place). Anything without a message
  // or a readable location stands alone.
  const message = (a: ClassifiedAlert) => a.raw.textMessage.replace(/\s+/g, ' ').trim();
  const repeats = newestBy(active, (a) => (message(a) ? `${a.kind}|${message(a)}` : null));
  const notices = newestBy(repeats, (a) => (a.key ? `${a.kind}|${a.key}` : null))
    .sort((a, b) => (a.kind === b.kind ? b.posted - a.posted : a.kind === 'boil' ? -1 : 1))
    .map(toNotice);

  return { level: notices.some((n) => n.kind === 'boil') ? 'boil' : 'outage', notices };
}

/** Keep the newest alert per group; a null group keeps the alert as its own. */
function newestBy(
  alerts: ClassifiedAlert[],
  groupOf: (a: ClassifiedAlert) => string | null
): ClassifiedAlert[] {
  const newest = new Map<string, ClassifiedAlert>();
  for (const alert of alerts) {
    const group = groupOf(alert) ?? `id|${alert.raw.notificationId}`;
    const current = newest.get(group);
    if (!current || alert.posted > current.posted) newest.set(group, alert);
  }
  return [...newest.values()];
}
