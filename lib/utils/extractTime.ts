/**
 * Regex-based time extraction from event text/descriptions.
 *
 * This utility attempts to extract event start time from unstructured text.
 * It should be used when the scraper only got a date but no specific time.
 *
 * Returns null if no time can be extracted (AI fallback should be used).
 */

/**
 * Result of time extraction attempt
 */
export interface TimeExtractionResult {
  hour: number;           // 0-23
  minute: number;         // 0-59
  confidence: 'high' | 'medium' | 'low';
  matchedPattern: string; // What pattern matched (for debugging)
  rawMatch: string;       // The original text that was matched
}

/**
 * Parse a 12-hour time string to 24-hour format.
 */
function parse12HourTime(
  hourStr: string,
  minuteStr: string | undefined,
  ampm: string
): { hour: number; minute: number } {
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
  const isPM = ampm.toLowerCase().startsWith('p');

  // Handle 12 AM/PM edge cases
  if (hour === 12) {
    hour = isPM ? 12 : 0;
  } else if (isPM) {
    hour += 12;
  }

  return { hour, minute };
}

/**
 * Extract time from text using regex patterns.
 * Returns null if no confident time can be extracted.
 *
 * @param text - The text to search for time information
 * @returns TimeExtractionResult or null if no time found
 */
export function extractTimeFromText(text: string): TimeExtractionResult | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  // Pattern 1: "Show: 8:00 PM" or "Show at 8pm" (high confidence - this is the start time)
  const showTimeMatch = text.match(
    /show[:\s]+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i
  );
  if (showTimeMatch) {
    const { hour, minute } = parse12HourTime(
      showTimeMatch[1],
      showTimeMatch[2],
      showTimeMatch[3]
    );
    return {
      hour,
      minute,
      confidence: 'high',
      matchedPattern: 'show_time',
      rawMatch: showTimeMatch[0],
    };
  }

  // Pattern 2: "Doors: 7pm, Show: 8pm" - extract show time (high confidence)
  const doorsShowMatch = text.match(
    /doors[:\s]+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)[,\s]+show[:\s]+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (doorsShowMatch) {
    const { hour, minute } = parse12HourTime(
      doorsShowMatch[4],
      doorsShowMatch[5],
      doorsShowMatch[6]
    );
    return {
      hour,
      minute,
      confidence: 'high',
      matchedPattern: 'doors_show',
      rawMatch: doorsShowMatch[0],
    };
  }

  // Pattern 3: "Starts at 7:00 PM" or "Starting at 7pm" (high confidence)
  const startsAtMatch = text.match(
    /start(?:s|ing)?[:\s]+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i
  );
  if (startsAtMatch) {
    const { hour, minute } = parse12HourTime(
      startsAtMatch[1],
      startsAtMatch[2],
      startsAtMatch[3]
    );
    return {
      hour,
      minute,
      confidence: 'high',
      matchedPattern: 'starts_at',
      rawMatch: startsAtMatch[0],
    };
  }

  // Pattern 4: "7:00 PM - 10:00 PM" time range (medium confidence, take start)
  const timeRangeMatch = text.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (timeRangeMatch) {
    const { hour, minute } = parse12HourTime(
      timeRangeMatch[1],
      timeRangeMatch[2],
      timeRangeMatch[3]
    );
    return {
      hour,
      minute,
      confidence: 'medium',
      matchedPattern: 'time_range',
      rawMatch: timeRangeMatch[0],
    };
  }

  // Pattern 5: 24-hour format "19:00" or "19:30" (medium confidence)
  const time24Match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (time24Match) {
    const hour = parseInt(time24Match[1], 10);
    const minute = parseInt(time24Match[2], 10);
    // Avoid matching things that look like years (19:99 is invalid anyway)
    // and times that are too early (like 00:00 or 06:00 for events)
    if (hour >= 10 || (hour < 10 && minute > 0)) {
      return {
        hour,
        minute,
        confidence: 'medium',
        matchedPattern: 'time_24h',
        rawMatch: time24Match[0],
      };
    }
  }

  // Pattern 6: Standalone time with context like "at 7pm" or "7:30 PM" (medium confidence)
  const contextualTimeMatch = text.match(
    /(?:at|@)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i
  );
  if (contextualTimeMatch) {
    const { hour, minute } = parse12HourTime(
      contextualTimeMatch[1],
      contextualTimeMatch[2],
      contextualTimeMatch[3]
    );
    return {
      hour,
      minute,
      confidence: 'medium',
      matchedPattern: 'contextual_time',
      rawMatch: contextualTimeMatch[0],
    };
  }

  // Pattern 7: Standalone time like "7:30 PM" without context (low confidence)
  // Only match if it looks like an evening time (5pm-11pm) for events
  const standaloneMatch = text.match(
    /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)\b/i
  );
  if (standaloneMatch) {
    const { hour, minute } = parse12HourTime(
      standaloneMatch[1],
      standaloneMatch[2],
      standaloneMatch[3]
    );
    // Only accept evening times as low confidence matches
    if (hour >= 17 && hour <= 23) {
      return {
        hour,
        minute,
        confidence: 'low',
        matchedPattern: 'standalone_evening',
        rawMatch: standaloneMatch[0],
      };
    }
  }

  // No time found
  return null;
}

