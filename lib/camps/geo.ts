/**
 * Where a camp site is and how long the drive is from downtown (docs/camps/04-v2-plan.md §1.5).
 *
 * - Geocoding: street addresses only. The US Census geocoder first (free, no key, public domain,
 *   so the points may be stored), then ORS / Pelias, and only when it finds the address, street or
 *   venue: Pelias lacks house numbers for many WNC addresses and returned a town centroid for the
 *   Arboretum, PACA, Rockmont and Hahn's in the pilot, and a centroid's drive time means nothing.
 *   A site with no street address is never looked up by its venue name (the pilot's venue matches
 *   were lookalikes); it and anything else unplaced wait for Matt's hand pin in /admin/camps.
 * - Drive time: one fixed origin (Pack Square) and a 1xN ORS driving matrix, on api.heigit.org (the
 *   old api.openrouteservice.org host is retired Nov 2-6, 2026). Never the model: Sol guessed
 *   Hendersonville at 50-60 minutes, about twice the real drive (plan 01 §2.5).
 * - ORS durations have no traffic; sites within 5 minutes of a cutoff are flagged for review
 *   rather than decided automatically. Against the public OSRM server on 17 sites (2026-10-28,
 *   scripts/camps/test-geo.ts) ORS ran a median 15% longer, mostly on short town trips (UNC
 *   Asheville 10 vs 7 min); past 30 minutes they agree (Hendersonville 35 vs 35, Camp Greenville
 *   74 vs 78).
 * - ORS results are CC-BY-SA: pages that show drive times credit ORS_ATTRIBUTION.
 */
import type { Site } from './contract';
import { fetchWithRetry } from '@/lib/utils/retry';

const ORS_URL = 'https://api.heigit.org';
const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** Pack Square, downtown Asheville (where ORS snaps the origin: 35.59507, -82.55102). */
export const PACK_SQUARE = { lat: 35.5951, lng: -82.5511 } as const;

/** D3: day camps within 55 minutes, overnight camps within 75. */
export const DRIVE_LIMIT_MINUTES = { day: 55, overnight: 75 } as const;
export const NEAR_CUTOFF_MINUTES = 5;

export const ORS_ATTRIBUTION = '© openrouteservice.org by HeiGIT | © OpenStreetMap contributors';

/** A match farther than this from Pack Square is another town's street of the same name. */
const MAX_KM_FROM_DOWNTOWN = 200;

/** One attempt plus one retry; the Census geocoder is usually well under a second. */
const RETRY = { maxRetries: 2, timeoutMs: 20000 } as const;

/**
 * Pelias layers precise enough to route from; never locality, county or other centroids. A street
 * match is the street's midpoint, which is close enough for an address on that street.
 */
const ADDRESS_LAYERS = ['address', 'street', 'venue'];

export type SiteQuery = Pick<Site, 'name' | 'address' | 'town' | 'state'>;

export interface SiteGeo {
  lat: number;
  lng: number;
  source: 'census' | 'ors';
  /** The geocoder's own name for the match, e.g. "375 LAKE EDEN RD, BLACK MOUNTAIN, NC, 28711". */
  label: string;
}

function apiKey(): string {
  const key = process.env.OPENROUTE_SERVICE_API_KEY;
  if (!key) throw new Error('OPENROUTE_SERVICE_API_KEY is not set');
  return key;
}

export function isGeoConfigured(): boolean {
  return !!process.env.OPENROUTE_SERVICE_API_KEY;
}

/** One line to geocode: the street address when there is one, else the venue name. */
export function geocodeText(site: SiteQuery): string {
  const place = site.address ? site.address : site.name;
  const parts = [place];
  if (site.town && !place.toLowerCase().includes(site.town.toLowerCase())) parts.push(site.town);
  if (site.state && !/\b[A-Z]{2}\b/.test(place)) parts.push(site.state);
  return parts.join(', ');
}

export function kmBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Census one-line address lookup. It needs a town or ZIP in the line ("27 Church St" alone
 * matches nothing). Its point is interpolated along the street's address range.
 */
