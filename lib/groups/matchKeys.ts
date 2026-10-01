/**
 * How an event is matched to a group.
 *
 * Every group in the `groups` table carries `match_keys`, and an event belongs to a group when the
 * event's own key is one of them. Two kinds:
 *
 *   meetup:<urlname>               Meetup events, keyed by the group's urlname - the first path segment
 *                                  of the event URL, kept exactly as it appears there (some are
 *                                  percent-encoded, one is literally "https-www-meetup-com-hendo-fun-friends").
 *   series:<title>|<organizer>     Every other source: the normalized title plus the lowercased, trimmed
 *                                  organizer - the same (title, organizer) "unit" the 2026-09 discovery
 *                                  pass clustered on (data/groups/README.md). The title part only ever
 *                                  contains [a-z0-9 ], so the first "|" is always the separator.
 *
 * Pure functions only - no DB imports, so scripts and server code can both use this.
 */

const MONTHS =
  'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
const DATE_AFTER_MONTH = new RegExp(
  `\\b(${MONTHS})\\.?\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s*\\d{4})?\\b`,
  'g'
);

/** Lowercase, drop dates, keep only [a-z0-9] tokens, so "Trivia Night 9/17" and "Trivia Night - Sept 24th" collapse. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(DATE_AFTER_MONTH, ' ')
    .replace(/\b20\d\d\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The organizer half of a series key. Postgres prefilters must normalize the same way. */
export function normalizeOrganizer(organizer: string | null | undefined): string {
  return (organizer ?? '').trim().toLowerCase();
}

export function seriesKey(title: string, organizer: string | null | undefined): string {
  return `series:${normalizeTitle(title)}|${normalizeOrganizer(organizer)}`;
}

/**
 * The urlname segment of a meetup.com event URL, exactly as written (never decoded), or null when the
 * URL is not a meetup.com group URL. Matches the discovery pass's `split_part(url, '/', 4)`.
 */
export function meetupUrlname(url: string): string | null {
  const parts = url.split('/');
  // ['https:', '', 'www.meetup.com', '<urlname>', 'events', ...]
  if (parts.length < 4 || !/^(www\.)?meetup\.com$/i.test(parts[2] ?? '')) return null;
  const urlname = parts[3]?.split(/[?#]/)[0];
  return urlname ? urlname : null;
}

export function meetupKey(urlname: string): string {
  return `meetup:${urlname}`;
}

export interface MatchableEvent {
  title: string;
  organizer: string | null;
  source: string;
  url: string;
}

/** The single key an event can match on, or null (a MEETUP row whose URL has no urlname). */
export function eventMatchKey(event: MatchableEvent): string | null {
  if (event.source === 'MEETUP') {
    const urlname = meetupUrlname(event.url);
    return urlname ? meetupKey(urlname) : null;
  }
  return seriesKey(event.title, event.organizer);
}

/**
 * What a SQL prefilter needs to fetch every event that could match these keys: the Meetup urlnames
 * (compare to `split_part(url, '/', 4)` on MEETUP rows) and the normalized organizers (compare to the
 * normalized organizer on all other rows). Callers still confirm each row with eventMatchKey, since an
 * organizer like a venue hosts far more than the group's own series.
 */
export function prefilterValues(keys: Iterable<string>): {
  urlnames: string[];
  organizers: string[];
} {
  const urlnames = new Set<string>();
  const organizers = new Set<string>();
  for (const key of keys) {
    if (key.startsWith('meetup:')) {
      urlnames.add(key.slice('meetup:'.length));
    } else if (key.startsWith('series:')) {
      const rest = key.slice('series:'.length);
      organizers.add(rest.slice(rest.indexOf('|') + 1));
    }
  }
  return { urlnames: [...urlnames], organizers: [...organizers] };
}
