import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { asc, gte } from 'drizzle-orm';
import {
  getStartOfTodayEastern,
  getTodayStringEastern,
  getDayBoundariesEastern,
  parseAsEastern,
  formatDateEastern,
} from '@/lib/utils/timezone';
import { matchesDefaultFilter } from '@/lib/config/defaultFilters';
import { extractCity, isAshevilleArea } from '@/lib/utils/geo';
import { isRecord, isString } from '@/lib/utils/validation';

export const dynamic = 'force-dynamic';

// Hidden event fingerprint type (matches client-side)
interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

// Create a fingerprint key for comparison
function createFingerprintKey(title: string, organizer: string | null | undefined): string {
  const normalizedTitle = title.toLowerCase().trim();
  const normalizedOrganizer = (organizer || '').toLowerCase().trim();
  return `${normalizedTitle}|||${normalizedOrganizer}`;
}

// Check if event matches any hidden fingerprint
function matchesHiddenFingerprint(
  event: { title: string; organizer: string | null },
  hiddenEvents: HiddenEventFingerprint[]
): boolean {
  const eventKey = createFingerprintKey(event.title, event.organizer);
  return hiddenEvents.some((fp) => {
    const fpKey = `${fp.title}|||${fp.organizer}`;
    return eventKey === fpKey;
  });
}

function parseHiddenEvents(value: string | null): HiddenEventFingerprint[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!isRecord(entry) || !isString(entry.title) || !isString(entry.organizer)) {
        return [];
      }
      return [{ title: entry.title, organizer: entry.organizer }];
    });
  } catch {
    return [];
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function escapeMarkdown(str: string | null | undefined): string {
  if (!str) return '';
  // Escape special markdown characters in inline text
  return str.replace(/([[\]()])/g, '\\$1');
}

function parsePrice(priceStr: string | null | undefined): number {
  if (!priceStr) return 0;
  const lower = priceStr.toLowerCase();
  if (lower.includes('free') || lower.includes('donation')) return 0;
  const matches = priceStr.match(/(\d+(\.\d+)?)/);
  if (matches) return parseFloat(matches[0]);
  return 0;
}

// Helper to add days to a date string (YYYY-MM-DD format)
function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Check if an event date falls on "today" in Eastern timezone.
 * Uses getDayBoundariesEastern to get proper midnight-to-midnight bounds.
 */
function isTodayEastern(date: Date): boolean {
  const todayStr = getTodayStringEastern();
  const { start, end } = getDayBoundariesEastern(todayStr);
  return date >= start && date <= end;
}

/**
 * Check if an event date falls on "tomorrow" in Eastern timezone.
 */
function isTomorrowEastern(date: Date): boolean {
  const todayStr = getTodayStringEastern();
  const tomorrowStr = addDaysToDateString(todayStr, 1);
  const { start, end } = getDayBoundariesEastern(tomorrowStr);
  return date >= start && date <= end;
}

/**
 * Check if an event date falls on "this weekend" (Fri-Sun) in Eastern timezone.
 */
function isThisWeekendEastern(date: Date): boolean {
  const todayStr = getTodayStringEastern();
  const [year, month, day] = todayStr.split('-').map(Number);
  const todayDate = new Date(year, month - 1, day);
  const dayOfWeek = todayDate.getDay();

  // Calculate Friday of this week (in Eastern)
  const daysUntilFriday = dayOfWeek === 0 ? -2 : 5 - dayOfWeek;
  const fridayStr = addDaysToDateString(todayStr, daysUntilFriday);
  const sundayStr = addDaysToDateString(fridayStr, 2);

  const { start } = getDayBoundariesEastern(fridayStr);
  const { end } = getDayBoundariesEastern(sundayStr);

  return date >= start && date <= end;
}

/**
 * Check if an event date falls on specific days of week in Eastern timezone.
 * Uses formatDateEastern to get the correct day of week for the event.
 */
function isDayOfWeekEastern(date: Date, days: number[]): boolean {
  if (days.length === 0) return true;
  // Get day of week in Eastern timezone (0=Sun, 1=Mon, ..., 6=Sat)
  const dayName = formatDateEastern(date, { weekday: 'short' });
  const dayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };
  const eventDayOfWeek = dayMap[dayName] ?? date.getDay();
  return days.includes(eventDayOfWeek);
}

