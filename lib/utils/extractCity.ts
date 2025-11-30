/**
 * City extraction utility for client-side location filtering.
 * Normalizes various location formats to a city name.
 */

// Known Asheville venues - these map directly to "Asheville"
// These are venues that don't include city info in their location string
const ASHEVILLE_VENUES = [
  // Major music venues
  'the orange peel',
  'the grey eagle',
  'pulp',  // Part of Orange Peel complex
  'harrah\'s cherokee center',

  // Breweries & bars
  'cultivated cocktails',
  'sovereign kava',
  'sweeten creek brewing',
  'ginger\'s revenge',
  'one world brewing',
  'westville pub',
  'the funkatorium',
  'wicked weed',
  'burial beer',
  'highland brewing',
  'green man brewery',
  'catawba brewing',
  'bhramari brewing',
  'wedge brewing',
  'archetype brewing',
  'zillicoah beer',
  'french broad brewery',

  // Other venues
  'the odd',
  'the hop ice cream',
  'biltmore village',
  'haywood park hotel',
  'montford area',
  'uphora dance',
  'grove arcade',
  'pack square',
  'pritchard park',
  'biltmore house',
  'biltmore estate',
  'us cellular center',
  'thomas wolfe auditorium',
  'diana wortham',
  'asheville community theatre',
  'magnetic theatre',

  // Parks & outdoor
  'carrier park',
  'french broad river park',
  'richmond hill park',
  'beaver lake',
];

// Known NC cities in the Asheville area (ordered by likely frequency)
export const KNOWN_CITIES = [
  'Asheville',
  'Black Mountain',
  'Weaverville',
  'Hendersonville',
  'Arden',
  'Candler',
  'Swannanoa',
  'Fletcher',
  'Mills River',
  'Brevard',
  'Waynesville',
  'Mars Hill',
  'Woodfin',
  'Leicester',
  'Fairview',
  'Burnsville',
  'Morganton',
  'Flat Rock',
  'Clyde',
  'Barnardsville',
  'Enka',
  'Boone',
  'Blowing Rock',
  'Banner Elk',
  'Maggie Valley',
  'Marshall',
  // Additional NC cities from analysis
  'Lake Lure',
  'Sylva',
  'Canton',
  'Bryson City',
  'Lake Junaluska',
  'Cedar Mountain',
  'Rutherfordton',
  'Lake Toxaway',
  'Franklin',
  'Newland',
  'Royal Pines',
  'Pisgah Forest',
  'Highlands',
  'Cashiers',
  'Spruce Pine',
  'Marion',
  'Old Fort',
  'Tryon',
  'Saluda',
  'Columbus',  // NC Columbus (there's also SC, but we'll assume NC in context)
  'Mill Spring',
  'Chimney Rock',
  'Bat Cave',
  'Montreat',
  'Ridgecrest',
];

// Known NON-NC cities that sometimes appear in results
// These should NOT be included in "Asheville area" filter
const NON_NC_CITIES = [
  // South Carolina
  'travelers rest',
  'taylors',
  'greer',
  'wellford',
  'boiling springs',  // SC version - be careful, there might be NC too
  'easley',
  'inman',
  'pickens',
  'campobello',
  'greenville',  // SC
  'spartanburg',

  // Tennessee
  'jonesborough',
  'telford',
  'cosby',
  'gatlinburg',
  'pigeon forge',
  'sevierville',
  'knoxville',
  'johnson city',

  // Georgia
  'atlanta',

  // Other
  'hudson falls',  // NY
];

/**
 * Extract city name from a location string.
 *
 * @param location - The location string (e.g., "Asheville, NC", "Black Mountain @ Venue", "The Orange Peel")
 * @returns The city name if recognized, "Online" for online events, or null for unknown locations
 *
 * @example
 * extractCity("Asheville, NC") // "Asheville"
 * extractCity("Black Mountain @ Pisgah Brewing") // "Black Mountain"
 * extractCity("The Orange Peel") // "Asheville" (known venue)
 * extractCity("Online") // "Online"
 * extractCity("Travelers Rest") // null (non-NC, excluded)
 * extractCity(null) // null
 */
export function extractCity(location: string | null | undefined): string | null {
  if (!location) return null;

  const lowerLocation = location.toLowerCase().trim();

  // Check for online events
  if (lowerLocation === 'online') return 'Online';

  // Check if it's a known Asheville venue first
  for (const venue of ASHEVILLE_VENUES) {
    if (lowerLocation.includes(venue)) {
      return 'Asheville';
    }
  }

  // Check if it's a known non-NC city (exclude these)
  for (const nonNCCity of NON_NC_CITIES) {
    if (lowerLocation.includes(nonNCCity)) {
      return null; // Exclude from city-based filtering
    }
  }

  // Check each known NC city (case insensitive)
  for (const city of KNOWN_CITIES) {
    const cityLower = city.toLowerCase();
    if (lowerLocation.includes(cityLower)) {
      return city;
    }
  }

  return null; // Unknown location
}

/**
 * Check if a location is a known Asheville venue.
 * Used to determine if unknown locations should be included in "Asheville area".
 */
export function isKnownAshevilleVenue(location: string | null | undefined): boolean {
  if (!location) return false;
  const lowerLocation = location.toLowerCase().trim();
  return ASHEVILLE_VENUES.some(venue => lowerLocation.includes(venue));
}

/**
 * Check if a location is likely from a non-NC area.
 * Used to exclude events that slipped through server-side filters.
 */
export function isNonNCLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  const lowerLocation = location.toLowerCase().trim();
  return NON_NC_CITIES.some(city => lowerLocation.includes(city));
}

/**
 * Check if a location should be included in the "Asheville area" filter.
 * Includes: Asheville city + known Asheville venues
 * Excludes: Other NC cities, non-NC cities, and truly unknown locations
 */
export function isAshevilleArea(location: string | null | undefined): boolean {
  const city = extractCity(location);

  // Explicitly Asheville
  if (city === 'Asheville') return true;

  // If no city extracted, check if it's a known venue
  if (city === null) {
    return isKnownAshevilleVenue(location);
  }

  return false;
}
