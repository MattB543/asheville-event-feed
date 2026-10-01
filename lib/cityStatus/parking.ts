/**
 * Live downtown garage availability from the City of Asheville's parking feed
 * (the JSON behind wheresparking.ashevillenc.gov). Open, keyless, rewritten
 * about once a minute, and served without CORS headers, so it is fetched
 * server-side by /api/city-status.
 */

import { unstable_cache } from 'next/cache';
import { PARKING_STALE_AFTER_MS, type ParkingDeck, type ParkingStatus } from './types';

export const PARKING_FEED_URL = 'https://s3.amazonaws.com/avl-parking-decks/all-spaces.json';

function toNumber(value: unknown): number | null {
  // City decks report `available` as a string, county decks as a number
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

/** Normalize the feed's JSON; decks without a usable count are dropped. */
export function parseParkingDecks(json: unknown): ParkingDeck[] {
  const decks = (json as { decks?: unknown } | null)?.decks;
  if (!Array.isArray(decks)) return [];

  const parsed: ParkingDeck[] = [];
  for (const item of decks as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const name = typeof d.name === 'string' ? d.name.trim() : '';
    const available = toNumber(d.available);
    if (!name || available === null) continue;

    const slug =
      typeof d.slug === 'string' && d.slug
        ? d.slug
        : name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const coords = Array.isArray(d.coords) ? d.coords.map(Number) : [];
    const hasCoords = coords.length === 2 && coords.every((c) => Number.isFinite(c));

    parsed.push({
      slug,
      name,
      address: typeof d.address === 'string' && d.address.trim() ? d.address.trim() : null,
      lat: hasCoords ? coords[0] : null,
      lng: hasCoords ? coords[1] : null,
      available,
    });
  }
  return parsed;
}

/** One uncached, time-boxed read of the feed. Throws on anything unusable. */
async function requestParking(): Promise<ParkingStatus> {
  const res = await fetch(PARKING_FEED_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`parking feed HTTP ${res.status}`);

  // S3 serves it as application/octet-stream, so parse the text ourselves
  const decks = parseParkingDecks(JSON.parse(await res.text()));
  const lastModified = Date.parse(res.headers.get('last-modified') ?? '');
  // No Last-Modified means no way to tell live from stale
  if (decks.length === 0 || !Number.isFinite(lastModified)) {
    throw new Error('parking feed has no decks or no Last-Modified');
  }
  return { decks, asOf: new Date(lastModified).toISOString() };
}

/** Cached for 60s; throwing keeps a bad response out of the cache. */
const getCachedParking = unstable_cache(requestParking, ['city-status-parking-v1'], {
  revalidate: 60,
});

export function isParkingStale(status: ParkingStatus, now: number): boolean {
  return now - Date.parse(status.asOf) > PARKING_STALE_AFTER_MS;
}

/**
 * Current garage counts, or null if the feed failed or its Last-Modified is older
 * than PARKING_STALE_AFTER_MS. A cached copy that has gone stale (failing
 * refreshes, or a quiet hour) gets one direct read before giving up.
 */
export async function fetchParkingStatus(now: number): Promise<ParkingStatus | null> {
  try {
    let status = await getCachedParking();
    if (isParkingStale(status, now)) status = await requestParking();
    return isParkingStale(status, now) ? null : status;
  } catch (error) {
    console.warn('[city-status] parking feed failed:', error);
    return null;
  }
}
