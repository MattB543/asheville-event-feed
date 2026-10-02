/**
 * schema.org Event JSON-LD and the meta description for /events/[slug].
 *
 * Every claim has to come from a stored field. Missing data stays missing: no
 * default venue, street address, end time, ticket availability or organizer URL.
 * A row may then miss some rich results, which beats publishing a wrong fact.
 */

import type { DbEvent } from '@/lib/events/getEvent';
import { cleanAshevilleFromSummary, cleanMarkdown } from '@/lib/utils/parsers';
import { extractCity } from '@/lib/utils/geo';
import { DEFAULT_EVENT_IMAGE, hasRealEventImage } from '@/lib/utils/eventImages';
import { formatEventStartDate } from '@/lib/utils/eventStartDate';
import { parsePublicOfferPrice } from '@/lib/utils/publicEventPrice';
import { formatDateEastern } from '@/lib/utils/timezone';

type EventSeoInput = Pick<
  DbEvent,
  | 'title'
  | 'description'
  | 'aiSummary'
  | 'startDate'
  | 'timeUnknown'
  | 'location'
  | 'organizer'
  | 'price'
  | 'url'
  | 'imageUrl'
  | 'hidden'
  | 'dedupedAt'
  | 'deadAt'
>;

const META_DESCRIPTION_MAX = 160;

// A location that says how to attend rather than where. "Remote meeting" is what the
// civic scrapers store for virtual meetings (the feed query hides "online"/"virtual").
const REMOTE_ONLY =
  /^(?:online|virtual|remote|remote meeting|online event|virtual event|online only|zoom|livestream)$/i;
// Any other mention may be a hybrid event or a venue name, so neither mode is claimed
const REMOTE_MARKER = /\b(?:online|virtual|remote meeting|zoom|livestream|webinar)\b/i;
const NO_LOCATION = /^(?:tba|tbd|to be announced|location tba|location tbd)$/i;

type LocationKind = 'physical' | 'remote' | 'unclear' | 'none';

function locationKind(location: string): LocationKind {
  if (!location || NO_LOCATION.test(location)) return 'none';
  if (REMOTE_ONLY.test(location)) return 'remote';
  if (REMOTE_MARKER.test(location)) return 'unclear';
  return 'physical';
}

/**
 * Live = still listed in the feed. Deduped and dead rows keep their page so shared
 * links work, but get no Event schema and are not indexed.
 */
export function isLiveEvent(event: Pick<DbEvent, 'hidden' | 'dedupedAt' | 'deadAt'>): boolean {
  return !event.hidden && !event.dedupedAt && !event.deadAt;
}

/** The text the event page shows first: cleaned AI summary, else the cleaned description. */
function eventSummary(event: EventSeoInput): string {
  const summary = event.aiSummary ? cleanAshevilleFromSummary(cleanMarkdown(event.aiSummary)) : '';
  return (summary || cleanMarkdown(event.description)).trim();
}

function toHttpUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A known NC town when the whole string names one ("fletcher" -> "Fletcher"), else undefined. */
function knownTown(text: string): string | undefined {
  const city = extractCity(text);
  return city && city !== 'Online' && city.toLowerCase() === text.trim().toLowerCase()
    ? city
    : undefined;
}

/**
 * The town an address states, read from the segment before ", NC" (or the last segment
 * when there is no state). extractCity alone substring-matches, so "Asheville Regional
 * Airport, Fletcher, NC" would read as Asheville; it is only the fallback when the
 * string has no such segment. A stated segment that is not a known town is ambiguous
 * and yields no locality.
 */
function eventLocality(location: string): string | undefined {
  const segments = location.split(',').map((s) => s.trim());
  let stateIdx = -1;
  segments.forEach((s, i) => {
    if (/^(?:NC|North Carolina)(?:\s+\d{5}(?:-\d{4})?)?$/i.test(s)) stateIdx = i;
  });
  if (stateIdx > 0) return knownTown(segments[stateIdx - 1]);
  if (stateIdx === -1 && segments.length > 1) {
    const town = knownTown(segments[segments.length - 1]);
    if (town) return town;
  }
  const city = extractCity(location);
  return city && city !== 'Online' ? city : undefined;
}

