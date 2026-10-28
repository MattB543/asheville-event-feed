/**
 * Geocoding and drive time from downtown, via HeiGIT / OpenRouteService (plan §6.2, N12).
 *
 * - The old api.openrouteservice.org host is retired Nov 2-6, 2026, so this uses api.heigit.org.
 * - One fixed origin (Pack Square) and a 1xN driving matrix. Never the model: Sol guessed
 *   Hendersonville at 50-60 minutes, about twice the real drive (plan §2.5).
 * - ORS durations have no traffic, so they run short; sites within 5 minutes of a cutoff are
 *   flagged for review rather than decided automatically.
 * - Results are CC-BY-SA: pages that show drive times credit ORS_ATTRIBUTION.
 */

const BASE_URL = 'https://api.heigit.org';

/** Pack Square, downtown Asheville (where ORS snaps the origin: 35.59507, -82.55102). */
export const PACK_SQUARE = { lat: 35.5951, lng: -82.5511 } as const;

/** D3: day camps within 55 minutes, overnight camps within 75. */
export const DRIVE_LIMIT_MINUTES = { day: 55, overnight: 75 } as const;
export const NEAR_CUTOFF_MINUTES = 5;

export const ORS_ATTRIBUTION = '© openrouteservice.org by HeiGIT | © OpenStreetMap contributors';

export interface GeocodeQuery {
  name: string;
  address: string | null;
  town: string | null;
  state: string | null;
}

export interface Geocode {
  query: string;
  lat: number;
  lng: number;
  label: string;
  confidence: number;
  layer: string;
  /** True when the match is only a town/region centroid or low confidence: needs a look. */
  approximate: boolean;
}

function apiKey(): string {
  const key = process.env.OPENROUTE_SERVICE_API_KEY;
  if (!key) throw new Error('OPENROUTE_SERVICE_API_KEY is not set');
  return key;
}

export function isGeoConfigured(): boolean {
  return !!process.env.OPENROUTE_SERVICE_API_KEY;
}

export function geocodeText(query: GeocodeQuery): string {
  // A street address is the drop-off; fall back to the venue name when there isn't one.
  const place = query.address ? query.address : query.name;
  const parts = [place];
  if (query.town && !place.toLowerCase().includes(query.town.toLowerCase())) parts.push(query.town);
  if (query.state && !/\b[A-Z]{2}\b/.test(place)) parts.push(query.state);
  return parts.join(', ');
}

/** Pelias search biased toward Asheville and bounded to ~200 km (rules out Asheville-named places elsewhere). */
export async function geocode(query: GeocodeQuery): Promise<Geocode | null> {
  const text = geocodeText(query);
  const params = new URLSearchParams({
    text,
    size: '1',
    'boundary.country': 'US',
    'focus.point.lat': String(PACK_SQUARE.lat),
    'focus.point.lon': String(PACK_SQUARE.lng),
    'boundary.circle.lat': String(PACK_SQUARE.lat),
    'boundary.circle.lon': String(PACK_SQUARE.lng),
    'boundary.circle.radius': '200',
  });
  const response = await fetch(`${BASE_URL}/pelias/v1/search?${params}`, {
    headers: { Authorization: apiKey() },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Geocode HTTP ${response.status} for "${text}"`);
  const json = (await response.json()) as {
    features?: Array<{
      geometry: { coordinates: [number, number] };
      properties: { label: string; confidence?: number; layer: string };
    }>;
  };
  const feature = json.features?.[0];
  if (!feature) return null;

  const confidence = feature.properties.confidence ?? 0;
  const layer = feature.properties.layer;
  return {
    query: text,
    lng: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    label: feature.properties.label,
    confidence,
    layer,
    approximate:
      confidence < 0.8 ||
      [
        'locality',
        'localadmin',
        'county',
        'region',
        'postalcode',
        'neighbourhood',
        'borough',
      ].includes(layer),
  };
}

/**
 * Pelias returns its best guess even for a vague venue name: "UNC Asheville campus residence hall"
 * came back as a Residence Inn in Spartanburg, SC (pilot, 2026-10-28). Accept a match only when its
 * town (the part of the label before the state) is named in the query.
 */
export function plausibleMatch(query: string, hit: Geocode): boolean {
  const parts = hit.label.split(',').map((part) => part.trim());
  const locality = parts.length >= 3 ? parts[parts.length - 3] : parts[0];
  const words = locality
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 4 && word !== 'county');
  const text = query.toLowerCase();
  return words.length === 0 || words.some((word) => text.includes(word));
}

/** Unrounded driving minutes from Pack Square to each point (null when ORS can't route it). */
export async function driveMinutesFromDowntown(
  points: Array<{ lat: number; lng: number }>
): Promise<Array<number | null>> {
  const results: Array<number | null> = [];
  const BATCH = 49; // origin + 49 destinations stays inside the free plan's 50-location matrix
  for (let start = 0; start < points.length; start += BATCH) {
    const batch = points.slice(start, start + BATCH);
    const response = await fetch(`${BASE_URL}/openrouteservice/v2/matrix/driving-car`, {
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
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw new Error(`Matrix HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
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
