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

    return {
      isWeeklyRecurring: matches.length >= threshold,
      matchCount: matches.length,
      matchingEventIds: matches.map((m) => m.id),
    };
  } catch (error) {
    console.error('[RecurringDetection] Error checking weekly recurring:', error);
    return {
      isWeeklyRecurring: false,
      matchCount: 0,
      matchingEventIds: [],
    };
  }
}

/**
 * Batch check multiple events for weekly recurring patterns.
 * More efficient than checking one at a time.
 */
export async function checkWeeklyRecurringBatch(
  eventsToCheck: Array<{
    id: string;
    title: string;
    location: string | null;
    organizer: string | null;
    startDate: Date;
  }>
): Promise<Map<string, WeeklyRecurringCheck>> {
  const results = new Map<string, WeeklyRecurringCheck>();

  // Process in parallel with limited concurrency
  const batchSize = 10;
  for (let i = 0; i < eventsToCheck.length; i += batchSize) {
    const batch = eventsToCheck.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        const result = await checkWeeklyRecurring(
          event.title,
          event.location,
          event.organizer,
          event.id,
          event.startDate
        );
        return { id: event.id, result };
      })
    );

    for (const { id, result } of batchResults) {
      results.set(id, result);
    }
  }

  return results;
}
