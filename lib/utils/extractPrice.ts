/**
 * Regex-based price extraction from event text/descriptions.
 *
 * This utility attempts to extract price information from unstructured text.
 * It should be used as a fallback when structured API price data is unavailable.
 *
 * Price categories:
 * - "Free" - explicitly free events
 * - "$20" - known exact price
 * - "$20+" - known minimum price (ticketed shows)
 * - "$15 - $30" - price range
 * - "Ticketed" - tickets required but price unknown
 * - null - truly unknown (needs AI fallback)
 */

/**
 * Result of price extraction attempt
 */
export interface PriceExtractionResult {
  price: string;          // Formatted price: "Free", "$20", "$20+", "Ticketed"
  confidence: 'high' | 'medium' | 'low';
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
    'orange peel',
    'grey eagle',
    'salvage station',
    'rabbit rabbit',
    // Arenas/large venues
    'harrah',
    'exploreasheville.com arena',
    'explore asheville arena',
    'thomas wolfe',
    'asheville civic center',
    'us cellular center',
    // Theaters
    'wortham center',
    'diana wortham',
    'nc stage',
    'north carolina stage',
    'asheville community theatre',
    'act asheville',
    // Comedy/shows
    'story parlor',
    'misfit improv',
    'laugh asheville',
  ];

  return ticketedVenues.some(venue => lowerOrganizer.includes(venue));
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
        price: 'Ticketed',
        confidence: 'medium',
        matchedPattern: 'ticketed_venue_no_description',
      };
    }
    return null;
  }

  // Check for free first
  if (isFreeEvent(text)) {
    return {
      price: 'Free',
      confidence: 'high',
      matchedPattern: 'free_event',
    };
  }

  // Pattern 1: Price range with context (high confidence)
  // "Tickets: $15 - $30", "Admission $20-$50", "Price: $25 to $35"
  const contextualRangeMatch = text.match(
    /(?:tickets?|price|admission|cover|entry)[:\s]*\$(\d+(?:\.\d{2})?)\s*[-–to]+\s*\$(\d+(?:\.\d{2})?)/i
  );
  if (contextualRangeMatch) {
    const min = Math.round(parseFloat(contextualRangeMatch[1]));
    const max = Math.round(parseFloat(contextualRangeMatch[2]));
    return {
      price: `$${min} - $${max}`,
      confidence: 'high',
      matchedPattern: 'contextual_range',
    };
  }

  // Pattern 2: Single price with context (high confidence)
  // "Tickets: $25", "Admission $15", "Cover: $10", "$20 tickets"
  const contextualSingleMatch = text.match(
    /(?:tickets?|price|admission|cover|entry)[:\s]*\$(\d+(?:\.\d{2})?)/i
  ) || text.match(
    /\$(\d+(?:\.\d{2})?)\s*(?:tickets?|admission|cover|entry|per\s+person)/i
  );
  if (contextualSingleMatch) {
    const price = Math.round(parseFloat(contextualSingleMatch[1]));
    return {
      price: `$${price}`,
      confidence: 'high',
      matchedPattern: 'contextual_single',
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
      confidence: 'high',
      matchedPattern: 'advance_door',
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
      confidence: 'medium',
      matchedPattern: 'donation',
    };
  }

  // Pattern 5: Sliding scale (medium confidence)
  // "Sliding scale $15-$30", "Pay what you can $10-$25"
  const slidingScaleMatch = text.match(
    /(?:sliding\s+scale|pay\s+what\s+you\s+can)[:\s]*\$(\d+(?:\.\d{2})?)\s*[-–to]+\s*\$(\d+(?:\.\d{2})?)/i
  );
  if (slidingScaleMatch) {
    const min = Math.round(parseFloat(slidingScaleMatch[1]));
    const max = Math.round(parseFloat(slidingScaleMatch[2]));
    return {
      price: `$${min} - $${max}`,
      confidence: 'medium',
      matchedPattern: 'sliding_scale',
    };
  }

  // Pattern 6: Price range without context (medium confidence)
  // "$15 - $30" anywhere in text (but not part of time like "5 - 7pm")
  const standaloneRangeMatch = text.match(
    /\$(\d+(?:\.\d{2})?)\s*[-–]\s*\$(\d+(?:\.\d{2})?)/
  );
  if (standaloneRangeMatch) {
    const min = Math.round(parseFloat(standaloneRangeMatch[1]));
    const max = Math.round(parseFloat(standaloneRangeMatch[2]));
    // Validate: prices should be reasonable (not like $0 or $10000)
    if (min >= 1 && max >= min && max <= 1000) {
      return {
        price: `$${min} - $${max}`,
        confidence: 'medium',
        matchedPattern: 'standalone_range',
      };
    }
  }

  // Pattern 7: Single price without context (low confidence)
  // Only match if preceded by common price indicators or at start of line
  // Avoid matching phone numbers, years, etc.
  const lines = text.split('\n');
  for (const line of lines) {
    // Check for prices in short lines (likely labels)
    if (line.length < 50) {
      const lineMatch = line.match(/^\s*\$(\d+(?:\.\d{2})?)\s*$/);
      if (lineMatch) {
        const price = Math.round(parseFloat(lineMatch[1]));
        if (price >= 1 && price <= 500) {
          return {
            price: `$${price}`,
            confidence: 'low',
            matchedPattern: 'standalone_line',
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
      confidence: 'medium',
      matchedPattern: 'cost_fee',
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
      confidence: 'high',
      matchedPattern: 'starting_at',
    };
  }

  // Pattern 10: Check if it's a ticketed event without a clear price
  if (isTicketedEvent(text) || isTypicallyTicketedVenue(organizer)) {
    return {
      price: 'Ticketed',
      confidence: 'medium',
      matchedPattern: 'ticketed_event',
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
  minConfidence: 'high' | 'medium' | 'low' = 'medium'
): string {
  // If we already have a known price, keep it
  if (currentPrice && currentPrice !== 'Unknown') {
    return currentPrice;
  }

  // Try to extract from description
  const result = extractPriceFromText(description || '', organizer);

  if (!result) {
    // Last resort: check if venue typically requires tickets
    if (isTypicallyTicketedVenue(organizer)) {
      return 'Ticketed';
    }
    return currentPrice || 'Unknown';
  }

  // Check confidence threshold
  const confidenceLevels = { high: 3, medium: 2, low: 1 };
  const resultLevel = confidenceLevels[result.confidence];
  const minLevel = confidenceLevels[minConfidence];

  if (resultLevel >= minLevel) {
    return result.price;
  }

  return currentPrice || 'Unknown';
}
