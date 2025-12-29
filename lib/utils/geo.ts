/**
 * Geo/location utilities for Asheville-area events.
 *
 * Includes:
 * - City extraction + Asheville area checks
 * - Non-NC filtering
 * - Zip code estimation from coords/cities
 */

import { ASHEVILLE_VENUES, KNOWN_CITIES } from "./geo-constants";

// Known NON-NC cities that sometimes appear in results
// These should NOT be included in "Asheville area" filter
const NON_NC_CITIES = [
  // South Carolina
  "travelers rest",
  "taylors",
  "greer",
  "wellford",
  "boiling springs", // SC version - be careful, there might be NC too
  "easley",
  "inman",
  "pickens",
  "campobello",
  "greenville", // SC
  "spartanburg",

  // Tennessee
  "jonesborough",
  "telford",
  "cosby",
  "gatlinburg",
  "pigeon forge",
  "sevierville",
  "knoxville",
  "johnson city",

  // Georgia
  "atlanta",

  // Other
  "hudson falls", // NY
];

// NC cities we want to keep (within ~45 min of Asheville)
const NC_LOCATIONS = [
  /\bAsheville\b/i,
  /\bNC\b/i,
  /\bNorth Carolina\b/i,
  // Core Asheville area
  /\bBiltmore\b/i,
  /\bBlack Mountain\b/i,
  /\bWeaverville\b/i,
  /\bSwannanoa\b/i,
  /\bCandler\b/i,
  /\bEnka\b/i,
  /\bFletcher\b/i,
  /\bArden\b/i,
  /\bFairview\b/i,
  /\bLeicester\b/i,
  /\bBarnardsville\b/i,
  /\bWoodfin\b/i,
  /\bSkyland\b/i,
  /\bRoyal Pines\b/i,
  // Within 30 min
  /\bMontreat\b/i,
  /\bMills River\b/i,
  /\bMarshall\b/i,
  /\bCanton\b/i,
  /\bClyde\b/i,
  /\bWaynesville\b/i,
  /\bFlat Rock\b/i,
  /\bHendersonville\b/i,
  // Within 45 min
  /\bBrevard\b/i,
  /\bLake Junaluska\b/i,
  /\bLake Lure\b/i,
  /\bSaluda\b/i,
  /\bCedar Mountain\b/i,
  /\bBurnsville\b/i,
  /\bBakersville\b/i,
  /\bCherokee\b/i,
  /\bMars Hill\b/i,
  /\bMaggie Valley\b/i,
  /\bOld Fort\b/i,
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
const NON_NC_CITY_PATTERNS = [
  // South Carolina (Greenville/Spartanburg area)
  /\bGreenville\b/i,
  /\bSpartanburg\b/i,
  /\bTaylors\b/i,
  /\bGreer\b/i,
  /\bTravelers Rest\b/i,
  /\bSlater-Marietta\b/i,
  /\bSlater Marietta\b/i,
  /\bWellford\b/i,
  /\bEasley\b/i,
  /\bPickens\b/i,
  /\bInman\b/i,
  /\bCampobello\b/i,
  /\bBoiling Springs\b/i,
  /\bSimpsonville\b/i,
  /\bMauldin\b/i,
  /\bFountain Inn\b/i,
  /\bPiedmont\b/i,
  /\bPelzer\b/i,
  /\bWilliamston\b/i,
  /\bPowdersville\b/i,
  /\bAnderson\b/i,
  // South Carolina (other)
  /\bCharleston\b/i,
  /\bMyrtle Beach\b/i,
  /\bColumbia\b/i,
  // Georgia
  /\bAtlanta\b/i,
  // Tennessee
  /\bKnoxville\b/i,
  /\bChattanooga\b/i,
  /\bNashville\b/i,
  /\bJohnson City\b/i,
  /\bGreeneville\b/i, // TN (different spelling from Greenville SC)
  /\bJonesborough\b/i,
  /\bTelford\b/i,
  /\bCosby\b/i,
  /\bErwin\b/i,
  /\bElizabethton\b/i,
  /\bKingsport\b/i,
  /\bBristol\b/i,
  // Virginia
  /\bRoanoke\b/i,
  // Far NC (too far from Asheville, >60 min)
  /\bMill Spring\b/i,
  /\bTryon\b/i,
  /\bRutherfordton\b/i,
  /\bColumbus\b/i, // NC (Polk County, far south)
  /\bBostic\b/i,
  /\bMooresboro\b/i,
  /\bSpindale\b/i,
  /\bForest City\b/i,
  /\bBlowing Rock\b/i,
  /\bTweetsie\b/i,
  /\bBoone\b/i,
  /\bBanner Elk\b/i,
  /\bBryson City\b/i,
  /\bSylva\b/i,
  /\bFranklin\b/i,
  /\bMorganton\b/i,
  /\bNewland\b/i,
  /\bHighlands\b/i,
  /\bLake Toxaway\b/i,
];

interface ZipZone {
  zip: string;
  name: string;
  // Bounding box: [minLat, maxLat, minLng, maxLng]
  bounds: [number, number, number, number];
}

// Approximate bounding boxes for Asheville area zip codes
// These are rough approximations - zip code boundaries are irregular
const ZIP_ZONES: ZipZone[] = [
  // Black Mountain area
  { zip: "28711", name: "Black Mountain", bounds: [35.58, 35.68, -82.38, -82.28] },

  // West Asheville / Candler
  { zip: "28806", name: "West Asheville", bounds: [35.54, 35.62, -82.62, -82.54] },

  // South Asheville / Biltmore
  { zip: "28803", name: "South Asheville", bounds: [35.48, 35.56, -82.58, -82.48] },

  // East Asheville / Swannanoa
  { zip: "28805", name: "East Asheville", bounds: [35.56, 35.64, -82.48, -82.40] },

  // North Asheville / Weaverville area
  { zip: "28804", name: "North Asheville", bounds: [35.62, 35.72, -82.58, -82.48] },

  // Arden
  { zip: "28704", name: "Arden", bounds: [35.42, 35.50, -82.56, -82.46] },

  // Weaverville
  { zip: "28787", name: "Weaverville", bounds: [35.68, 35.76, -82.58, -82.48] },

  // Woodfin
  { zip: "28804", name: "Woodfin", bounds: [35.62, 35.68, -82.54, -82.48] },

  // Downtown Asheville (default area)
  { zip: "28801", name: "Downtown Asheville", bounds: [35.56, 35.62, -82.58, -82.52] },
];

const CITY_ZIPS: Record<string, string> = {
  // Core Asheville area
  asheville: "28801",
  "black mountain": "28711",
  weaverville: "28787",
  arden: "28704",
  fletcher: "28732",
  candler: "28715",
  leicester: "28748",
  swannanoa: "28778",
  woodfin: "28804",
  fairview: "28730",
  enka: "28806",
  skyland: "28803",
  "royal pines": "28704",
  // Within 30 min
  montreat: "28757",
  "mills river": "28759",
  marshall: "28753",
  canton: "28716",
  clyde: "28721",
  waynesville: "28786",
  "flat rock": "28731",
  hendersonville: "28739",
  // Within 45 min
  brevard: "28712",
  "lake junaluska": "28745",
  "lake lure": "28746",
  saluda: "28773",
  "cedar mountain": "28718",
  burnsville: "28714",
  bakersville: "28705",
  cherokee: "28719",
  "mars hill": "28754",
  alexander: "28701",
  "old fort": "28762",
  "maggie valley": "28751",
};

/**
 * Extract city name from a location string.
 *
 * @param location - The location string (e.g., "Asheville, NC", "Black Mountain @ Venue", "The Orange Peel")
 * @returns The city name if recognized, "Online" for online events, or null for unknown locations
 */
export function extractCity(location: string | null | undefined): string | null {
  if (!location) return null;

  const lowerLocation = location.toLowerCase().trim();

  // Check for online events
  if (lowerLocation === "online") return "Online";

  // Check if it's a known Asheville venue first
  for (const venue of ASHEVILLE_VENUES) {
    if (lowerLocation.includes(venue)) {
      return "Asheville";
    }
  }

  // Check if it's a known non-NC city (exclude these)
  for (const nonNCCity of NON_NC_CITIES) {
    if (lowerLocation.includes(nonNCCity)) {
      return null;
    }
  }

  // Check each known NC city (case insensitive)
  for (const city of KNOWN_CITIES) {
    const cityLower = city.toLowerCase();
    if (lowerLocation.includes(cityLower)) {
      return city;
    }
  }

  return null;
}

/**
 * Check if a location is a known Asheville venue.
 * Used to determine if unknown locations should be included in "Asheville area".
 */
export function isKnownAshevilleVenue(location: string | null | undefined): boolean {
  if (!location) return false;
  const lowerLocation = location.toLowerCase().trim();
  return ASHEVILLE_VENUES.some((venue) => lowerLocation.includes(venue));
}

/**
 * Check if a location is likely from a non-NC area.
 * Used to exclude events that slipped through server-side filters.
 */
export function isNonNCLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  const lowerLocation = location.toLowerCase().trim();
  return NON_NC_CITIES.some((city) => lowerLocation.includes(city));
}