/**
 * Check if an event date falls within a custom date range, parsed as Eastern timezone.
 */
function isInDateRangeEastern(date: Date, start: string, end?: string): boolean {
  // Parse start date as Eastern midnight
  const startDate = parseAsEastern(start, "00:00:00");

  if (end) {
    // Parse end date as Eastern end-of-day
    const endDate = parseAsEastern(end, "23:59:59");
    return date >= startDate && date <= endDate;
  }

  // Single day: check if within that day's boundaries
  const { start: dayStart, end: dayEnd } = getDayBoundariesEastern(start);
  return date >= dayStart && date <= dayEnd;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.toLowerCase();
    const dateFilter = searchParams.get('dateFilter');
    const dateStart = searchParams.get('dateStart');
    const dateEnd = searchParams.get('dateEnd');
    const priceFilter = searchParams.get('priceFilter');
    const maxPrice = searchParams.get('maxPrice');
    const tagsIncludeParam = searchParams.get('tagsInclude');
    const tagsExcludeParam = searchParams.get('tagsExclude');
    const includeTags = tagsIncludeParam ? tagsIncludeParam.split(',') : [];
    const excludeTags = tagsExcludeParam ? tagsExcludeParam.split(',') : [];
    const daysParam = searchParams.get('days');
    const selectedDays = daysParam ? daysParam.split(',').map(Number) : [];

    // Client-side filters
    const blockedHostsParam = searchParams.get('blockedHosts');
    const blockedHosts = blockedHostsParam ? blockedHostsParam.split(',') : [];
    const blockedKeywordsParam = searchParams.get('blockedKeywords');
    const blockedKeywords = blockedKeywordsParam ? blockedKeywordsParam.split(',') : [];
    const hiddenEventsParam = searchParams.get('hiddenEvents');
    const hiddenEvents = parseHiddenEvents(hiddenEventsParam);
    const useDefaultFilters = searchParams.get('useDefaultFilters') !== 'false';
    const locationsParam = searchParams.get('locations');
    const selectedLocations = locationsParam ? locationsParam.split(',') : [];

    // Get start of today in Eastern timezone (Asheville, NC)
    const startOfToday = getStartOfTodayEastern();

    let allEvents = await db
      .select()
      .from(events)
      .where(gte(events.startDate, startOfToday))
      .orderBy(asc(events.startDate));

    // Apply filters
    allEvents = allEvents.filter(event => {
      // 1. Hidden Events (by title+organizer fingerprint)
      if (hiddenEvents.length > 0 && matchesHiddenFingerprint(event, hiddenEvents)) {
        return false;
      }

      // 2. Blocked Hosts
      if (blockedHosts.length > 0 && event.organizer) {
        if (blockedHosts.some(host => event.organizer!.toLowerCase().includes(host.toLowerCase()))) {
          return false;
        }
      }

      // 3. Blocked Keywords (user custom)
      if (blockedKeywords.length > 0) {
        if (blockedKeywords.some(kw => event.title.toLowerCase().includes(kw.toLowerCase()))) {
          return false;
        }
      }

      // 4. Default Filters (spam filter)
      if (useDefaultFilters) {
        const textToCheck = `${event.title} ${event.description || ''} ${event.organizer || ''}`;
        if (matchesDefaultFilter(textToCheck)) return false;
      }

      // 5. Search filter
      if (search) {
        const searchText = `${event.title} ${event.description || ''} ${event.organizer || ''} ${event.location || ''}`.toLowerCase();
        if (!searchText.includes(search)) return false;
      }

      // 6. Date filter (using Eastern timezone for Asheville, NC)
      const eventDate = new Date(event.startDate);
      if (dateFilter === 'today' && !isTodayEastern(eventDate)) return false;
      if (dateFilter === 'tomorrow' && !isTomorrowEastern(eventDate)) return false;
      if (dateFilter === 'weekend' && !isThisWeekendEastern(eventDate)) return false;
      if (dateFilter === 'dayOfWeek' && !isDayOfWeekEastern(eventDate, selectedDays)) return false;
      if (dateFilter === 'custom' && dateStart && !isInDateRangeEastern(eventDate, dateStart, dateEnd || undefined)) return false;

      // 7. Price filter
      if (priceFilter && priceFilter !== 'any') {
        const price = parsePrice(event.price);
        const priceStr = event.price?.toLowerCase() || '';
        const isFree = priceStr.includes('free') || priceStr.includes('donation') || price === 0;

        if (priceFilter === 'free' && !isFree) return false;
        if (priceFilter === 'under20' && price > 20) return false;
        if (priceFilter === 'under100' && price > 100) return false;
        if (priceFilter === 'custom' && maxPrice && price > parseFloat(maxPrice)) return false;
      }

      // 8. Tag filter (include AND exclude)
      const eventTags = event.tags || [];

      // Exclude logic: If event has ANY excluded tag, filter it out
      if (excludeTags.length > 0) {
        if (excludeTags.some(tag => eventTags.includes(tag))) return false;
      }

      // Include logic: If includes are set, event must have at least one
      if (includeTags.length > 0) {
        if (!includeTags.some(tag => eventTags.includes(tag))) return false;
      }

      // 9. Location filter (multi-select - OR logic)
      if (selectedLocations.length > 0) {
        const eventCity = extractCity(event.location);
        let matchesAnyLocation = false;

        for (const loc of selectedLocations) {
          if (loc === 'asheville') {
            // "Asheville area" includes: Asheville city + known Asheville venues
            if (isAshevilleArea(event.location)) {
              matchesAnyLocation = true;
              break;
            }
          } else if (loc === 'Online') {
            if (eventCity === 'Online') {
              matchesAnyLocation = true;
              break;
            }
          } else {
            // Specific city - exact match
            if (eventCity === loc) {
              matchesAnyLocation = true;
              break;
            }
          }
        }

        if (!matchesAnyLocation) {
          return false;
        }
      }

      return true;
    });

    const header = `# Asheville Events

> Generated: ${new Date().toISOString()}
> Total Events: ${allEvents.length}

---

`;

    const eventsList = allEvents.map(event => {
      const lines: string[] = [];

      // Title with link
      const safeTitle = escapeMarkdown(event.title);
      lines.push(`## [${safeTitle}](${event.url})`);
      lines.push('');

      // Date
      lines.push(`**Date:** ${formatDate(new Date(event.startDate))}`);

      // Location
      if (event.location) {
        lines.push(`**Location:** ${event.location}`);
      }

      // Organizer
      if (event.organizer) {
        lines.push(`**Organizer:** ${event.organizer}`);
      }

      // Price
      if (event.price) {
        lines.push(`**Price:** ${event.price}`);
      }

      // Source
      lines.push(`**Source:** ${event.source}`);

      // Tags
      if (event.tags && event.tags.length > 0) {
        lines.push(`**Tags:** ${event.tags.join(', ')}`);
      }

      // Description (truncated)
      if (event.description) {
        const truncated = event.description.length > 500
          ? event.description.slice(0, 500) + '...'
          : event.description;
        lines.push('');
        lines.push(truncated);
      }

      lines.push('');
      lines.push('---');
      lines.push('');

      return lines.join('\n');
    }).join('\n');

    const markdown = header + eventsList;

    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[Markdown Export] Error:', error);
    return new NextResponse(
      '# Error\n\nFailed to generate Markdown feed.',
      {
        status: 500,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      }
    );
  }
}
