import { extractCity } from './geo';

// Short venue names for listings, shared by the playlist page and event cards

/** Lowercase letters, digits and spaces only, for comparing names. Accents are dropped
 *  first ("Beyoncé" -> "beyonce"), or the accented letter would vanish instead. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

// A town glued onto the venue name ("White Horse Black Mountain") or a stray "co."; the card adds
// the town back on its own when it isn't Asheville
const VENUE_SUFFIX_RE = /\s+(co\.|black mountain|asheville|nc)$/i;

// What people actually call a venue, where its listed name runs long
const SPOKEN_NAMES: [RegExp, string][] = [[/^grey eagle\b/i, 'Grey Eagle']];

// Venues some sources list only by street address (Facebook especially), where the
// host would otherwise stand in for the venue
const KNOWN_ADDRESSES: [RegExp, string][] = [
  [/^10 buxton av/i, 'Eulogy'],
  [/^13 mystery st/i, 'RAD Brewing'],
];

function shortVenue(name: string, maxLength: number | null): string {
  let s = name;
  // ALL-CAPS names to title case; mixed case is left alone
  if (s && !/[a-z]/.test(s)) s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  // "The Orange Peel" reads fine as "Orange Peel", but "The Roof" needs its "The"
  if (/^the\s+\S+\s+\S/i.test(s)) s = s.replace(/^the\s+/i, '').trim();
  for (let next = s.replace(VENUE_SUFFIX_RE, '').trim(); next !== s; ) {
    s = next;
    next = s.replace(VENUE_SUFFIX_RE, '').trim();
  }
  s = SPOKEN_NAMES.find(([pattern]) => pattern.test(s))?.[1] ?? s;
  if (maxLength !== null && s.length > maxLength) s = `${s.slice(0, maxLength - 1).trimEnd()}…`;
  return s;
}

/** The venue's short name, from the location or, failing that, the organizer. */
export function venueFor(
  event: { location: string | null; organizer: string | null },
  artist: string,
  maxLength: number | null = null
): string {
  const location = (event.location ?? '').trim();
  if (location) {
    const first = location.split(',')[0].split('|').pop()?.trim() ?? '';
    const looksLikeAddress = /^\d/.test(first);
    const known = looksLikeAddress && KNOWN_ADDRESSES.find(([pattern]) => pattern.test(first))?.[1];
    if (known) return known;
    if (first && !looksLikeAddress && normalizeName(first) !== normalizeName(artist)) {
      return shortVenue(first, maxLength);
    }
  }
  const organizer = (event.organizer ?? '').trim();
  if (organizer && normalizeName(organizer) !== normalizeName(artist)) {
    return shortVenue(organizer, maxLength);
  }
  return '';
}

/**
 * The venue line for an event card: the short venue name, plus the town when
 * it isn't Asheville ("Sierra Nevada Brewing · Mills River").
 */
export function venueLine(event: { location?: string | null; organizer?: string | null }): string {
  const venue = venueFor(
    { location: event.location ?? null, organizer: event.organizer ?? null },
    ''
  );
  const city = extractCity(event.location);
  const town = city && city !== 'Asheville' && city !== 'Online' ? city : null;
  if (venue && town) return `${venue} · ${town}`;
  return venue || town || (event.location ?? '') || 'Online';
}
