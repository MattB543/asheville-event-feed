/**
 * Location filter utility for filtering out non-NC events.
 *
 * Strategy:
 * 1. If location explicitly mentions NC cities/state -> keep it
 * 2. If location explicitly mentions non-NC states -> filter it
 * 3. If title has non-NC patterns AND location doesn't confirm NC -> filter it
 */

// NC cities we want to keep (case insensitive)
const NC_LOCATIONS = [
  /\bAsheville\b/i,
  /\bNC\b/i,
  /\bNorth Carolina\b/i,
  /\bBiltmore\b/i,
  /\bBlack Mountain\b/i,
  /\bWeaverville\b/i,
  /\bSwannanoa\b/i,
  /\bHendersonville\b/i,
  /\bBrevard\b/i,
  /\bMarshall\b/i,
  /\bWaynesville\b/i,
  /\bMaggie Valley\b/i,
  /\bBoone\b/i,
  /\bBlowing Rock\b/i,
  /\bBanner Elk\b/i,
  /\bFlat Rock\b/i,
  /\bMills River\b/i,
  /\bCandler\b/i,
  /\bEnka\b/i,
  /\bFletcher\b/i,
  /\bArden\b/i,
  /\bFairview\b/i,
  /\bLeicester\b/i,
  /\bBarnardsville\b/i,
  /\bWoodfin\b/i,
];

// Non-NC state patterns (in location field = definitely filter)
const NON_NC_LOCATION_PATTERNS = [
  /, SC\b/i,
  /, GA\b/i,
  /, TN\b/i,
  /, VA\b/i,
  /\bSouth Carolina\b/i,
  /\bGeorgia\b/i,
  /\bTennessee\b/i,
  /\bVirginia\b/i,
];

// Non-NC cities that should be filtered (when in location field)
const NON_NC_CITIES = [
  /\bGreenville\b/i,     // SC
  /\bSpartanburg\b/i,    // SC
  /\bCharleston\b/i,     // SC
  /\bMyrtle Beach\b/i,   // SC
  /\bColumbia\b/i,       // SC (be careful, could be generic)
  /\bAtlanta\b/i,        // GA
  /\bKnoxville\b/i,      // TN
  /\bChattanooga\b/i,    // TN
  /\bNashville\b/i,      // TN
  /\bJohnson City\b/i,   // TN
  /\bBristol\b/i,        // TN/VA
  /\bRoanoke\b/i,        // VA
];

/**
 * Check if location field indicates NC
 */
function isNCLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return NC_LOCATIONS.some(pattern => pattern.test(location));
}

/**
 * Check if location field indicates non-NC
 */
function isNonNCLocation(location: string | null | undefined): boolean {
  if (!location) return false;

  // Check for non-NC state patterns
  if (NON_NC_LOCATION_PATTERNS.some(pattern => pattern.test(location))) {
    return true;
  }

  // Check for non-NC cities (only if location doesn't also mention NC)
  if (!isNCLocation(location)) {
    if (NON_NC_CITIES.some(pattern => pattern.test(location))) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if an event should be filtered out (is NOT in NC).
 * Returns true if the event should be REMOVED.
 */
export function isNonNCEvent(title: string, location: string | null | undefined): boolean {
  // First, check the location field (most reliable)
  if (isNCLocation(location)) {
    // Location explicitly says NC - keep it regardless of title
    return false;
  }

  if (isNonNCLocation(location)) {
    // Location explicitly says non-NC - filter it
    return true;
  }

  // Location is ambiguous or null, check title for strong non-NC indicators
  // Only filter if title has ", SC" or similar (not just city names which could be band origins)
  const titleNonNCPatterns = [
    /, SC\b/i,
    /, GA\b/i,
    /, TN\b/i,
    /, VA\b/i,
    /\bin Greenville\b/i,
    /\bin Atlanta\b/i,
    /\bin Knoxville\b/i,
    /\bin Charleston\b/i,
    /\bin Spartanburg\b/i,
    /\bin Columbia, SC\b/i,
    /\bin Nashville\b/i,
    /\bin Chattanooga\b/i,
  ];

  return titleNonNCPatterns.some(pattern => pattern.test(title));
}

/**
 * Get a reason why an event was flagged as non-NC (for logging)
 */
export function getNonNCReason(title: string, location: string | null | undefined): string | null {
  if (isNCLocation(location)) {
    return null;
  }

  if (location) {
    for (const pattern of NON_NC_LOCATION_PATTERNS) {
      if (pattern.test(location)) {
        return `Location contains non-NC state: ${location}`;
      }
    }

    if (!isNCLocation(location)) {
      for (const pattern of NON_NC_CITIES) {
        if (pattern.test(location)) {
          return `Location contains non-NC city: ${location}`;
        }
      }
    }
  }

  const titlePatterns = [
    { pattern: /, SC\b/i, reason: "Title contains ', SC'" },
    { pattern: /, GA\b/i, reason: "Title contains ', GA'" },
    { pattern: /, TN\b/i, reason: "Title contains ', TN'" },
    { pattern: /, VA\b/i, reason: "Title contains ', VA'" },
    { pattern: /\bin Greenville\b/i, reason: "Title mentions 'in Greenville'" },
    { pattern: /\bin Atlanta\b/i, reason: "Title mentions 'in Atlanta'" },
    { pattern: /\bin Knoxville\b/i, reason: "Title mentions 'in Knoxville'" },
    { pattern: /\bin Charleston\b/i, reason: "Title mentions 'in Charleston'" },
  ];

  for (const { pattern, reason } of titlePatterns) {
    if (pattern.test(title)) {
      return reason;
    }
  }

  return null;
}