export async function censusGeocode(oneLineAddress: string): Promise<SiteGeo | null> {
  const params = new URLSearchParams({
    address: oneLineAddress,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });
  const response = await fetchWithRetry(`${CENSUS_URL}?${params}`, undefined, RETRY);
  const json = (await response.json()) as {
    result?: {
      addressMatches?: Array<{ matchedAddress: string; coordinates: { x: number; y: number } }>;
    };
  };
  const matches = (json.result?.addressMatches ?? [])
    .map((match) => ({
      lat: match.coordinates.y,
      lng: match.coordinates.x,
      label: match.matchedAddress,
    }))
    .filter((point) => kmBetween(PACK_SQUARE, point) <= MAX_KM_FROM_DOWNTOWN);
  const [first] = matches;
  if (!first) return null;
  // Matches more than a kilometer apart (the same number on two streets of that name) are a guess.
  if (matches.some((point) => kmBetween(first, point) > 1)) return null;
  return { lat: first.lat, lng: first.lng, source: 'census', label: first.label };
}

/**
 * Pelias returns its best guess even for a vague venue name: "UNC Asheville campus residence hall"
 * came back as a Residence Inn in Spartanburg, SC (pilot, 2026-10-28). Accept a match only when its
 * town (the part of the label before the state) is named in the query.
 */
function plausibleMatch(query: string, label: string): boolean {
  const parts = label.split(',').map((part) => part.trim());
  const locality = parts.length >= 3 ? parts[parts.length - 3] : parts[0];
  const words = locality
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 4 && word !== 'county');
  const text = query.toLowerCase();
  return words.length === 0 || words.some((word) => text.includes(word));
}

/** Pelias search biased toward Asheville and bounded to MAX_KM_FROM_DOWNTOWN, in ADDRESS_LAYERS only. */
async function orsGeocode(text: string): Promise<SiteGeo | null> {
  const params = new URLSearchParams({
    text,
    size: '1',
    'boundary.country': 'US',
    'focus.point.lat': String(PACK_SQUARE.lat),
    'focus.point.lon': String(PACK_SQUARE.lng),
    'boundary.circle.lat': String(PACK_SQUARE.lat),
    'boundary.circle.lon': String(PACK_SQUARE.lng),
    'boundary.circle.radius': String(MAX_KM_FROM_DOWNTOWN),
  });
  const response = await fetchWithRetry(
    `${ORS_URL}/pelias/v1/search?${params}`,
    { headers: { Authorization: apiKey() } },
    RETRY
  );
  const json = (await response.json()) as {
    features?: Array<{
      geometry: { coordinates: [number, number] };
      properties: { label: string; layer: string };
    }>;
  };
  const feature = json.features?.[0];
  if (!feature || !ADDRESS_LAYERS.includes(feature.properties.layer)) return null;
  if (!plausibleMatch(text, feature.properties.label)) return null;
  return {
    lng: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    source: 'ors',
    label: feature.properties.label,
  };
}

/**
 * Census for a street address, then ORS; null when neither places it, and always null without a
 * street address (the site waits for a hand pin).
 */
export async function geocodeSite(site: SiteQuery): Promise<SiteGeo | null> {
  if (!site.address?.trim()) return null;
  const text = geocodeText(site);
  return (await censusGeocode(text)) ?? orsGeocode(text);
}

/** Unrounded driving minutes from Pack Square to each point (null when ORS can't route it). */
export async function driveMinutesFromDowntown(
  points: Array<{ lat: number; lng: number }>
): Promise<Array<number | null>> {
  const results: Array<number | null> = [];
  const BATCH = 49; // origin + 49 destinations stays inside the free plan's 50-location matrix
  for (let start = 0; start < points.length; start += BATCH) {
    const batch = points.slice(start, start + BATCH);
    const response = await fetchWithRetry(
      `${ORS_URL}/openrouteservice/v2/matrix/driving-car`,
      {
        method: 'POST',
        headers: { Authorization: apiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: [
            [PACK_SQUARE.lng, PACK_SQUARE.lat],
            ...batch.map((point) => [point.lng, point.lat]),
          ],
          sources: [0],
          destinations: batch.map((_, index) => index + 1),
          metrics: ['duration'],
        }),
      },
      { ...RETRY, timeoutMs: 30000 }
    );
    const json = (await response.json()) as { durations: Array<Array<number | null>> };
    for (const seconds of json.durations[0]) {
      results.push(seconds === null ? null : seconds / 60);
    }
  }
  return results;
}

export interface RadiusCheck {
  limit: number;
  inRadius: boolean;
  nearCutoff: boolean;
}

export function checkRadius(minutes: number, overnight: boolean): RadiusCheck {
  const limit = overnight ? DRIVE_LIMIT_MINUTES.overnight : DRIVE_LIMIT_MINUTES.day;
  return {
    limit,
    inRadius: minutes <= limit,
    nearCutoff: Math.abs(minutes - limit) <= NEAR_CUTOFF_MINUTES,
  };
}
