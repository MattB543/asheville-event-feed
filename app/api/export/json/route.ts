import { NextResponse } from 'next/server';
import { getCompactExport, parseExportFilters, queryFullExport } from '@/lib/api/publicEvents';
import {
  COMPACT_DEFAULT_LIMIT,
  PUBLIC_EXPORT_ERROR_HEADERS,
  PUBLIC_EXPORT_SUCCESS_HEADERS,
  decodeCursor,
  parseCompactLimit,
  parseExportFormat,
  publicApiPreflight,
  type ExportCursor,
} from '@/lib/api/publicEventsContract';

export const dynamic = 'force-dynamic';

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: PUBLIC_EXPORT_ERROR_HEADERS });
}

/**
 * GET /api/export/json - the public events API (documented at /developers and /openapi.json).
 *
 * Default (`format=full`): every matching upcoming event with all public fields,
 * unpaginated. `format=compact`: a small page of id/title/startDate/location/price/
 * aiSummary/AVL GO url, paginated with `limit` + `cursor`. `limit` and `cursor` are
 * ignored in full mode.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const format = parseExportFormat(searchParams.get('format'));
  if (!format) return errorResponse('Invalid format', 400);

  let limit = COMPACT_DEFAULT_LIMIT;
  let cursor: ExportCursor | null = null;
  if (format === 'compact') {
    const parsedLimit = parseCompactLimit(searchParams.get('limit'));
    if (parsedLimit === null) return errorResponse('Invalid limit', 400);
    limit = parsedLimit;

    const cursorParam = searchParams.get('cursor');
    if (cursorParam !== null) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return errorResponse('Invalid cursor', 400);
    }
  }

  try {
    const filters = parseExportFilters(searchParams);
    const body =
      format === 'compact'
        ? await getCompactExport(filters, limit, cursor)
        : await queryFullExport(filters);

    return NextResponse.json(body, { headers: PUBLIC_EXPORT_SUCCESS_HEADERS });
  } catch (error) {
    console.error('[JSON Export] Error:', error);
    return errorResponse('Failed to generate JSON feed', 500);
  }
}

export function OPTIONS() {
  return publicApiPreflight();
}
