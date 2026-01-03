/**
 * Date filtering utilities for Eastern timezone (America/New_York).
 *
 * These functions are used by the export APIs to filter events by date
 * while correctly handling timezone boundaries for Asheville, NC.
 */

import {
  getTodayStringEastern,
  getDayBoundariesEastern,
  parseAsEastern,
  formatDateEastern,
} from '@/lib/utils/timezone';

// Helper to add days to a date string (YYYY-MM-DD format)
function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Day name to number mapping (module-level to avoid recreation per call)
const DAY_NAME_TO_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Pre-computed date boundaries for filtering.
 *
 * PERFORMANCE OPTIMIZATION: These boundaries are computed once per request
 * rather than per-event. When filtering hundreds of events, this avoids
 * redundant calls to getTodayStringEastern() and getDayBoundariesEastern()
 * for each event in the filter loop.
 */
export interface DateFilterBounds {
  today: { start: Date; end: Date };
  tomorrow: { start: Date; end: Date };
  weekend: { start: Date; end: Date };
}

export function computeDateFilterBounds(): DateFilterBounds {
  const todayStr = getTodayStringEastern();
  const [year, month, day] = todayStr.split('-').map(Number);
  const todayDate = new Date(year, month - 1, day);
  const dayOfWeek = todayDate.getDay();

  // Today bounds
  const todayBounds = getDayBoundariesEastern(todayStr);

  // Tomorrow bounds
  const tomorrowStr = addDaysToDateString(todayStr, 1);
  const tomorrowBounds = getDayBoundariesEastern(tomorrowStr);

  // Weekend bounds (Fri-Sun)
  const daysUntilFriday = dayOfWeek === 0 ? -2 : 5 - dayOfWeek;
  const fridayStr = addDaysToDateString(todayStr, daysUntilFriday);
  const sundayStr = addDaysToDateString(fridayStr, 2);
  const weekendBounds = {
    start: getDayBoundariesEastern(fridayStr).start,
    end: getDayBoundariesEastern(sundayStr).end,
  };

  return {
    today: todayBounds,
    tomorrow: tomorrowBounds,
    weekend: weekendBounds,
  };
}

/**
 * Check if an event date falls on "today" in Eastern timezone.
 */
export function isTodayEastern(date: Date, bounds: DateFilterBounds): boolean {
  return date >= bounds.today.start && date <= bounds.today.end;
}

/**
 * Check if an event date falls on "tomorrow" in Eastern timezone.
 */
export function isTomorrowEastern(date: Date, bounds: DateFilterBounds): boolean {
  return date >= bounds.tomorrow.start && date <= bounds.tomorrow.end;
}

/**
 * Check if an event date falls on "this weekend" (Fri-Sun) in Eastern timezone.
 */
export function isThisWeekendEastern(date: Date, bounds: DateFilterBounds): boolean {
  return date >= bounds.weekend.start && date <= bounds.weekend.end;
}

/**
 * Check if an event date falls on specific days of week in Eastern timezone.
 * Uses formatDateEastern to get the correct day of week for the event.
 */
export function isDayOfWeekEastern(date: Date, days: number[]): boolean {
  if (days.length === 0) return true;
  // Get day of week in Eastern timezone (0=Sun, 1=Mon, ..., 6=Sat)
  const dayName = formatDateEastern(date, { weekday: 'short' });
  const eventDayOfWeek = DAY_NAME_TO_NUMBER[dayName] ?? date.getDay();
  return days.includes(eventDayOfWeek);
}

/**
 * Check if an event date falls within a custom date range, parsed as Eastern timezone.
 */
export function isInDateRangeEastern(date: Date, start: string, end?: string): boolean {
  // Parse start date as Eastern midnight
  const startDate = parseAsEastern(start, '00:00:00');

  if (end) {
    // Parse end date as Eastern end-of-day
    const endDate = parseAsEastern(end, '23:59:59');
    return date >= startDate && date <= endDate;
  }

  // Single day: check if within that day's boundaries
  const { start: dayStart, end: dayEnd } = getDayBoundariesEastern(start);
  return date >= dayStart && date <= dayEnd;
}
