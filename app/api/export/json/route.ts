import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { asc, gte } from 'drizzle-orm';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';
import {
  computeDateFilterBounds,
  isTodayEastern,
  isTomorrowEastern,
  isThisWeekendEastern,
  isDayOfWeekEastern,
  isInDateRangeEastern,
} from '@/lib/utils/dateFilters';
import { matchesDefaultFilter } from '@/lib/config/defaultFilters';
import { extractCity, isAshevilleArea } from '@/lib/utils/geo';
import { isRecord, isString } from '@/lib/utils/validation';

export const dynamic = 'force-dynamic';

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

const TIME_OF_DAY = new Set<TimeOfDay>(['morning', 'afternoon', 'evening']);

interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

function createFingerprintKey(title: string, organizer: string | null | undefined): string {
  const normalizedTitle = title.toLowerCase().trim();
  const normalizedOrganizer = (organizer || '').toLowerCase().trim();
  return `${normalizedTitle}|||${normalizedOrganizer}`;
}

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

function parseTimes(value: string | null): TimeOfDay[] {
  if (!value) return [];
  const times = value
    .split(',')
    .map((time) => time.trim())
    .filter((time): time is TimeOfDay => TIME_OF_DAY.has(time as TimeOfDay));
  return times.length > 0 ? times : [];
}