/**
 * Check if a location should be included in the "Asheville area" filter.
 * Includes: Asheville city + known Asheville venues
 * Excludes: Other NC cities, non-NC cities, and truly unknown locations
 */
export function isAshevilleArea(location: string | null | undefined): boolean {
  const city = extractCity(location);

  // Explicitly Asheville
  if (city === "Asheville") return true;

  // If no city extracted, check if it's a known venue
  if (city === null) {
    return isKnownAshevilleVenue(location);
  }

  return false;
}

/**
 * Check if location field indicates NC
 */
function isNCLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return NC_LOCATIONS.some((pattern) => pattern.test(location));
}

/**
 * Check if location field indicates non-NC
 */
function isNonNCLocationPattern(location: string | null | undefined): boolean {
  if (!location) return false;

  // Check for non-NC state patterns
  if (NON_NC_LOCATION_PATTERNS.some((pattern) => pattern.test(location))) {
    return true;
  }

  // Check for non-NC cities (only if location doesn't also mention NC)
  if (!isNCLocation(location)) {
    if (NON_NC_CITY_PATTERNS.some((pattern) => pattern.test(location))) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if an event should be filtered out (is NOT in NC).
 * Returns true if the event should be REMOVED.
 */
export function isNonNCEvent(
  title: string,
  location: string | null | undefined
): boolean {
  // First, check the location field (most reliable)
  if (isNCLocation(location)) {
    // Location explicitly says NC - keep it regardless of title
    return false;
  }

  if (isNonNCLocationPattern(location)) {
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

  return titleNonNCPatterns.some((pattern) => pattern.test(title));
}

/**
 * Get a reason why an event was flagged as non-NC (for logging)
 */
export function getNonNCReason(
  title: string,
  location: string | null | undefined
): string | null {
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
      for (const pattern of NON_NC_CITY_PATTERNS) {
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

/**
 * Check if coordinates fall within a bounding box
 */
function isInBounds(
  lat: number,
  lng: number,
  bounds: [number, number, number, number]
): boolean {
  const [minLat, maxLat, minLng, maxLng] = bounds;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

/**
 * Estimate zip code from latitude and longitude coordinates.
 * Returns the zip code string or undefined if coordinates are too far from Asheville area.
 */
export function getZipFromCoords(
  lat: number | undefined,
  lng: number | undefined
): string | undefined {
  if (lat === undefined || lng === undefined) {
    return undefined;
  }

  // Check if within broader Asheville area (roughly 35.4 to 35.8 lat, -82.7 to -82.2 lng)
  if (lat < 35.4 || lat > 35.8 || lng < -82.7 || lng > -82.2) {
    return undefined; // Outside Asheville metro area
  }

  // Check each zone
  for (const zone of ZIP_ZONES) {
    if (isInBounds(lat, lng, zone.bounds)) {
      return zone.zip;
    }
  }

  // Default to downtown Asheville if in the general area but no specific zone matched
  return "28801";
}

/**
 * Get zip code from city name for the Asheville area.
 * Useful as fallback when coordinates aren't available.
 */
export function getZipFromCity(city: string | undefined): string | undefined {
  if (!city) return undefined;

  const cityLower = city.toLowerCase().trim();
  return CITY_ZIPS[cityLower];
}

export { ASHEVILLE_VENUES, KNOWN_CITIES };