/**
 * Locality comes from the known-city list (every entry is in NC), so the region is
 * only asserted alongside a recognized town or an explicit "NC". No postalCode: many
 * stored ZIPs are scraper estimates (city defaults, coordinate boxes), not the venue's.
 */
function postalAddress(location: string) {
  const locality = eventLocality(location);
  const inNC = !!locality || /\bNC\b|North Carolina/i.test(location);

  if (!inNC) return undefined;
  return {
    '@type': 'PostalAddress',
    addressLocality: locality,
    addressRegion: 'NC',
    addressCountry: 'US',
  };
}

/** Absolute URL of the event's own artwork, or undefined for none/placeholder/data: images. */
function eventImageUrl(imageUrl: string | null, siteUrl: string): string | undefined {
  if (!imageUrl || imageUrl.startsWith('data:') || !hasRealEventImage(imageUrl)) return undefined;
  const href = toHttpUrl(imageUrl, siteUrl);
  if (!href) return undefined;
  // hasRealEventImage only matches the placeholder's exact relative path; it can also
  // be stored absolute or with a query string
  const url = new URL(href);
  if (url.origin === new URL(siteUrl).origin && url.pathname === DEFAULT_EVENT_IMAGE) {
    return undefined;
  }
  return href;
}

/**
 * Event JSON-LD for a live row, or null for a deduped/dead/hidden one. Recurring
 * rows describe the stored occurrence only; they are not expanded into a schedule.
 */
export function buildEventJsonLd(event: EventSeoInput, eventUrl: string, siteUrl: string) {
  if (!isLiveEvent(event)) return null;

  const location = event.location?.trim() ?? '';
  const kind = locationKind(location);
  const price = parsePublicOfferPrice(event.price);
  const image = eventImageUrl(event.imageUrl, siteUrl);
  const organizer = event.organizer?.trim();

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${eventUrl}#event`,
    name: event.title,
    description: eventSummary(event) || undefined,
    // Date only when the source gave no time, never a made-up midnight. No endDate:
    // nothing stores one (recurringEndDate is when a run ends, not this occurrence).
    startDate: formatEventStartDate(event.startDate, !!event.timeUnknown),
    // Only live rows get here, and no source reports cancellations or postponements
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode:
      kind === 'physical'
        ? 'https://schema.org/OfflineEventAttendanceMode'
        : kind === 'remote'
          ? 'https://schema.org/OnlineEventAttendanceMode'
          : undefined,
    // No VirtualLocation for remote rows: the source listing is not a joining link
    location:
      kind === 'physical'
        ? { '@type': 'Place', name: location, address: postalAddress(location) }
        : undefined,
    image: image ? [image] : undefined,
    url: eventUrl,
    // Price only when it is one unambiguous number; ticket inventory is unknown
    offers:
      price !== undefined
        ? { '@type': 'Offer', price, priceCurrency: 'USD', url: toHttpUrl(event.url) }
        : undefined,
    organizer: organizer ? { '@type': 'Organization', name: organizer } : undefined,
  };
}

/** "The Orange Peel, 101 Biltmore Ave, Asheville, NC 28801" -> "The Orange Peel, Asheville" */
function shortLocation(location: string | null): string | undefined {
  const loc = location?.trim() ?? '';
  if (locationKind(loc) === 'none') return undefined;
  const venue = loc.split(',')[0].trim();
  const city = eventLocality(loc);
  return city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue;
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:·—-]+$/, '')}…`;
}

/**
 * "Title · Fri, Oct 2, 2026, 7:00 PM · Venue, Town. Summary", capped at 160
 * characters. Shared by the standard, Open Graph and Twitter descriptions.
 */
export function buildEventMetaDescription(event: EventSeoInput): string {
  const day = formatDateEastern(event.startDate, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const when = event.timeUnknown
    ? day
    : `${day}, ${formatDateEastern(event.startDate, { hour: 'numeric', minute: '2-digit' })}`;
  const head = [event.title.trim(), when, shortLocation(event.location)]
    .filter(Boolean)
    .join(' · ')
    .replace(/[\s.]+$/, '');
  const summary = eventSummary(event).replace(/\s+/g, ' ');
  return truncateAtWord(summary ? `${head}. ${summary}` : `${head}.`, META_DESCRIPTION_MAX);
}
