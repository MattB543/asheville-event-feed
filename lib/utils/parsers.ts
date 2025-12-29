/**
 * Parsing and normalization utilities for scraped content.
 *
 * Includes:
 * - HTML entity decoding
 * - Markdown cleanup
 * - Price extraction/formatting
 * - Time extraction and application
 * - Eastern timezone helpers
 */

// ============================================================================
// HTML + MARKDOWN CLEANUP
// ============================================================================

/**
 * Decode HTML entities in a string.
 *
 * Handles common named and numeric entities found in scraped content.
 * Also strips HTML tags and normalizes whitespace.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    // Strip any HTML tags first
    .replace(/<[^>]*>/g, "")
    // Named entities - common
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    // Numeric entities for common characters
    .replace(/&#8211;/g, "-") // en-dash
    .replace(/&#8212;/g, "-") // em-dash
    .replace(/&#8217;/g, "'") // right single quote
    .replace(/&#8216;/g, "'") // left single quote
    .replace(/&#8220;/g, '"') // left double quote
    .replace(/&#8221;/g, '"') // right double quote
    .replace(/&#8230;/g, ".") // ellipsis
    .replace(/&#038;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&#124;/g, "|") // pipe/vertical bar
    // Named entities for special punctuation
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&hellip;/g, ".")
    // Clean up multiple spaces and trim
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove markdown formatting from text while preserving the content.
 */
