/**
 * Shapes shared by /api/city-status and the header badges.
 *
 * Kept free of server-only imports: the client components import these types
 * and constants directly.
 */

/** One downtown parking garage, normalized from the city's feed. */
export interface ParkingDeck {
  slug: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  available: number;
}

export interface ParkingStatus {
  decks: ParkingDeck[];
  /** When the city last rewrote the feed (the S3 object's Last-Modified), ISO */
  asOf: string;
}

/** Boil-water advisories outrank outages everywhere they are compared. */
export type WaterNoticeKind = 'boil' | 'outage';

/** One active notice (the newest for its exact location) as the modal shows it. */
export interface WaterNotice {
  id: string;
  kind: WaterNoticeKind;
  /** Affected area as the message words it, else the location from the title */
  area: string | null;
  /** Short place for the badge, e.g. "Rumbough Pl", "Haw Creek" */
  place: string | null;
  /** ISO */
  postedAt: string;
  /** Scheduled interruptions: the stated shutdown window, or the whole day (ISO) */
  scheduled: { start: string; end: string; allDay: boolean } | null;
  message: string;
}

export interface WaterStatus {
  /** The most severe kind among `notices` */
  level: WaterNoticeKind;
  /** Boil-water first, then newest first */
  notices: WaterNotice[];
}

/**
 * `ok` with `active: null` is a genuine all-clear. `unavailable` (feed down,
 * stale, or unreadable) is not: the client keeps showing what it last knew.
 */
export type WaterState = { status: 'ok'; active: WaterStatus | null } | { status: 'unavailable' };

export interface CityStatus {
  /** null when the feed failed or is too old to call live: the badges hide */
  parking: ParkingStatus | null;
  water: WaterState;
}

/**
 * The city rewrites the parking feed about once a minute. Anything older than
 * this means their pipeline has stalled, and stale counts must never read as
 * live, so the badges hide.
 */
export const PARKING_STALE_AFTER_MS = 10 * 60 * 1000;

/** The city's own water-advisories page (it renders the same Everbridge feed). */
export const CITY_WATER_ADVISORIES_URL =
  'https://www.ashevillenc.gov/service/water-quality-advisories/';

/** The city's live garage-availability map, the parking feed's own front end. */
export const CITY_PARKING_URL = 'https://wheresparking.ashevillenc.gov/';
