/**
 * Timezone utilities for Asheville, NC (Eastern timezone)
 *
 * These functions ensure consistent date handling regardless of server timezone.
 * Vercel runs in UTC, but we need to show dates relative to Eastern time.
 */

/**
 * Get start of today (midnight) in Eastern timezone (America/New_York)
 * Returns a Date object that represents 00:00:00 Eastern time
 *
 * This works correctly regardless of server timezone (e.g., UTC on Vercel)
 */
export function getStartOfTodayEastern(): Date {
  const now = new Date();

  // Get today's date in Eastern timezone (YYYY-MM-DD format)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const todayEastern = formatter.format(now); // "2024-11-29" format

  // Determine current Eastern offset by checking the formatted timezone
  const nowOffset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset'
  }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value;

  // EST = GMT-5, EDT = GMT-4
  const offset = nowOffset?.includes('-4') ? '-04:00' : '-05:00';

  // Return midnight Eastern as a proper Date (stored as UTC internally)
  return new Date(`${todayEastern}T00:00:00${offset}`);
}

/**
 * Get current date string in Eastern timezone (YYYY-MM-DD format)
 */
export function getTodayStringEastern(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

/**
 * Format a date for display in Eastern timezone
 */
export function formatDateEastern(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    ...options
  }).format(date);
}

/**
 * Get the Eastern timezone offset string for a given date.
 * Accounts for Daylight Saving Time automatically.
 *
 * @param dateStr - Date string in YYYY-MM-DD format (or a Date object)
 * @returns Offset string like '-05:00' (EST) or '-04:00' (EDT)
 */
export function getEasternOffset(dateStr: string | Date): string {
  // Create a date at noon to avoid any edge cases at midnight
  const date = typeof dateStr === 'string'
    ? new Date(`${dateStr}T12:00:00`)
    : dateStr;

  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset'
  }).formatToParts(date).find(p => p.type === 'timeZoneName')?.value;

  // EST = GMT-5, EDT = GMT-4
  return offsetPart?.includes('-4') ? '-04:00' : '-05:00';
}

/**
 * Parse a local date/time string as Eastern timezone.
 * Correctly handles DST for the given date.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timeStr - Time string in HH:MM:SS format (defaults to 19:00:00)
 * @returns Date object with correct UTC time
 */
export function parseAsEastern(dateStr: string, timeStr: string = '19:00:00'): Date {
  const offset = getEasternOffset(dateStr);
  return new Date(`${dateStr}T${timeStr}${offset}`);
}
