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
  ['tbirds', ['t birds', 'tbirds weaverville', 't birds weaverville']],
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
      'thomas wolfe auditorium',
      // Not bare "thomas wolfe": that is also the Thomas Wolfe Memorial, a different site.
      'us cellular center',
      'civic center asheville',
      'exploreasheville arena',
      'explore asheville arena',
    ],
  ],

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

/** Shortest venue name (normalized) Pattern 4 will find inside a longer location. */
const MIN_CONTAINED_NAME_LENGTH = 4;

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

  // Pattern 3: The whole location, or its first comma-separated part ("The Odd,
  // 1045 Haywood Rd"), is a known venue
  if (getCanonicalVenue(location)) {
    return location;
  }
  const firstPart = location.split(',')[0].trim();
  if (getCanonicalVenue(firstPart)) {
    return firstPart;
  }

  // Pattern 4: Location contains a known venue name, as whole words. A raw
  // substring match read "Toddler" as The Odd and "Activity" as ACT; names this
  // short are only trusted whole (Pattern 3).
  const normalized = ` ${normalizeVenueName(location)} `;
  for (const [canonical, aliases] of KNOWN_VENUES) {
    for (const name of [canonical, ...aliases.map(normalizeVenueName)]) {
      if (name.length >= MIN_CONTAINED_NAME_LENGTH && normalized.includes(` ${name} `)) {
        return canonical;
      }
    }
  }

  return null;
}

/**
 * Get venue from organizer, location, or title.
 * For sources like AVL Today, the organizer IS the venue.
 * For sources like Eventbrite, the venue is in the location field.
 * Some events have the venue in the title (e.g., "@ Tbirds").
 */
export function getVenueForEvent(
  organizer: string | null | undefined,
  location: string | null | undefined,
  title?: string | null
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

  // Finally the title, but only where it names the venue: "Show @ Venue", or
  // "Show at <known venue>" ("Oktoberfest at the Funkatorium"). Searching the
  // whole title found venues in ordinary words ("Toddler" -> The Odd,
  // "Character" -> ACT) and in sponsors ("Sierra Nevada ... Party on The Roof").
  if (title) {
    const atVenue = title.match(/@\s*(.+)$/)?.[1]?.trim();
    if (atVenue) {
      return getCanonicalVenue(atVenue) || normalizeVenueName(atVenue);
    }
    // Lookahead so every "at" is tried, not just the first ("Look at Me at The Odd")
    for (const match of title.matchAll(/\bat\s+(?=(.+))/gi)) {
      const venue = knownVenueAtStart(match[1]);
      if (venue) return venue;
    }
  }

  return null;
}

/** The known venue a phrase starts with ("the Funkatorium on Coxe" -> "wicked weed"). */
function knownVenueAtStart(text: string): string | null {
  const normalized = `${normalizeVenueName(text)} `;
  for (const [canonical, aliases] of KNOWN_VENUES) {
    for (const name of [canonical, ...aliases.map(normalizeVenueName)]) {
      if (name.length >= MIN_CONTAINED_NAME_LENGTH && normalized.startsWith(`${name} `)) {
        return canonical;
      }
    }
  }
  return null;
}
