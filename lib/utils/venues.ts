/**
 * Venue utilities for event deduplication.
 *
 * Provides venue extraction from location strings, normalization,
 * and a registry of known Asheville-area venues with aliases.
 */

/**
 * Known Asheville-area venues with their aliases.
 * Key is the canonical normalized name, values are aliases that should match.
 */
const KNOWN_VENUES: Map<string, string[]> = new Map([
  // Major music venues
  ['orange peel', ['the orange peel', 'theorangepeel', 'orange peel social hall', 'pulp']],
  ['grey eagle', ['the grey eagle', 'grey eagle taqueria', 'greyeagle', 'gray eagle']],
  ['salvage station', ['salvage station asheville', 'the salvage station']],
  ['asheville music hall', ['the asheville music hall', 'amh']],
  ['isis music hall', ['isis', 'the isis', 'isis restaurant', 'isis asheville']],
  ['rabbit rabbit', ['rabbit rabbit asheville', 'the rabbit rabbit']],

  // Bars/small venues
  ['vowl bar', ['vowl', 'the vowl bar', 'vowl asheville']],
  ['fleetwoods', ['fleetwoods asheville', "fleetwood's"]],
  ['odd', ['odd asheville', 'the odd']],
  ['mothlight', ['the mothlight', 'mothlight asheville']],
  ['static age records', ['static age', 'static age asheville']],

  // Large venues
  [
    'harrahs cherokee center',
    [
      'harrahs cherokee center asheville',
      'hcca',
      "harrah's cherokee center",
      "harrah's cherokee center asheville",
      'harrahs',
      'harrahs asheville',
    ],
  ],
  ['thomas wolfe auditorium', ['thomas wolfe', 'the thomas wolfe auditorium']],
  ['us cellular center', ['us cellular', 'civic center']],
  ['exploreasheville arena', ['exploreasheville.com arena', 'explore asheville arena']],

  // Breweries with events
  ['highland brewing', ['highland brewing company', 'highland brewery', 'highland asheville']],
  ['burial beer', ['burial beer co', 'burial brewing', 'burial asheville']],
  ['new belgium', ['new belgium brewing', 'new belgium asheville']],
  [
    'sierra nevada',
    ['sierra nevada brewing', 'sierra nevada mills river', 'sierra nevada taproom'],
  ],
  ['wicked weed', ['wicked weed brewing', 'wicked weed funkatorium', 'funkatorium']],
  ['bhramari', ['bhramari brewing', 'bhramari brewhouse']],
  ['zillicoah', ['zillicoah beer', 'zillicoah beer co']],

  // Theaters/Arts
  [
    'asheville community theatre',
    ['act', 'asheville community theater', 'the asheville community theatre'],
  ],
  ['diana wortham', ['diana wortham theatre', 'diana wortham theater', 'wortham theatre']],
  ['pack square park', ['pack square', 'pack square asheville']],
  ['pritchard park', ['pritchard park asheville']],
  ['grove arcade', ['the grove arcade', 'grove arcade asheville']],

  // Other venues
  ['highland brewing meadow', ['highland meadow', 'the meadow at highland']],
  ['rabbit rabbit meadow', ['the meadow at rabbit rabbit']],
  ['pisgah brewing', ['pisgah brewing company', 'pisgah brewery']],
  ['catawba brewing', ['catawba brewing co', 'catawba brewery']],
  ['asheville guitar bar', ['guitar bar', 'the guitar bar']],
  ['ambrose west', ['ambrose west asheville', 'the ambrose west']],
]);

/**
 * Build a reverse lookup map: alias -> canonical name
 */
function buildAliasMap(): Map<string, string> {
  const aliasMap = new Map<string, string>();

  for (const [canonical, aliases] of KNOWN_VENUES) {
    // Add canonical name to itself
    aliasMap.set(canonical, canonical);

    // Add all aliases
    for (const alias of aliases) {
      aliasMap.set(normalizeVenueName(alias), canonical);
    }
  }

  return aliasMap;
}

