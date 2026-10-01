import { unstable_cache } from 'next/cache';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, groups } from '@/lib/db/schema';
import { eventMatchKey, prefilterValues } from '@/lib/groups/matchKeys';
import { generateEventSlug } from '@/lib/utils/slugify';
import { getStartOfTodayEastern, getTodayStringEastern } from '@/lib/utils/timezone';

/**
 * Group Directory reads (/groups and /groups/[slug]).
 *
 * Events are matched to groups at read time, not through a link table: every group carries
 * `match_keys`, and an event belongs to the group whose keys contain its `eventMatchKey`
 * (lib/groups/matchKeys.ts). Each read fetches the candidate events in ONE query using the SQL
 * prefilter below, then confirms every row in JS.
 *
 * The `query*` functions are uncached (scripts can call them directly); the `get*` wrappers cache
 * them for the pages. Everything returned is JSON-safe - ISO strings and preformatted Eastern
 * labels, never Date objects - because unstable_cache round-trips through JSON.
 */

/** How many past events a group page lists before "and N more". */
export const GROUP_PAST_EVENT_LIMIT = 50;

const GROUP_CACHE_OPTIONS = { tags: ['events', 'groups'], revalidate: 3600 };

/**
 * Part of every cache key. Bump it whenever a cached result's shape or labels change: the key is
 * otherwise the wrapper's source text plus these parts, which a change to the query never touches,
 * so entries written by the old code would keep being served until they expire.
 */
const GROUP_CACHE_SHAPE = 'v3';

const EASTERN = 'America/New_York';

// ---------------------------------------------------------------------------
// The SQL prefilter. Keep this the ONLY place the expression lives, so it can be swapped.
// It must agree with eventMatchKey / normalizeOrganizer for real data: MEETUP rows match on
// the URL's urlname segment, every other row on its normalized organizer. It over-fetches
// (a venue organizer hosts far more than one group's series) - callers confirm each row.
// ---------------------------------------------------------------------------

function textArrayParam(values: string[]): SQL {
  // sql.param keeps the array as ONE bound parameter; a bare ${values} would expand to ($1, $2, ...).
  return sql`${sql.param(values)}::text[]`;
}

function groupEventPrefilter(keys: Iterable<string>): SQL {
  const { urlnames, organizers } = prefilterValues(keys);
  return sql`(
    (${events.source} = 'MEETUP' AND split_part(${events.url}, '/', 4) = ANY(${textArrayParam(urlnames)}))
    OR (${events.source} <> 'MEETUP' AND lower(btrim(coalesce(${events.organizer}, ''), E' \\t\\r\\n\\u00a0')) = ANY(${textArrayParam(organizers)}))
  )`;
}

/** Live = what the feed shows. Every event read here needs all three. */
const liveEventFilter = and(
  sql`${events.hidden} IS NOT TRUE`,
  isNull(events.dedupedAt),
  isNull(events.deadAt)
);

// ---------------------------------------------------------------------------
// Eastern-pinned labels (Vercel runs UTC, so every formatter names the zone).
// ---------------------------------------------------------------------------

const weekdayDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const weekdayDateYearFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const dateYearFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const monthYearFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  month: 'short',
  year: 'numeric',
});
/** YYYY-MM-DD, the same shape as getTodayStringEastern(). */
const isoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: EASTERN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const monthFormat = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, month: 'short' });
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, day: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, weekday: 'short' });
const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  hour: 'numeric',
  minute: '2-digit',
});

/** Today's and tomorrow's Eastern dates as YYYY-MM-DD. Taken once per query, like the cutoff. */
interface EasternDays {
  today: string;
  tomorrow: string;
}

function easternDays(): EasternDays {
  const today = getTodayStringEastern();
  const [year, month, day] = today.split('-').map(Number);
  // Calendar arithmetic in UTC, where every day is 24h, so DST can't shift the result.
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return { today, tomorrow };
}

/** "Today" / "Tomorrow" when the event falls on one of them (Eastern), else null. */
function relativeDayLabel(date: Date, days: EasternDays): string | null {
  const iso = isoDateFormat.format(date);
  if (iso === days.today) return 'Today';
  if (iso === days.tomorrow) return 'Tomorrow';
  return null;
}

/** "Today" / "Tomorrow" / "Thu, Oct 2" */
function nextEventLabel(date: Date, days: EasternDays): string {
  return relativeDayLabel(date, days) ?? weekdayDateFormat.format(date);
}

/** "Aug 2026" */
function lastEventLabel(date: Date): string {
  return monthYearFormat.format(date);
}

