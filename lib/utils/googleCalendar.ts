/**
 * Google Calendar URL Generator
 *
 * Generates "Add to Google Calendar" links using the unofficial but working
 * URL parameters documented in calendar-research.md.
 *
 * @see https://calendar.google.com/calendar/r/eventedit
 */

interface GoogleCalendarEventParams {
  title: string;
  startDate: Date;
  endDate?: Date;
  description?: string | null;
  location?: string | null;
  timezone?: string;
  isAllDay?: boolean;
}

/**
 * Format date for all-day events (YYYYMMDD)
 */
function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format date for timed events (YYYYMMDDTHHmmss)
 */
function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Add hours to a date
 */
function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Generate a Google Calendar "Add Event" URL
 *
 * @param params - Event parameters
 * @returns URL string that opens Google Calendar with pre-filled event details
 *
 * @example
 * ```ts
 * const url = generateGoogleCalendarUrl({
 *   title: "Team Meeting",
 *   startDate: new Date("2025-12-15T14:00:00"),
 *   description: "Weekly sync",
 *   location: "Conference Room A",
 *   timezone: "America/New_York",
 * });
 * ```
 */
export function generateGoogleCalendarUrl(params: GoogleCalendarEventParams): string {
  const baseUrl = 'https://calendar.google.com/calendar/r/eventedit';
  const urlParams = new URLSearchParams();

  // Required: Event title
  urlParams.set('text', params.title);

  // Ensure startDate is a Date object
  const startDate =
    params.startDate instanceof Date ? params.startDate : new Date(params.startDate);

  // Required: Dates
  if (params.isAllDay) {
    // All-day format: YYYYMMDD/YYYYMMDD (end date must be +1 day)
    const startStr = formatDateOnly(startDate);
    const endDate = params.endDate
      ? params.endDate instanceof Date
        ? params.endDate
        : new Date(params.endDate)
      : startDate;
    const endStr = formatDateOnly(addDays(endDate, 1));
    urlParams.set('dates', `${startStr}/${endStr}`);
  } else {
    // Timed format: YYYYMMDDTHHmmss/YYYYMMDDTHHmmss
    const startStr = formatDateTime(startDate);
    const endDate = params.endDate
      ? params.endDate instanceof Date
        ? params.endDate
        : new Date(params.endDate)
      : addHours(startDate, 2); // Default to 2 hours duration
    const endStr = formatDateTime(endDate);
    urlParams.set('dates', `${startStr}/${endStr}`);

    // Set timezone for timed events (Asheville is in Eastern Time)
    urlParams.set('ctz', params.timezone || 'America/New_York');
  }

  // Optional: Description (truncate to 500 chars for best compatibility)
  if (params.description) {
    urlParams.set('details', params.description.slice(0, 500));
  }

  // Optional: Location
  if (params.location) {
    urlParams.set('location', params.location);
  }

  return `${baseUrl}?${urlParams.toString()}`;
}

/**
 * Generate a Google Calendar URL from an event object
 * (convenience wrapper for the EventCard component)
 */
export function generateCalendarUrlForEvent(event: {
  title: string;
  startDate: Date;
  description?: string | null;
  location?: string | null;
}): string {
  return generateGoogleCalendarUrl({
    title: event.title,
    startDate: event.startDate,
    description: event.description,
    location: event.location,
    timezone: 'America/New_York', // Asheville timezone
  });
}
