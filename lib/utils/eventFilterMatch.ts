/**
 * Client-side twin of the filtering in `queryFilteredEvents`
 * (lib/db/queries/events.ts), for lists that arrive unfiltered and are filtered
 * in the browser. Today that is the Top 30 tab: its ranked pool is the same for
 * every visitor and cached, so per-user filters have to be applied after the
 * fact. Keep the semantics in step with the server - an event must pass or fail
 * a given filter the same way on the main feed and on Top 30.
 *
 * Deliberately not covered here:
 * - hidden-event fingerprints: the Top 30 tab keeps events hidden this session
 *   visible but greyed out, so it applies those itself;
 * - the default spam keyword list and the daily-events toggle: the Top 30 pool
 *   is already score-curated, and the spam list's only hits in its top 200 are
 *   false positives on real events.
 */

import type { DateFilterType, DateRange, PriceFilterType, TimeOfDay } from '@/lib/types/filters';
import {
  type DateFilterBounds,
  isTodayEastern,
  isTomorrowEastern,
  isThisWeekendEastern,
  isDayOfWeekEastern,
  isInTimeOfDayEastern,
} from '@/lib/utils/dateFilters';
import { parseAsEastern } from '@/lib/utils/timezone';
import { extractCity, isAshevilleArea } from '@/lib/utils/geo';
import { isAshevilleZip } from '@/lib/config/zipNames';

/** Parse a price string ("$20", "Free", "$15-25") to a number; free/donation/unknown are 0. */
export function parsePrice(priceStr: string | null | undefined): number {
  if (!priceStr) return 0;
  const lower = priceStr.toLowerCase();
  if (lower.includes('free') || lower.includes('donation')) return 0;
  const matches = priceStr.match(/(\d+(\.\d+)?)/);
  if (matches) return parseFloat(matches[0]);
  return 0;
}

/** Whether an event counts as free. An unknown price is assumed free. */
export function isFreeEvent(price: string | null | undefined): boolean {
  if (!price) return true;
  const lower = price.toLowerCase();
  return (
    lower === 'unknown' ||
    lower === '' ||
    lower.includes('free') ||
    lower.includes('donation') ||
    parsePrice(price) === 0
  );
}

export interface FilterableEvent {
  title: string;
  description?: string | null;
  aiSummary?: string | null;
  organizer?: string | null;
  location?: string | null;
  zip?: string | null;
  price?: string | null;
  tags?: string[] | null;
}

/** One dated showing of an event. A merged multi-day listing has several. */
export interface FilterableOccurrence {
  startDate: Date;
  timeUnknown?: boolean | null;
}

/** The subset of the feed's filter state this predicate reads. */
export interface EventMatchFilters {
  search: string;
  dateFilter: DateFilterType;
  customDateRange: DateRange;
  selectedDays: number[];
  selectedTimes: TimeOfDay[];
  priceFilter: PriceFilterType;
  customMaxPrice: number | null;
  tagsInclude: string[];
  tagsExclude: string[];
  selectedLocations: string[];
  selectedZips: string[];
  blockedHosts: string[];
  blockedKeywords: string[];
}

function occurrenceMatchesDate(
  occurrence: FilterableOccurrence,
  filters: EventMatchFilters,
  bounds: DateFilterBounds
): boolean {
  const { startDate } = occurrence;
  switch (filters.dateFilter) {
    case 'today':
      return isTodayEastern(startDate, bounds);
    case 'tomorrow':
      return isTomorrowEastern(startDate, bounds);
    case 'weekend':
      return isThisWeekendEastern(startDate, bounds);
    case 'dayOfWeek':
      if (filters.selectedDays.length === 0) return true;
      // Must also be in the future (matches main list semantics)
      if (startDate < bounds.today.start) return false;
      return isDayOfWeekEastern(startDate, filters.selectedDays);
    case 'custom': {
      // Start and end bound independently, as on the server: a start with no
      // end means "from that day onward", an end with no start "up to that day"
      const { start, end } = filters.customDateRange;
      if (start && startDate < parseAsEastern(start, '00:00:00')) return false;
      if (end && startDate > parseAsEastern(end, '23:59:59')) return false;
      return true;
    }
    default:
      return true;
  }
}

function occurrenceMatchesTime(
  occurrence: FilterableOccurrence,
  filters: EventMatchFilters
): boolean {
  if (filters.selectedTimes.length === 0) return true;
  // Events with an unknown time always pass, as on the server
  if (occurrence.timeUnknown) return true;
  return isInTimeOfDayEastern(occurrence.startDate, filters.selectedTimes);
}

/**
 * Whether an event passes every filter in `filters`. Date and time-of-day are
 * checked per occurrence, and a single occurrence must satisfy both - the same
 * row-level AND the server applies.
 */
export function matchesEventFilters(
  event: FilterableEvent,
  occurrences: FilterableOccurrence[],
  filters: EventMatchFilters,
  bounds: DateFilterBounds
): boolean {
  const searchTerm = filters.search.trim().toLowerCase();
  if (searchTerm) {
    // A single field must contain the whole term (the server ORs per-field ILIKEs)
    const fields = [
      event.title,
      event.description,
      event.aiSummary,
      event.organizer,
      event.location,
      event.tags?.join(' '),
    ];
    if (!fields.some((field) => field?.toLowerCase().includes(searchTerm))) return false;
  }

  if (
    (filters.dateFilter !== 'all' || filters.selectedTimes.length > 0) &&
    !occurrences.some(
      (occurrence) =>
        occurrenceMatchesDate(occurrence, filters, bounds) &&
        occurrenceMatchesTime(occurrence, filters)
    )
  ) {
    return false;
  }

  if (filters.priceFilter !== 'any') {
    const price = parsePrice(event.price);
    switch (filters.priceFilter) {
      case 'free':
        if (!isFreeEvent(event.price)) return false;
        break;
      case 'under20':
        if (price > 20) return false;
        break;
      case 'under100':
        if (price > 100) return false;
        break;
      case 'custom':
        if (filters.customMaxPrice !== null && price > filters.customMaxPrice) return false;
        break;
    }
  }

  const tags = event.tags ?? [];
  if (filters.tagsInclude.length > 0 && !filters.tagsInclude.some((tag) => tags.includes(tag))) {
    return false;
  }
  // An untagged event fails too: the server's NOT (tags && excluded) is NULL for it
  if (
    filters.tagsExclude.length > 0 &&
    (!event.tags || filters.tagsExclude.some((tag) => tags.includes(tag)))
  ) {
    return false;
  }

  if (filters.selectedLocations.length > 0) {
    const eventCity = extractCity(event.location);
    const matchesLocation = filters.selectedLocations.some((loc) => {
      if (loc.toLowerCase() === 'asheville') {
        return isAshevilleArea(event.location) || (!!event.zip && isAshevilleZip(event.zip));
      }
      if (loc === 'Online') return eventCity === 'Online';
      return eventCity === loc;
    });
    if (!matchesLocation) return false;
  }

  if (filters.selectedZips.length > 0) {
    if (!event.zip || !filters.selectedZips.includes(event.zip)) return false;
  }

  if (filters.blockedHosts.length > 0 && event.organizer) {
    const organizer = event.organizer.toLowerCase();
    if (filters.blockedHosts.some((host) => organizer.includes(host.toLowerCase()))) return false;
  }

  if (filters.blockedKeywords.length > 0) {
    const title = event.title.toLowerCase();
    if (filters.blockedKeywords.some((kw) => title.includes(kw.toLowerCase()))) return false;
  }

  return true;
}