/**
 * The venue half of a row's meta line: the location's leading venue name, the same trim the feed's
 * minimized row uses ("Venue, 123 Street, City" -> "Venue"). The organizer is not a fallback - on a
 * group page it is almost always the group itself.
 */
function venueName(location: string | null): string | null {
  const trimmed = location?.trim();
  if (!trimmed) return null;
  const beforeStreet = trimmed.match(/^([^,]+),\s*\d/);
  if (beforeStreet) return beforeStreet[1].trim();
  const parts = trimmed.split(',');
  return parts.length > 2 ? parts[0].trim() : trimmed;
}

// ---------------------------------------------------------------------------
// Shared matching
// ---------------------------------------------------------------------------

export interface CandidateEvent {
  id: string;
  title: string;
  organizer: string | null;
  source: string;
  url: string;
  startDate: Date;
  timeUnknown: boolean | null;
  location: string | null;
}

/** Map every match key to the group that owns it (the builder guarantees exactly one owner). */
function indexKeys<T extends { matchKeys: string[] }>(rows: T[]): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    for (const key of row.matchKeys) byKey.set(key, row);
  }
  return byKey;
}

/**
 * The one candidate query: live events that could belong to any of these keys. Exported so the seed
 * script's parity check exercises this exact query rather than a copy of it.
 */
export async function fetchCandidateEvents(keys: string[]): Promise<CandidateEvent[]> {
  if (keys.length === 0) return [];

  return db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      source: events.source,
      url: events.url,
      startDate: events.startDate,
      timeUnknown: events.timeUnknown,
      location: events.location,
    })
    .from(events)
    .where(and(liveEventFilter, groupEventPrefilter(keys)));
}

