/**
 * Reference points for the camps chat's `near` filter (docs/camps/06-ai-chat-plan.md §4.4): a few
 * fixed Asheville neighborhoods plus every town centroid in data/camps/town-points.json. No user
 * address, geocoding request or guessed drive time: distances from these are straight-line miles.
 *
 * Pure and client-safe (the filter parser imports it).
 */
import townPointsFile from '@/data/camps/town-points.json';

interface Point {
  lat: number;
  lng: number;
}

/** Fixed neighborhood points; Downtown Asheville is Pack Square (lib/camps/geo.ts). */
const NEIGHBORHOODS = [
  { name: 'Downtown Asheville', lat: 35.5951, lng: -82.5511 },
  { name: 'West Asheville', lat: 35.581, lng: -82.6012 },
  { name: 'North Asheville', lat: 35.6328, lng: -82.5552 },
  { name: 'East Asheville', lat: 35.5874, lng: -82.5029 },
  { name: 'South Asheville', lat: 35.4876, lng: -82.5378 },
  { name: 'Biltmore Village', lat: 35.5669, lng: -82.5411 },
  { name: 'Biltmore Park', lat: 35.4856, lng: -82.5542 },
  { name: 'Oakley', lat: 35.5645, lng: -82.5132 },
  { name: 'Montford', lat: 35.6054, lng: -82.5667 },
  { name: 'Haw Creek', lat: 35.5946, lng: -82.5075 },
  { name: 'Enka', lat: 35.5392, lng: -82.6512 },
];

/** town-points.json, keyed "Brevard, NC"; a town ORS couldn't place is null. */
const TOWN_POINTS = Object.entries(
  townPointsFile as unknown as Record<string, (Point & { minutes: number | null }) | null>
).flatMap(([key, point]) => (point ? [{ key, lat: point.lat, lng: point.lng }] : []));

/** "Brevard" for a North Carolina town, "Greenville, SC" elsewhere. */
function placeName(key: string): string {
  return key.replace(/, NC$/, '');
}

/** Asheville itself is the downtown point, not the city's centroid. */
const ALIASES: Record<string, string> = {
  asheville: 'Downtown Asheville',
  downtown: 'Downtown Asheville',
  'pack square': 'Downtown Asheville',
};

export const PLACES: ReadonlyArray<{ name: string; lat: number; lng: number }> = [
  ...NEIGHBORHOODS,
  ...TOWN_POINTS.filter(({ key }) => key !== 'Asheville, NC').map(({ key, lat, lng }) => ({
    name: placeName(key),
    lat,
    lng,
  })),
];

/** Lower case, single spaces, no trailing ", NC" (other states keep theirs). */
export function placeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .replace(/, nc$/, '');
}

const BY_KEY = new Map(PLACES.map((place) => [placeKey(place.name), place]));

/** A known place by name (case and spacing ignored), or null. */
export function findPlace(name: string): (typeof PLACES)[number] | null {
  const key = placeKey(name);
  return BY_KEY.get(ALIASES[key] ? placeKey(ALIASES[key]) : key) ?? null;
}

/**
 * A town's centroid from town-points.json, for a site with no point of its own (an estimate).
 * Unlike findPlace, Asheville here is the city's centroid: it stands in for an unplaced site.
 */
const TOWN_BY_KEY = new Map(TOWN_POINTS.map((town) => [town.key.toLowerCase(), town]));

export function townPoint(town: string | null, state: string | null): Point | null {
  if (!town?.trim() || !state?.trim()) return null;
  const key = `${town.trim().replace(/\s+/g, ' ')}, ${state.trim().toUpperCase()}`.toLowerCase();
  const point = TOWN_BY_KEY.get(key);
  return point ? { lat: point.lat, lng: point.lng } : null;
}

/** Straight-line miles between two points (haversine). */
export function milesBetween(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
