/**
 * Utility to estimate zip code from lat/lng coordinates for the Asheville, NC area.
 * Uses approximate geographic boundaries for major zip codes.
 * Falls back to 28801 (downtown Asheville) if coordinates don't match known areas.
 */

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
  { zip: '28711', name: 'Black Mountain', bounds: [35.58, 35.68, -82.38, -82.28] },

  // West Asheville / Candler
  { zip: '28806', name: 'West Asheville', bounds: [35.54, 35.62, -82.62, -82.54] },

  // South Asheville / Biltmore
  { zip: '28803', name: 'South Asheville', bounds: [35.48, 35.56, -82.58, -82.48] },

  // East Asheville / Swannanoa
  { zip: '28805', name: 'East Asheville', bounds: [35.56, 35.64, -82.48, -82.40] },

  // North Asheville / Weaverville area
  { zip: '28804', name: 'North Asheville', bounds: [35.62, 35.72, -82.58, -82.48] },

  // Arden
  { zip: '28704', name: 'Arden', bounds: [35.42, 35.50, -82.56, -82.46] },

  // Weaverville
  { zip: '28787', name: 'Weaverville', bounds: [35.68, 35.76, -82.58, -82.48] },

  // Woodfin
  { zip: '28804', name: 'Woodfin', bounds: [35.62, 35.68, -82.54, -82.48] },

  // Downtown Asheville (default area)
  { zip: '28801', name: 'Downtown Asheville', bounds: [35.56, 35.62, -82.58, -82.52] },
];

/**
 * Check if coordinates fall within a bounding box
 */
function isInBounds(lat: number, lng: number, bounds: [number, number, number, number]): boolean {
  const [minLat, maxLat, minLng, maxLng] = bounds;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

/**
 * Estimate zip code from latitude and longitude coordinates.
 * Returns the zip code string or undefined if coordinates are too far from Asheville area.
 *
 * @param lat - Latitude (e.g., 35.5951)
 * @param lng - Longitude (e.g., -82.5515)
 * @returns Estimated zip code or undefined
 */
export function getZipFromCoords(lat: number | undefined, lng: number | undefined): string | undefined {
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
  return '28801';
}

/**
 * Get zip code from city name for the Asheville area.
 * Useful as fallback when coordinates aren't available.
 *
 * @param city - City name (e.g., "Asheville", "Black Mountain")
 * @returns Default zip code for the city or undefined
 */
export function getZipFromCity(city: string | undefined): string | undefined {
  if (!city) return undefined;

  const cityLower = city.toLowerCase().trim();

  const cityZips: Record<string, string> = {
    // Core Asheville area
    'asheville': '28801',
    'black mountain': '28711',
    'weaverville': '28787',
    'arden': '28704',
    'fletcher': '28732',
    'candler': '28715',
    'leicester': '28748',
    'swannanoa': '28778',
    'woodfin': '28804',
    'fairview': '28730',
    'enka': '28806',
    'skyland': '28803',
    'royal pines': '28704',
    // Within 30 min
    'montreat': '28757',
    'mills river': '28759',
    'marshall': '28753',
    'canton': '28716',
    'clyde': '28721',
    'waynesville': '28786',
    'flat rock': '28731',
    'hendersonville': '28739',
    // Within 45 min
    'brevard': '28712',
    'lake junaluska': '28745',
    'lake lure': '28746',
    'saluda': '28773',
    'cedar mountain': '28718',
    'burnsville': '28714',
    'bakersville': '28705',
    'cherokee': '28719',
    'mars hill': '28754',
    'alexander': '28701',
    'old fort': '28762',
    'maggie valley': '28751',
  };

  return cityZips[cityLower];
}
