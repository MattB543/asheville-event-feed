/**
 * The DB-free half of the public events API: response headers, compact pagination
 * limits, request-parameter validation and the cursor format. Kept apart from
 * lib/api/publicEvents.ts (queries) so /openapi.json and the docs can import it
 * without pulling in Drizzle.
 */

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Anonymous, read-only CORS: any origin, no credentials. */
export const PUBLIC_API_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

/** Browsers keep an export a minute, the CDN five (the same interval as the compact data cache). */
export const PUBLIC_EXPORT_SUCCESS_HEADERS = {
  ...PUBLIC_API_CORS_HEADERS,
  'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
};

export const PUBLIC_EXPORT_ERROR_HEADERS = {
  ...PUBLIC_API_CORS_HEADERS,
  'Cache-Control': 'no-store',
};

/** OPTIONS handler body for the public routes (CORS preflight). */
export function publicApiPreflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type ExportFormat = 'full' | 'compact';

export const COMPACT_DEFAULT_LIMIT = 20;
export const COMPACT_MAX_LIMIT = 100;
/** A compact request scans at most COMPACT_BATCH_SIZE * COMPACT_MAX_BATCHES rows. */
export const COMPACT_BATCH_SIZE = 150;
export const COMPACT_MAX_BATCHES = 10;

/** `format`: omitted means full; anything other than full/compact is invalid (null). */
export function parseExportFormat(value: string | null): ExportFormat | null {
  if (value === null) return 'full';
  return value === 'full' || value === 'compact' ? value : null;
}

/** Compact `limit`: omitted means the default; otherwise a whole number 1-100, else null. */
export function parseCompactLimit(value: string | null): number | null {
  if (value === null) return COMPACT_DEFAULT_LIMIT;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= COMPACT_MAX_LIMIT ? limit : null;
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export interface ExportCursor {
  /**
   * The row's exact start_date as UTC ISO text with microseconds
   * ("2026-10-03T04:00:00.123456Z"). Postgres keeps microseconds and a JS Date
   * doesn't, so the keyset compares this text, cast back to timestamptz.
   */
  startDate: string;
  id: string;
}

const CURSOR_BODY =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(\d{3}|\d{6})Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Opaque to callers: base64url of "<UTC ISO start, microseconds>_<event uuid>". */
export function encodeCursor(cursor: ExportCursor): string {
  return Buffer.from(`${cursor.startDate}_${cursor.id}`).toString('base64url');
}

/** The cursor a previous page returned, or null when the value is malformed. */
export function decodeCursor(value: string): ExportCursor | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
  const match = CURSOR_BODY.exec(Buffer.from(value, 'base64url').toString('utf8'));
  if (!match) return null;

  // Round-tripping the millisecond part rejects impossible dates (month 13, etc.)
  const millis = `${match[1].slice(0, 23)}Z`;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== millis) return null;

  // The first cursors carried milliseconds only; they still resume correctly
  const startDate = match[2].length === 3 ? match[1].replace(/Z$/, '000Z') : match[1];
  return { startDate, id: match[3] };
}