/**
 * Apply extracted time to a date that only has the date portion.
 * Returns a new Date with the time applied.
 *
 * @param date - The original date (may have placeholder time like 9 AM)
 * @param hour - Hour (0-23)
 * @param minute - Minute (0-59)
 * @param timezone - Timezone to use (default: America/New_York)
 * @returns New Date with the time applied
 */
export function applyTimeToDate(
  date: Date,
  hour: number,
  minute: number,
  timezone: string = 'America/New_York'
): Date {
  // Get the date components in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00';

  const year = parseInt(getPart('year'), 10);
  const month = parseInt(getPart('month'), 10) - 1; // 0-indexed
  const day = parseInt(getPart('day'), 10);

  // Calculate timezone offset for the target date at the target time
  const refUtc = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const offsetParts = offsetFormatter.formatToParts(refUtc);
  const localHour = parseInt(offsetParts.find(p => p.type === 'hour')?.value || '12', 10);
  const offsetHours = localHour - 12;

  // Create the correct UTC time
  const utcTime = new Date(Date.UTC(
    year,
    month,
    day,
    hour - offsetHours,
    minute,
    0
  ));

  return utcTime;
}

/**
 * Try to extract time from description and apply it to a date.
 * Returns the original date if extraction fails.
 *
 * @param date - The original date
 * @param description - Text to extract time from
 * @param minConfidence - Minimum confidence to accept (default: 'medium')
 * @returns { date: Date, timeUpdated: boolean }
 */
export function tryExtractAndApplyTime(
  date: Date,
  description: string | null | undefined,
  minConfidence: 'high' | 'medium' | 'low' = 'medium'
): { date: Date; timeUpdated: boolean; extractedTime?: string } {
  if (!description) {
    return { date, timeUpdated: false };
  }

  const result = extractTimeFromText(description);

  if (!result) {
    return { date, timeUpdated: false };
  }

  // Check confidence threshold
  const confidenceLevels = { high: 3, medium: 2, low: 1 };
  const resultLevel = confidenceLevels[result.confidence];
  const minLevel = confidenceLevels[minConfidence];

  if (resultLevel >= minLevel) {
    const newDate = applyTimeToDate(date, result.hour, result.minute);
    const timeStr = `${result.hour.toString().padStart(2, '0')}:${result.minute.toString().padStart(2, '0')}`;
    return {
      date: newDate,
      timeUpdated: true,
      extractedTime: timeStr,
    };
  }

  return { date, timeUpdated: false };
}