function getHourEastern(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((part) => part.type === 'hour');
  if (hourPart) {
    const parsed = parseInt(hourPart.value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return date.getHours();
}

function matchesTimeOfDay(date: Date, times: TimeOfDay[]): boolean {
  const hour = getHourEastern(date);
  return times.some((time) => {
    if (time === 'morning') return hour >= 5 && hour <= 11;
    if (time === 'afternoon') return hour >= 12 && hour <= 16;
    return hour >= 17 || hour <= 2;
  });
}

function getImageUrl(imageUrl: string | null | undefined): string | null {
  // Filter out base64 data URLs (AI-generated images) - they're too large
  if (!imageUrl || imageUrl.startsWith('data:')) return null;
  return imageUrl;
}

function parsePrice(priceStr: string | null | undefined): number {
  if (!priceStr) return 0;
  const lower = priceStr.toLowerCase();
  if (lower.includes('free') || lower.includes('donation')) return 0;
  const matches = priceStr.match(/(\d+(\.\d+)?)/);
  if (matches) return parseFloat(matches[0]);
  return 0;
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
    const timesParam = searchParams.get('times');
    const selectedTimes = parseTimes(timesParam);

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
    const zipsParam = searchParams.get('zips');
    const selectedZips = zipsParam ? zipsParam.split(',').filter(Boolean) : [];
    const showDailyEvents = searchParams.get('showDailyEvents') !== 'false';

    // Get start of today in Eastern timezone (Asheville, NC)
    const startOfToday = getStartOfTodayEastern();

    // Pre-compute date filter boundaries once for the entire request
    // (avoids redundant timezone calculations for each event in the filter loop)
    const dateFilterBounds = computeDateFilterBounds();

    let allEvents = await db
      .select()
      .from(events)
      .where(gte(events.startDate, startOfToday))
      .orderBy(asc(events.startDate));

    // Apply filters
    allEvents = allEvents.filter((event) => {
      // 0. Admin-hidden events (moderation)
      if (event.hidden) {
        return false;
      }

      // 0.5 Daily events toggle
      if (!showDailyEvents && event.recurringType === 'daily') {
        return false;
      }

      // 1. Hidden Events (by title+organizer fingerprint)
      if (hiddenEvents.length > 0 && matchesHiddenFingerprint(event, hiddenEvents)) {
        return false;
      }

      // 2. Blocked Hosts
      if (blockedHosts.length > 0 && event.organizer) {
        if (
          blockedHosts.some((host) => event.organizer!.toLowerCase().includes(host.toLowerCase()))
        ) {
          return false;
        }
      }

      // 3. Blocked Keywords (user custom)
      if (blockedKeywords.length > 0) {
        if (blockedKeywords.some((kw) => event.title.toLowerCase().includes(kw.toLowerCase()))) {
          return false;
        }
      }

      // 4. Default Filters (spam filter)
      if (useDefaultFilters) {
        const textToCheck = `${event.title} ${event.description || ''} ${event.organizer || ''}`;
        if (matchesDefaultFilter(textToCheck)) return false;
      }

      // 5. Search filter (supports comma-separated OR logic)
      if (search) {
        const searchText =
          `${event.title} ${event.description || ''} ${event.organizer || ''} ${event.location || ''}`.toLowerCase();
        const searchTerms = search
          .split(',')
          .map((term) => term.trim())
          .filter((term) => term.length > 0);
        // Event must match at least one search term (OR logic)
        const matchesAnyTerm = searchTerms.some((term) => searchText.includes(term));
        if (!matchesAnyTerm) return false;
      }

      // 6. Date filter (using Eastern timezone for Asheville, NC)
      const eventDate = new Date(event.startDate);
      if (dateFilter === 'today' && !isTodayEastern(eventDate, dateFilterBounds)) return false;
      if (dateFilter === 'tomorrow' && !isTomorrowEastern(eventDate, dateFilterBounds))
        return false;
      if (dateFilter === 'weekend' && !isThisWeekendEastern(eventDate, dateFilterBounds))
        return false;
      if (dateFilter === 'dayOfWeek' && !isDayOfWeekEastern(eventDate, selectedDays)) return false;
      if (
        dateFilter === 'custom' &&
        dateStart &&
        !isInDateRangeEastern(eventDate, dateStart, dateEnd || undefined)
      )
        return false;

      // 7. Time filter (allow unknown times)
      if (selectedTimes.length > 0 && !event.timeUnknown) {
        if (!matchesTimeOfDay(eventDate, selectedTimes)) return false;
      }

      // 8. Price filter
      if (priceFilter && priceFilter !== 'any') {
        const price = parsePrice(event.price);
        const priceStr = event.price?.toLowerCase() || '';
        const isFree = priceStr.includes('free') || priceStr.includes('donation') || price === 0;

        if (priceFilter === 'free' && !isFree) return false;
        if (priceFilter === 'under20' && price > 20) return false;
        if (priceFilter === 'under100' && price > 100) return false;
        if (priceFilter === 'custom' && maxPrice && price > parseFloat(maxPrice)) return false;
      }

      // 9. Tag filter (include AND exclude)
      const eventTags = event.tags || [];

      // Exclude logic: If event has ANY excluded tag, filter it out
      if (excludeTags.length > 0) {
        if (excludeTags.some((tag) => eventTags.includes(tag))) return false;
      }

      // Include logic: If includes are set, event must have at least one
      if (includeTags.length > 0) {
        if (!includeTags.some((tag) => eventTags.includes(tag))) return false;
      }

      // 10. Location filter (multi-select - OR logic)
      if (selectedLocations.length > 0) {
        const eventCity = extractCity(event.location);
        let matchesAnyLocation = false;

        for (const loc of selectedLocations) {
          if (loc === 'asheville') {
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

      // 11. Zip filter
      if (selectedZips.length > 0) {
        if (!event.zip || !selectedZips.includes(event.zip)) {
          return false;
        }
      }

      return true;
    });

    // Transform events to clean JSON format
    const jsonEvents = allEvents.map((event) => ({
      id: event.id,
      sourceId: event.sourceId,
      source: event.source,
      title: event.title,
      description: event.description || null,
      startDate: event.startDate.toISOString(),
      location: event.location || null,
      zip: event.zip || null,
      organizer: event.organizer || null,
      price: event.price || null,
      url: event.url,
      imageUrl: getImageUrl(event.imageUrl),
      tags: event.tags || [],
      aiSummary: event.aiSummary || null,
      // Engagement metrics
      interestedCount: event.interestedCount || null,
      goingCount: event.goingCount || null,
      favoriteCount: event.favoriteCount || 0,
      // Recurring event info
      recurringType: event.recurringType || null,
      recurringEndDate: event.recurringEndDate?.toISOString() || null,
      // Metadata
      timeUnknown: event.timeUnknown || false,
      createdAt: event.createdAt?.toISOString() || null,
      updatedAt: event.updatedAt?.toISOString() || null,
      lastSeenAt: event.lastSeenAt?.toISOString() || null,
    }));

    const response = {
      count: jsonEvents.length,
      generated: new Date().toISOString(),
      events: jsonEvents,
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('[JSON Export] Error:', error);
    return NextResponse.json({ error: 'Failed to generate JSON feed' }, { status: 500 });
  }
}
