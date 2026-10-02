/**
 * Public, machine-readable start date for an event (compact API + Event JSON-LD).
 *
 * Known time: RFC 3339 in Eastern time with the offset in effect at that instant,
 * e.g. "2026-10-02T19:00:00-04:00". The instant is preserved exactly.
 * Unknown time (`timeUnknown`): the Eastern calendar date only, e.g. "2026-10-02",
 * so a date-only listing never advertises a made-up midnight start.
 */

const EASTERN_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

export function formatEventStartDate(date: Date, timeUnknown: boolean): string {
  const parts: Record<string, string> = {};
  for (const p of EASTERN_PARTS.formatToParts(date)) parts[p.type] = p.value;

  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (timeUnknown) return day;

  // longOffset renders "GMT-04:00" / "GMT-05:00" for the offset at this exact instant.
  const offset = parts.timeZoneName.replace('GMT', '') || 'Z';
  return `${day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