export function cleanMarkdown(text: string | null | undefined): string {
  if (!text) return "";

  let result = text;

  // Remove escaped characters (e.g., \*, \[, \()
  result = result.replace(/\\([*[\]()#>`~|])/g, "$1");

  // Remove bold/italic markers
  result = result.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");

  // Remove links but keep text: [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove headers (# ## ### etc.)
  result = result.replace(/^#{1,6}\s*/gm, "");

  // Remove inline code backticks
  result = result.replace(/`{1,3}([^`]+)`{1,3}/g, "$1");

  // Remove blockquotes
  result = result.replace(/^>\s*/gm, "");

  // Remove strikethrough
  result = result.replace(/~~([^~]+)~~/g, "$1");

  // Remove horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, "");

  return result;
}

/**
 * Removes redundant "Asheville" or "Asheville, NC" references from AI summaries.
 * Since the venue/location is already displayed separately, we don't need it in the summary.
 */
export function cleanAshevilleFromSummary(text: string): string {
  if (!text) return text;

  return text
    // ", Asheville, NC" or ", Asheville" (most common)
    .replace(/, Asheville,? NC?\b/gi, ",")
    .replace(/, Asheville\b(?!, NC)/gi, ",")
    // " in Asheville, NC" or " in Asheville"
    .replace(/ in Asheville,? NC?\b/gi, "")
    .replace(/ in Asheville\b(?!, NC)/gi, "")
    // "(Asheville, NC)" or "(Asheville)" at end of parenthetical
    .replace(/,? Asheville,? NC?\)/gi, ")")
    // Clean up any double commas or comma-space-comma that might result
    .replace(/,\s*,/g, ",")
    // Clean up ", )" that might result
    .replace(/,\s*\)/g, ")")
    // Clean up any trailing commas before periods
    .replace(/,\s*\./g, ".");
}

// ============================================================================
// PRICE EXTRACTION + FORMATTING
// ============================================================================

/**
 * Format a price value to a rounded dollar string.
 * - 0 or "0" => "Free"
 * - null/undefined/empty => "Unknown"
 * - numeric => "$X" (rounded to nearest dollar)
 */
export function formatPrice(value: number | string | null | undefined): string {
  // Handle null/undefined/empty
  if (value === null || value === undefined || value === "" || value === "null") {
    return "Unknown";
  }

  // Convert to number if string
  const numValue = typeof value === "string" ? parseFloat(value) : value;

  // Handle NaN
  if (isNaN(numValue)) {
    return "Unknown";
  }

  // Handle free
  if (numValue === 0) {
    return "Free";
  }

  // Round to nearest dollar
  const rounded = Math.round(numValue);

  return `$${rounded}`;
}

/**
 * Result of price extraction attempt
 */
export interface PriceExtractionResult {
  price: string; // Formatted price: "Free", "$20", "$20+", "Ticketed"
  confidence: "high" | "medium" | "low";
  matchedPattern: string; // What pattern matched (for debugging)
}

/**
 * Check if text indicates a free event.
 * Returns true for explicit "free" mentions, false otherwise.
 */
export function isFreeEvent(text: string): boolean {
  if (!text) return false;

  const lowerText = text.toLowerCase();

  // Explicit free patterns
  const freePatterns = [
    /\bfree\s+admission\b/,
    /\bfree\s+entry\b/,
    /\bfree\s+event\b/,
    /\bfree\s+show\b/,
    /\badmission\s+is\s+free\b/,
    /\bno\s+cover\b/,
    /\bno\s+cover\s+charge\b/,
    /\bfree\s+and\s+open\b/,
    /\bfree\s+to\s+attend\b/,
    /\bfree\s+to\s+the\s+public\b/,
    /\bcomplimentary\s+admission\b/,
    /\bcomplimentary\s+event\b/,
  ];

  for (const pattern of freePatterns) {
    if (pattern.test(lowerText)) {
      return true;
    }
  }

  // Check for standalone "free" but avoid false positives
  // (e.g., "gluten-free", "free parking", "free drinks")
  const standaloneFreeParts = lowerText.split(/[.,!?\n]/);
  for (const part of standaloneFreeParts) {
    const trimmed = part.trim();
    // Match "free" at start of sentence or as a label
    if (/^free\b/.test(trimmed) || /\bprice:\s*free\b/.test(trimmed)) {
      // Exclude false positives
      if (!/free\s+(parking|wifi|drinks?|food|snacks?|giveaway|raffle)/.test(trimmed)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if text indicates a ticketed event (even without a price).
 * Returns true if the event clearly requires tickets/admission.
 */
export function isTicketedEvent(text: string): boolean {
  if (!text) return false;

  const lowerText = text.toLowerCase();

  // Strong ticketing indicators
  const ticketPatterns = [
    /\bbuy\s+tickets?\b/,
    /\bget\s+tickets?\b/,
    /\bpurchase\s+tickets?\b/,
    /\btickets?\s+(?:on\s+sale|available|required)\b/,
    /\btickets?\s+at\b/,
    /\badmission\s+(?:fee|charge|required)\b/,
    /\badvance\s+tickets?\b/,
    /\btickets?\s+(?:start|starting)\s+at\b/,
    /\breserve\s+(?:your\s+)?(?:spot|seat|tickets?)\b/,
    /\bticketmaster\b/,
    /\beventbrite\b/,
    /\baxs\.com\b/,
    /\bsee\s+tickets\b/,
    /\bdice\.fm\b/,
    /\btickets?\s+link\b/,
    /\blink\s+(?:for|to)\s+tickets?\b/,
    /\bbox\s+office\b/,
    /\bgeneral\s+admission\b/,
    /\bvip\s+tickets?\b/,
    /\bseated\s+show\b/,
    /\bstanding\s+room\b/,
  ];

  for (const pattern of ticketPatterns) {
    if (pattern.test(lowerText)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if event is from a venue that typically requires tickets.
 * Used as a hint when other signals are ambiguous.
 */
export function isTypicallyTicketedVenue(organizer: string | null | undefined): boolean {
  if (!organizer) return false;

  const lowerOrganizer = organizer.toLowerCase();

  const ticketedVenues = [
    // Major music venues
    "orange peel",
    "grey eagle",
    "salvage station",
    "rabbit rabbit",
    // Arenas/large venues
    "harrah",
    "exploreasheville.com arena",
    "explore asheville arena",
    "thomas wolfe",
    "asheville civic center",
    "us cellular center",
    // Theaters
    "wortham center",
    "diana wortham",
    "nc stage",
    "north carolina stage",
    "asheville community theatre",
    "act asheville",
    // Comedy/shows
    "story parlor",
    "misfit improv",
    "laugh asheville",
  ];

  return ticketedVenues.some((venue) => lowerOrganizer.includes(venue));
}

/**
 * Extract price from text using regex patterns.
 * Returns null if no confident price can be extracted.
 *
 * @param text - The text to search for price information
 * @param organizer - Optional organizer name for venue-based hints
 * @returns PriceExtractionResult or null if no price found
 */
export function extractPriceFromText(
  text: string,
  organizer?: string | null
): PriceExtractionResult | null {
  // If no text but we know it's a ticketed venue, return "Ticketed"
  if (!text || text.trim().length === 0) {
    if (isTypicallyTicketedVenue(organizer)) {
      return {
        price: "Ticketed",
        confidence: "medium",
        matchedPattern: "ticketed_venue_no_description",
      };
    }
    return null;
  }

  // Check for free first
  if (isFreeEvent(text)) {
    return {
      price: "Free",
      confidence: "high",
      matchedPattern: "free_event",
    };
  }

  // Pattern 1: Price range with context (high confidence)
  // "Tickets: $15 - $30", "Admission $20-$50", "Price: $25 to $35"
  const contextualRangeMatch = text.match(
    /(?:tickets?|price|admission|cover|entry)[:\s]*\$(\d+(?:\.\d{2})?)\s*[--to]+\s*\$(\d+(?:\.\d{2})?)/i
  );
  if (contextualRangeMatch) {
    const min = Math.round(parseFloat(contextualRangeMatch[1]));
    const max = Math.round(parseFloat(contextualRangeMatch[2]));
    return {
      price: `$${min} - $${max}`,
      confidence: "high",
      matchedPattern: "contextual_range",
    };
  }

  // Pattern 2: Single price with context (high confidence)
  // "Tickets: $25", "Admission $15", "Cover: $10", "$20 tickets"
  const contextualSingleMatch =
    text.match(
      /(?:tickets?|price|admission|cover|entry)[:\s]*\$(\d+(?:\.\d{2})?)/i
    ) ||
    text.match(
      /\$(\d+(?:\.\d{2})?)\s*(?:tickets?|admission|cover|entry|per\s+person)/i
    );
  if (contextualSingleMatch) {
    const price = Math.round(parseFloat(contextualSingleMatch[1]));
    return {
      price: `$${price}`,
      confidence: "high",
      matchedPattern: "contextual_single",
    };
  }

  // Pattern 3: Advance/Door pricing (high confidence)
  // "$15 advance / $20 door", "$20 advance, $25 day of"
  const advanceDoorMatch = text.match(
    /\$(\d+(?:\.\d{2})?)\s*(?:advance|adv)\b.*?\$(\d+(?:\.\d{2})?)\s*(?:door|dos|day\s+of)/i
  );
  if (advanceDoorMatch) {
    const advance = Math.round(parseFloat(advanceDoorMatch[1]));
    const door = Math.round(parseFloat(advanceDoorMatch[2]));
    return {
      price: `$${advance} - $${door}`,
      confidence: "high",
      matchedPattern: "advance_door",
    };
  }

  // Pattern 4: Suggested donation (medium confidence)
  // "Suggested donation: $10", "Donation $15-$25"
  const donationMatch = text.match(
    /(?:suggested\s+)?donation[:\s]*\$(\d+(?:\.\d{2})?)/i
  );
  if (donationMatch) {
    const price = Math.round(parseFloat(donationMatch[1]));
    return {
      price: `$${price}`,
      confidence: "medium",
      matchedPattern: "donation",
    };
  }

  // Pattern 5: Sliding scale (medium confidence)
  // "Sliding scale $15-$30", "Pay what you can $10-$25"
  const slidingScaleMatch = text.match(
    /(?:sliding\s+scale|pay\s+what\s+you\s+can)[:\s]*\$(\d+(?:\.\d{2})?)\s*[--to]+\s*\$(\d+(?:\.\d{2})?)/i
  );
  if (slidingScaleMatch) {
    const min = Math.round(parseFloat(slidingScaleMatch[1]));
    const max = Math.round(parseFloat(slidingScaleMatch[2]));
    return {
      price: `$${min} - $${max}`,
      confidence: "medium",
      matchedPattern: "sliding_scale",
    };
  }

  // Pattern 6: Price range without context (medium confidence)
  // "$15 - $30" anywhere in text (but not part of time like "5 - 7pm")
  const standaloneRangeMatch = text.match(
    /\$(\d+(?:\.\d{2})?)\s*[--]\s*\$(\d+(?:\.\d{2})?)/
  );
  if (standaloneRangeMatch) {
    const min = Math.round(parseFloat(standaloneRangeMatch[1]));
    const max = Math.round(parseFloat(standaloneRangeMatch[2]));
    // Validate: prices should be reasonable (not like $0 or $10000)
    if (min >= 1 && max >= min && max <= 1000) {
      return {
        price: `$${min} - $${max}`,
        confidence: "medium",
        matchedPattern: "standalone_range",
      };
    }
  }

  // Pattern 7: Single price without context (low confidence)
  // Only match if preceded by common price indicators or at start of line
  // Avoid matching phone numbers, years, etc.
  const lines = text.split("\n");
  for (const line of lines) {
    // Check for prices in short lines (likely labels)
    if (line.length < 50) {
      const lineMatch = line.match(/^\s*\$(\d+(?:\.\d{2})?)\s*$/);
      if (lineMatch) {
        const price = Math.round(parseFloat(lineMatch[1]));
        if (price >= 1 && price <= 500) {
          return {
            price: `$${price}`,
            confidence: "low",
            matchedPattern: "standalone_line",
          };
        }
      }
    }
  }

  // Pattern 8: Price mentioned after "cost" or "fee" (medium confidence)
  const costMatch = text.match(
    /(?:cost|fee|costs?|fees?)[:\s]+\$(\d+(?:\.\d{2})?)/i
  );
  if (costMatch) {
    const price = Math.round(parseFloat(costMatch[1]));
    return {
      price: `$${price}`,
      confidence: "medium",
      matchedPattern: "cost_fee",
    };
  }

  // Pattern 9: "Tickets start at $X" or "starting at $X" (high confidence, return $X+)
  const startingAtMatch = text.match(
    /(?:tickets?\s+)?(?:start(?:ing)?|from)\s+(?:at\s+)?\$(\d+(?:\.\d{2})?)/i
  );
  if (startingAtMatch) {
    const price = Math.round(parseFloat(startingAtMatch[1]));
    return {
      price: `$${price}+`,
      confidence: "high",
      matchedPattern: "starting_at",
    };
  }

  // Pattern 10: Check if it's a ticketed event without a clear price
  if (isTicketedEvent(text) || isTypicallyTicketedVenue(organizer)) {
    return {
      price: "Ticketed",
      confidence: "medium",
      matchedPattern: "ticketed_event",
    };
  }

  // No price found
  return null;
}

/**
 * Apply price extraction to an event and return formatted price string.
 * Returns the original price if extraction fails or confidence is too low.
 *
 * @param description - Event description text
 * @param currentPrice - Current price value (may be "Unknown")
 * @param organizer - Optional organizer name for venue-based hints
 * @param minConfidence - Minimum confidence level to accept (default: 'medium')
 * @returns Formatted price string
 */
export function tryExtractPrice(
  description: string | null | undefined,
  currentPrice: string | null | undefined,
  organizer?: string | null,
  minConfidence: "high" | "medium" | "low" = "medium"
): string {
  // If we already have a known price, keep it
  if (currentPrice && currentPrice !== "Unknown") {
    return currentPrice;
  }

  // Try to extract from description
  const result = extractPriceFromText(description || "", organizer);

  if (!result) {
    // Last resort: check if venue typically requires tickets
    if (isTypicallyTicketedVenue(organizer)) {
      return "Ticketed";
    }
    return currentPrice || "Unknown";
  }

  // Check confidence threshold
  const confidenceLevels = { high: 3, medium: 2, low: 1 };
  const resultLevel = confidenceLevels[result.confidence];
  const minLevel = confidenceLevels[minConfidence];

  if (resultLevel >= minLevel) {
    return result.price;
  }

  return currentPrice || "Unknown";
}

// ============================================================================
// TIME EXTRACTION + APPLICATION
// ============================================================================

/**
 * Result of time extraction attempt
 */
export interface TimeExtractionResult {
  hour: number; // 0-23
  minute: number; // 0-59
  confidence: "high" | "medium" | "low";
  matchedPattern: string; // What pattern matched (for debugging)
  rawMatch: string; // The original text that was matched
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
  const isPM = ampm.toLowerCase().startsWith("p");

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
      confidence: "high",
      matchedPattern: "show_time",
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
      confidence: "high",
      matchedPattern: "doors_show",
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
      confidence: "high",
      matchedPattern: "starts_at",
      rawMatch: startsAtMatch[0],
    };
  }

  // Pattern 4: "7:00 PM - 10:00 PM" time range (medium confidence, take start)
  const timeRangeMatch = text.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[--to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
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
      confidence: "medium",
      matchedPattern: "time_range",
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
        confidence: "medium",
        matchedPattern: "time_24h",
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
      confidence: "medium",
      matchedPattern: "contextual_time",
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
        confidence: "low",
        matchedPattern: "standalone_evening",
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
  timezone: string = "America/New_York"
): Date {
  // Get the date components in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "00";

  const year = parseInt(getPart("year"), 10);
  const month = parseInt(getPart("month"), 10) - 1; // 0-indexed
  const day = parseInt(getPart("day"), 10);

  // Calculate timezone offset for the target date at the target time
  const refUtc = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const offsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const offsetParts = offsetFormatter.formatToParts(refUtc);
  const localHour = parseInt(
    offsetParts.find((p) => p.type === "hour")?.value || "12",
    10
  );
  const offsetHours = localHour - 12;

  // Create the correct UTC time
  const utcTime = new Date(
    Date.UTC(year, month, day, hour - offsetHours, minute, 0)
  );

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
  minConfidence: "high" | "medium" | "low" = "medium"
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
    const timeStr = `${result.hour.toString().padStart(2, "0")}:${result.minute
      .toString()
      .padStart(2, "0")}`;
    return {
      date: newDate,
      timeUpdated: true,
      extractedTime: timeStr,
    };
  }

  return { date, timeUpdated: false };
}

// ============================================================================
// EASTERN TIMEZONE UTILITIES
// ============================================================================

/**
 * Get start of today (midnight) in Eastern timezone (America/New_York)
 * Returns a Date object that represents 00:00:00 Eastern time
 *
 * This works correctly regardless of server timezone (e.g., UTC on Vercel)
 */
export function getStartOfTodayEastern(): Date {
  const now = new Date();

  // Get today's date in Eastern timezone (YYYY-MM-DD format)
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayEastern = formatter.format(now); // "2024-11-29" format

  // Determine current Eastern offset by checking the formatted timezone
  const nowOffset = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;

  // EST = GMT-5, EDT = GMT-4
  const offset = nowOffset?.includes("-4") ? "-04:00" : "-05:00";

  // Return midnight Eastern as a proper Date (stored as UTC internally)
  return new Date(`${todayEastern}T00:00:00${offset}`);
}

/**
 * Get current date string in Eastern timezone (YYYY-MM-DD format)
 */
export function getTodayStringEastern(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

/**
 * Format a date for display in Eastern timezone
 */
export function formatDateEastern(
  date: Date,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    ...options,
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
  const date = typeof dateStr === "string" ? new Date(`${dateStr}T12:00:00`) : dateStr;

  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;

  // EST = GMT-5, EDT = GMT-4
  return offsetPart?.includes("-4") ? "-04:00" : "-05:00";
}

/**
 * Parse a local date/time string as Eastern timezone.
 * Correctly handles DST for the given date.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timeStr - Time string in HH:MM:SS format (defaults to 19:00:00)
 * @returns Date object with correct UTC time
 */
export function parseAsEastern(
  dateStr: string,
  timeStr: string = "19:00:00"
): Date {
  const offset = getEasternOffset(dateStr);
  return new Date(`${dateStr}T${timeStr}${offset}`);
}

/**
 * Parse a local datetime string in a specific timezone and return a UTC Date.
 * Useful for APIs that provide local timestamps without timezone offsets.
 */
export function parseLocalDateInTimezone(
  localDateStr: string,
  timezone: string
): Date {
  const match = localDateStr.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) {
    return new Date(localDateStr);
  }

  const [, year, month, day, hour, minute, second = "00"] = match;

  // Create a reference point at noon UTC on the target date
  const refUtc = new Date(
    Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      12,
      0,
      0
    )
  );

  // Format this UTC time in the target timezone to see what local time it shows
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(refUtc);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "00";

  const localHour = parseInt(getPart("hour"), 10);
  const offsetHours = localHour - 12;

  return new Date(
    Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10) - offsetHours,
      parseInt(minute, 10),
      parseInt(second, 10)
    )
  );
}

/**
 * Get start of tomorrow (midnight) in Eastern timezone
 * Returns a Date object that represents 00:00:00 Eastern time tomorrow
 */
export function getStartOfTomorrowEastern(): Date {
  const todayStr = getTodayStringEastern(); // "2024-12-19"

  // Parse today and add 1 day
  const [year, month, day] = todayStr.split("-").map(Number);
  const tomorrowDate = new Date(year, month - 1, day + 1);
  const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(
    tomorrowDate.getMonth() + 1
  ).padStart(2, "0")}-${String(tomorrowDate.getDate()).padStart(2, "0")}`;

  const offset = getEasternOffset(tomorrowStr);
  return new Date(`${tomorrowStr}T00:00:00${offset}`);
}

/**
 * Get day boundaries (start and end) for a date in Eastern timezone
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns { start: Date, end: Date } representing 00:00:00 to 23:59:59.999 Eastern
 */
export function getDayBoundariesEastern(
  dateStr: string
): { start: Date; end: Date } {
  const offset = getEasternOffset(dateStr);
  const start = new Date(`${dateStr}T00:00:00${offset}`);
  const end = new Date(`${dateStr}T23:59:59.999${offset}`);
  return { start, end };
}