/** Ascending by start, ties by id, so the order is stable across renders. */
function byStartThenId(a: CandidateEvent, b: CandidateEvent): number {
  return a.startDate.getTime() - b.startDate.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

export interface GroupDirectoryEntry {
  slug: string;
  name: string;
  description: string | null;
  category: string;
  homeBase: string | null;
  upcomingCount: number;
  /** Live past events on record (the directory ranks by upcoming + 0.5 x past). */
  pastCount: number;
  /** Soonest upcoming event, "Today" / "Tomorrow" / "Thu, Oct 2"; null when nothing is upcoming. */
  nextEventLabel: string | null;
  /** Most recent past event, "Aug 2026"; null when no past event is on record. */
  lastEventLabel: string | null;
}

/** Every non-hidden group, including ones with no live events, sorted by name. */
export async function queryGroupDirectory(): Promise<GroupDirectoryEntry[]> {
  const cutoff = getStartOfTodayEastern();
  const days = easternDays();

  const groupRows = await db
    .select({
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      category: groups.category,
      homeBase: groups.homeBase,
      matchKeys: groups.matchKeys,
    })
    .from(groups)
    .where(eq(groups.hidden, false))
    .orderBy(asc(groups.name), asc(groups.slug));

  const groupByKey = indexKeys(groupRows);
  const candidates = await fetchCandidateEvents([...groupByKey.keys()]);

  const stats = new Map<
    string,
    { upcoming: number; past: number; next: Date | null; last: Date | null }
  >();
  for (const event of candidates) {
    const key = eventMatchKey(event);
    const group = key ? groupByKey.get(key) : undefined;
    if (!group) continue;

    const entry = stats.get(group.slug) ?? { upcoming: 0, past: 0, next: null, last: null };
    if (event.startDate >= cutoff) {
      entry.upcoming += 1;
      if (!entry.next || event.startDate < entry.next) entry.next = event.startDate;
    } else {
      entry.past += 1;
      if (!entry.last || event.startDate > entry.last) entry.last = event.startDate;
    }
    stats.set(group.slug, entry);
  }

  return groupRows.map((group) => {
    const entry = stats.get(group.slug);
    return {
      slug: group.slug,
      name: group.name,
      description: group.description,
      category: group.category,
      homeBase: group.homeBase,
      upcomingCount: entry?.upcoming ?? 0,
      pastCount: entry?.past ?? 0,
      nextEventLabel: entry?.next ? nextEventLabel(entry.next, days) : null,
      lastEventLabel: entry?.last ? lastEventLabel(entry.last) : null,
    };
  });
}

export function getGroupDirectory(): Promise<GroupDirectoryEntry[]> {
  // Built per call so the Eastern date is part of the key: after midnight a fresh entry is
  // computed, so yesterday's events never read as upcoming.
  return unstable_cache(
    () => queryGroupDirectory(),
    ['group-directory', GROUP_CACHE_SHAPE, getTodayStringEastern()],
    GROUP_CACHE_OPTIONS
  )();
}

// ---------------------------------------------------------------------------
// Group page
// ---------------------------------------------------------------------------

export interface GroupEventRowData {
  id: string;
  /** /events/<slug> */
  href: string;
  title: string;
  /** Date badge: "Oct" */
  monthLabel: string;
  /** Date badge: "2" */
  dayLabel: string;
  /**
   * Upcoming: "Thu · 7:00 PM" / "Thu · Time TBD", with "Today" / "Tomorrow" in place of the
   * weekday. Past: "Thu, Aug 14, 2025".
   */
  whenLabel: string;
  venue: string | null;
}

export interface GroupPageData {
  slug: string;
  name: string;
  description: string | null;
  category: string;
  website: string | null;
  meetupUrl: string | null;
  schedule: string | null;
  homeBase: string | null;
  /** Ascending. */
  upcoming: GroupEventRowData[];
  /** Newest first, capped at GROUP_PAST_EVENT_LIMIT. */
  past: GroupEventRowData[];
  /** Every past event on record, so the page can say "and N more". */
  pastTotal: number;
  /** Most recent past event, "Aug 14, 2025"; null when no past event is on record. */
  lastEventLabel: string | null;
}

/** `days` is only read for upcoming rows; past rows always carry the full date. */
function toRow(event: CandidateEvent, isPast: boolean, days: EasternDays): GroupEventRowData {
  const whenLabel = isPast
    ? weekdayDateYearFormat.format(event.startDate)
    : `${relativeDayLabel(event.startDate, days) ?? weekdayFormat.format(event.startDate)} · ${
        event.timeUnknown ? 'Time TBD' : timeFormat.format(event.startDate)
      }`;

  return {
    id: event.id,
    href: `/events/${generateEventSlug(event.title, event.startDate, event.id)}`,
    title: event.title.trim(),
    monthLabel: monthFormat.format(event.startDate),
    dayLabel: dayFormat.format(event.startDate),
    whenLabel,
    venue: venueName(event.location),
  };
}

/** Group slugs are cleanTitle output ([a-z0-9-]); anything else is a miss, not a query. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** One non-hidden group with its matched events, or null when it is missing or hidden. */
export async function queryGroupPage(slug: string): Promise<GroupPageData | null> {
  if (!SLUG_PATTERN.test(slug)) return null;

  const cutoff = getStartOfTodayEastern();
  const days = easternDays();

  const [group] = await db
    .select({
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      category: groups.category,
      website: groups.website,
      meetupUrl: groups.meetupUrl,
      schedule: groups.schedule,
      homeBase: groups.homeBase,
      matchKeys: groups.matchKeys,
    })
    .from(groups)
    .where(and(eq(groups.slug, slug), eq(groups.hidden, false)))
    .limit(1);

  if (!group) return null;

  const keys = new Set(group.matchKeys);
  const matched = (await fetchCandidateEvents(group.matchKeys)).filter((event) => {
    const key = eventMatchKey(event);
    return key !== null && keys.has(key);
  });

  const upcomingEvents = matched.filter((event) => event.startDate >= cutoff).sort(byStartThenId);
  const pastEvents = matched
    .filter((event) => event.startDate < cutoff)
    // Newest first; ties keep ascending id like everywhere else.
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime() || byStartThenId(a, b));

  return {
    slug: group.slug,
    name: group.name,
    description: group.description,
    category: group.category,
    website: group.website,
    meetupUrl: group.meetupUrl,
    schedule: group.schedule,
    homeBase: group.homeBase,
    upcoming: upcomingEvents.map((event) => toRow(event, false, days)),
    past: pastEvents.slice(0, GROUP_PAST_EVENT_LIMIT).map((event) => toRow(event, true, days)),
    pastTotal: pastEvents.length,
    lastEventLabel: pastEvents[0] ? dateYearFormat.format(pastEvents[0].startDate) : null,
  };
}

export function getGroupPage(slug: string): Promise<GroupPageData | null> {
  return unstable_cache(
    () => queryGroupPage(slug),
    ['group-page', GROUP_CACHE_SHAPE, slug, getTodayStringEastern()],
    GROUP_CACHE_OPTIONS
  )();
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

/** Every non-hidden group page, with when its listing last changed. */
export async function queryGroupSitemapEntries(): Promise<{ slug: string; updatedAt: Date }[]> {
  return db
    .select({ slug: groups.slug, updatedAt: groups.updatedAt })
    .from(groups)
    .where(eq(groups.hidden, false))
    .orderBy(asc(groups.slug));
}
