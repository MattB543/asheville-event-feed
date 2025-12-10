/**
 * ICS (iCalendar) File Generator
 *
 * Generates .ics files for "Add to Calendar" functionality.
 * Works with Apple Calendar, Outlook, and most other calendar apps.
 *
 * @see https://icalendar.org/iCalendar-RFC-5545/
 */

interface ICSEventParams {
  title: string;
  startDate: Date;
  endDate?: Date;
  description?: string | null;
  location?: string | null;
  url?: string;
}

/**
 * Escape special characters for ICS format
 * Per RFC 5545, backslash, semicolon, comma, and newlines need escaping
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Format date for ICS (YYYYMMDDTHHMMSS format in UTC)
 */
function formatICSDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Generate a unique ID for the event
 */
function generateUID(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}@ashevilleeventfeed.com`;
}

/**
 * Add hours to a date
 */
function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Generate ICS file content for an event
 */
export function generateICSContent(params: ICSEventParams): string {
  const startDate =
    params.startDate instanceof Date
      ? params.startDate
      : new Date(params.startDate);

  const endDate = params.endDate
    ? params.endDate instanceof Date
      ? params.endDate
      : new Date(params.endDate)
    : addHours(startDate, 2); // Default 2 hour duration

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Asheville Event Feed//ashevilleeventfeed.com//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${generateUID()}`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(startDate)}`,
    `DTEND:${formatICSDate(endDate)}`,
    `SUMMARY:${escapeICSText(params.title)}`,
  ];

  if (params.description) {
    // Truncate description and add URL reference
    const desc = params.description.slice(0, 500);
    lines.push(`DESCRIPTION:${escapeICSText(desc)}`);
  }

  if (params.location) {
    lines.push(`LOCATION:${escapeICSText(params.location)}`);
  }

  if (params.url) {
    lines.push(`URL:${params.url}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  // ICS files use CRLF line endings
  return lines.join("\r\n");
}

/**
 * Generate ICS content for an event object (convenience wrapper)
 */
export function generateICSForEvent(event: {
  title: string;
  startDate: Date;
  description?: string | null;
  location?: string | null;
  url?: string;
}): string {
  return generateICSContent({
    title: event.title,
    startDate: event.startDate,
    description: event.description,
    location: event.location,
    url: event.url,
  });
}

/**
 * Download ICS file in the browser
 */
export function downloadICSFile(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  URL.revokeObjectURL(url);
}

/**
 * Download an event as an ICS file (convenience function)
 */
export function downloadEventAsICS(event: {
  title: string;
  startDate: Date;
  description?: string | null;
  location?: string | null;
  url?: string;
}): void {
  const icsContent = generateICSForEvent(event);
  // Create safe filename from title
  const safeTitle = event.title
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50);
  downloadICSFile(icsContent, `${safeTitle}.ics`);
}
