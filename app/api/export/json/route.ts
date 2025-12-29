import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { asc, gte } from 'drizzle-orm';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';
import { matchesDefaultFilter } from '@/lib/config/defaultFilters';
import { extractCity, isAshevilleArea } from '@/lib/utils/geo';
import { isRecord, isString } from '@/lib/utils/validation';

export const dynamic = 'force-dynamic';

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

function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.toDateString() === tomorrow.toDateString();
}

function isThisWeekend(date: Date): boolean {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
  const saturday = new Date(today);
  saturday.setDate(today.getDate() + daysUntilSaturday);
  saturday.setHours(0, 0, 0, 0);
  const sundayEnd = new Date(saturday);
  sundayEnd.setDate(saturday.getDate() + 1);
  sundayEnd.setHours(23, 59, 59, 999);
  return date >= saturday && date <= sundayEnd;
}

function isDayOfWeek(date: Date, days: number[]): boolean {
  if (days.length === 0) return true;
  return days.includes(date.getDay());
}

function isInDateRange(date: Date, start: string, end?: string): boolean {
  const eventDate = new Date(date);
  eventDate.setHours(0, 0, 0, 0);
  const startDate = new Date(start);
  startDate.setHours(0, 0, 0, 0);

  if (end) {
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);
    return eventDate >= startDate && eventDate <= endDate;
  }
  return eventDate.toDateString() === startDate.toDateString();
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
    allEvents = allEvents.filter((event) => {
      // 0. Admin-hidden events (moderation)
      if (event.hidden) {
        return false;
      }

      // 1. Hidden Events (by title+organizer fingerprint)
      if (hiddenEvents.length > 0 && matchesHiddenFingerprint(event, hiddenEvents)) {
        return false;
      }

      // 2. Blocked Hosts
      if (blockedHosts.length > 0 && event.organizer) {
        if (blockedHosts.some((host) => event.organizer!.toLowerCase().includes(host.toLowerCase()))) {
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
        const searchTerms = search.split(',').map(term => term.trim()).filter(term => term.length > 0);
        // Event must match at least one search term (OR logic)
        const matchesAnyTerm = searchTerms.some(term => searchText.includes(term));
        if (!matchesAnyTerm) return false;
      }

      // 6. Date filter
      const eventDate = new Date(event.startDate);
      if (dateFilter === 'today' && !isToday(eventDate)) return false;
      if (dateFilter === 'tomorrow' && !isTomorrow(eventDate)) return false;
      if (dateFilter === 'weekend' && !isThisWeekend(eventDate)) return false;
      if (dateFilter === 'dayOfWeek' && !isDayOfWeek(eventDate, selectedDays)) return false;
      if (dateFilter === 'custom' && dateStart && !isInDateRange(eventDate, dateStart, dateEnd || undefined))
        return false;

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
        if (excludeTags.some((tag) => eventTags.includes(tag))) return false;
      }

      // Include logic: If includes are set, event must have at least one
      if (includeTags.length > 0) {
        if (!includeTags.some((tag) => eventTags.includes(tag))) return false;
      }

      // 9. Location filter (multi-select - OR logic)
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
    return NextResponse.json(
      { error: 'Failed to generate JSON feed' },
      { status: 500 }
    );
  }
}
