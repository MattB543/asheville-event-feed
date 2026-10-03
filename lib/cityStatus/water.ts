/**
 * City of Asheville water notices: fetch the Everbridge alerts feed and decide
 * which notices amount to a major water issue right now.
 *
 * The feed (what ashevillenc.gov/service/water-quality-advisories/ renders) is a
 * rolling ~2-week list of {notificationId, startDate, startDateEpoch, title,
 * textMessage, categories}. It has no end times and no status field, so
 * "active" is inferred, deliberately simply. The badge means a serious issue
 * affecting roughly 1,000+ people (Matt's call, 2026-10-03; nothing scheduled):
 *
 * - Boil-water advisories always count: until lifted, at most 14 days. A false
 *   all-clear here is the worst error, so any doubt resolves toward showing it.
 * - Planned work never counts: scheduled interruptions, "Informational"
 *   construction notices, and routine "Valve Assessment" contractor checks.
 *   That exclusion never applies to a boil-water notice.
 * - Unplanned outages count only when the message reports "Number Affected" >=
 *   1,000, the only size the feed states. Single-address repairs (most of the
 *   feed) never carry a count; the two counts seen in two weeks were 274 (a
 *   scheduled shutdown) and 1,064 (the Starnes Cove main break). Street count
 *   and "main break" wording are not used: neither says how many people are
 *   affected, and a two-street construction notice passed the first.
 *   They count until lifted, at most 24 hours.
 * - A lift ("Lift of ...", "... Lifted") is recognized from its title and
 *   categories only, never its body. It clears earlier notices of the same kind
 *   at the same location (boil: the exact location; outages: the same street,
 *   house number ignored), or all of that kind if it says citywide. A lift
 *   whose location can't be read clears nothing.
 *
 * The rule is pure with an explicit `now`, so it can be replayed over a saved
 * copy of the feed to see how often the badge would have shown.
 */

import { unstable_cache } from 'next/cache';
import type { WaterNotice, WaterNoticeKind, WaterStatus } from './types';

export const WATER_ALERTS_URL =
  'https://xvl6na3ozhw4wlikndho6434pq0arwue.lambda-url.us-east-1.on.aws/getAlerts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const OUTAGE_MAX_AGE_MS = 24 * HOUR_MS;
export const BOIL_MAX_AGE_MS = 14 * DAY_MS;
/** Cached feed data older than this is "unavailable", never an all-clear. */
export const WATER_FEED_MAX_AGE_MS = 20 * 60 * 1000;
/** An unplanned outage reporting at least this many affected is major. */
export const MAJOR_OUTAGE_MIN_AFFECTED = 1000;

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
/** Planned work: never shown, however large */
const SCHEDULED_TITLE_RE =
  /\bschedul(?:e|ed) water (?:interruption|outage|shutdown)\b|\binformational\b/;

// ---------------------------------------------------------------------------
// Locations (exact matching only)
// ---------------------------------------------------------------------------

const MONTH_DATE_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/i;
const NUMERIC_DATE_RE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?|\bnoon\b|\bmidnight\b/i;

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
// Classification + the active rule
// ---------------------------------------------------------------------------

interface ClassifiedAlert {
  raw: RawWaterAlert;
  kind: WaterNoticeKind;
  posted: number;
  isLift: boolean;
  isCitywide: boolean;
  /** Scheduled, informational or routine work: never shown */
  isPlanned: boolean;
  /** Unplanned outage reporting at least MAJOR_OUTAGE_MIN_AFFECTED affected */
  isMajor: boolean;
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

  const isPlanned =
    kind === 'outage' &&
    (/\bscheduled outage\b/.test(categories) ||
      SCHEDULED_TITLE_RE.test(title) ||
      /\bvalve assessment\b/.test(title) ||
      /performing checks on system infrastructure/.test(body));
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
    isPlanned,
    isMajor: kind === 'outage' && affected >= MAJOR_OUTAGE_MIN_AFFECTED,
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
  if (notice.posted > now || notice.isPlanned) return false;
  if (lifts.some((lift) => lift.posted <= now && isLiftedBy(notice, lift))) return false;

  if (notice.kind === 'boil') return now - notice.posted <= BOIL_MAX_AGE_MS;
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