const ALIAS_MAP = buildAliasMap();

/**
 * Normalize a venue name for comparison.
 * Removes articles, punctuation, common suffixes, and normalizes whitespace.
 */
export function normalizeVenueName(venue: string): string {
  return (
    venue
      .toLowerCase()
      // Remove possessive apostrophes and their s
      .replace(/'s\b/g, 's')
      .replace(/[']/g, '')
      // Remove common articles and prefixes
      .replace(/^the\s+/i, '')
      // Remove common suffixes
      .replace(/\s+(asheville|avl|nc)$/i, '')
      // Remove punctuation
      .replace(/[^\w\s]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Get the canonical venue name if this is a known venue.
 * Returns null if not a known venue.
 */
export function getCanonicalVenue(venue: string | null | undefined): string | null {
  if (!venue) return null;

  const normalized = normalizeVenueName(venue);
  return ALIAS_MAP.get(normalized) || null;
}

/**
 * Check if a string represents a known venue.
 */
export function isKnownVenue(venue: string | null | undefined): boolean {
  return getCanonicalVenue(venue) !== null;
}

/**
 * Extract venue name from a location string.
 *
 * Handles common patterns:
 * - "Asheville @ The Orange Peel" -> "The Orange Peel"
 * - "Asheville, NC @ Highland Brewing" -> "Highland Brewing"
 * - "The Orange Peel" -> "The Orange Peel"
 * - "Downtown Asheville" -> null (no specific venue)
 */
export function extractVenueFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;

  // Pattern 1: "City @ Venue" or "City, State @ Venue"
  const atPattern = /@\s*(.+)$/i;
  const atMatch = location.match(atPattern);
  if (atMatch) {
    return atMatch[1].trim();
  }

  // Pattern 2: "Venue - City" or "Venue | City"
  const dashPattern = /^(.+?)\s*[-|]\s*(?:asheville|avl|nc)/i;
  const dashMatch = location.match(dashPattern);
  if (dashMatch) {
    return dashMatch[1].trim();
  }

  // Pattern 3: Check if the whole location is a known venue
  const canonical = getCanonicalVenue(location);
  if (canonical) {
    return location;
  }

  // Pattern 4: Location contains a known venue name
  const normalized = normalizeVenueName(location);
  for (const [canonical, aliases] of KNOWN_VENUES) {
    if (normalized.includes(canonical)) {
      return canonical;
    }
    for (const alias of aliases) {
      const normalizedAlias = normalizeVenueName(alias);
      if (normalized.includes(normalizedAlias)) {
        return canonical;
      }
    }
  }

  return null;
}

/**
 * Get venue from either the organizer field or extracted from location.
 * For sources like AVL Today, the organizer IS the venue.
 * For sources like Eventbrite, the venue is in the location field.
 */
export function getVenueForEvent(
  organizer: string | null | undefined,
  location: string | null | undefined
): string | null {
  // First try organizer (for AVL Today, venue scrapers, etc.)
  const orgVenue = getCanonicalVenue(organizer);
  if (orgVenue) {
    return orgVenue;
  }

  // Then try extracting from location
  const locVenue = extractVenueFromLocation(location);
  if (locVenue) {
    return getCanonicalVenue(locVenue) || normalizeVenueName(locVenue);
  }

  return null;
}

/**
 * Check if two venues are the same (handles aliases).
 */
export function venuesMatch(
  venue1: string | null | undefined,
  venue2: string | null | undefined
): boolean {
  if (!venue1 || !venue2) return false;

  const canonical1 = getCanonicalVenue(venue1) || normalizeVenueName(venue1);
  const canonical2 = getCanonicalVenue(venue2) || normalizeVenueName(venue2);

  return canonical1 === canonical2;
}

/**
 * Get all known venue canonical names (for testing/debugging).
 */
export function getAllKnownVenues(): string[] {
  return Array.from(KNOWN_VENUES.keys());
}
