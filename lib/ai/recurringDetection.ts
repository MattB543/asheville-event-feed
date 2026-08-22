/**
 * Weekly recurring event detection.
 *
 * Detects if an event is likely a weekly recurring event by finding
 * other events with the same title and location appearing multiple times.
 */

import { db } from '../db';
import { events } from '../db/schema';
import { and, ne, gte, lte, sql, or } from 'drizzle-orm';

export interface WeeklyRecurringCheck {
  isWeeklyRecurring: boolean;
  matchCount: number;
  matchingEventIds: string[];
}

/**
 * Check if an event appears to be weekly recurring by finding
 * other events with the same title (and optionally location) appearing 2+ times
 * within the next 8 weeks.
 *
 * Returns isWeeklyRecurring: true if 2+ other matching events found
 * (meaning 3+ total occurrences including the source event).
 */
export async function checkWeeklyRecurring(
  title: string,
  location: string | null,
  organizer: string | null,
  eventId: string,
  startDate: Date
): Promise<WeeklyRecurringCheck> {
  // Normalize title for matching
  const normalizedTitle = title.toLowerCase().trim();

  // Look 8 weeks into the future from event's start date
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 56); // 8 weeks

  // Also look 4 weeks into the past
  const lookbackDate = new Date(startDate);
  lookbackDate.setDate(lookbackDate.getDate() - 28); // 4 weeks back

  try {
    // Build the location/organizer matching condition
    // Match if same venue (location) OR same organizer
    const normalizedLocation = location?.toLowerCase().trim() || null;
    const normalizedOrganizer = organizer?.toLowerCase().trim() || null;

    const matchMode =
      normalizedLocation && normalizedOrganizer
        ? 'location+organizer'
        : normalizedLocation
          ? 'location-only'
          : normalizedOrganizer
            ? 'organizer-only'
            : 'title-only';

    let venueCondition;
    if (normalizedLocation && normalizedOrganizer) {
      // Match either location or organizer
      venueCondition = or(
        sql`LOWER(TRIM(${events.location})) = ${normalizedLocation}`,
        sql`LOWER(TRIM(${events.organizer})) = ${normalizedOrganizer}`
      );
    } else if (normalizedLocation) {
      venueCondition = sql`LOWER(TRIM(${events.location})) = ${normalizedLocation}`;
    } else if (normalizedOrganizer) {
      venueCondition = sql`LOWER(TRIM(${events.organizer})) = ${normalizedOrganizer}`;
    } else {
      // No venue/organizer info - require exact title match only
      // This is less reliable, so we'll be more conservative
      venueCondition = sql`TRUE`;
    }

    const matches = await db
      .select({ id: events.id, startDate: events.startDate })
      .from(events)
      .where(
        and(
          ne(events.id, eventId),
          sql`LOWER(TRIM(${events.title})) = ${normalizedTitle}`,
          venueCondition,
          gte(events.startDate, lookbackDate),
          lte(events.startDate, endDate)
        )
      );

    // If no venue/organizer info, require more matches to be confident
    const threshold = !normalizedLocation && !normalizedOrganizer ? 3 : 2;
    const isWeeklyRecurring = matches.length >= threshold;

    if (isWeeklyRecurring) {
      console.log(
        `[AI:Recurring] Detected weekly recurring: "${title.slice(0, 40)}..." - ${matches.length} matches (threshold=${threshold}, mode=${matchMode})`
      );
    } else if (matches.length > 0) {
      console.log(
        `[AI:Recurring] Below threshold: "${title.slice(0, 40)}..." - ${matches.length}/${threshold} matches (mode=${matchMode})`
      );
    }

    return {
      isWeeklyRecurring,
      matchCount: matches.length,
      matchingEventIds: matches.map((m) => m.id),
    };
  } catch (error) {
    console.error(
      `[AI:Recurring] Error checking "${title.slice(0, 40)}...":`,
      error instanceof Error ? error.message : error
    );
    return {
      isWeeklyRecurring: false,
      matchCount: 0,
      matchingEventIds: [],
    };
  }
}
