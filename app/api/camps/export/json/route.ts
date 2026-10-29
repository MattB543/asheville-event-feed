import { NextResponse } from 'next/server';
import { queryCamps } from '@/lib/db/queries/camps';
import { CAMP_EXPORT_SUCCESS_HEADERS, campExportDisposition, campsJson } from '@/lib/camps/export';
import { PUBLIC_EXPORT_ERROR_HEADERS, publicApiPreflight } from '@/lib/api/publicEventsContract';

export const dynamic = 'force-dynamic';

/**
 * GET /api/camps/export/json - every listed summer camp as one JSON file, for a parent's own AI
 * (lib/camps/export.ts). Uncached reader: the CDN holds the response for an hour.
 */
export async function GET() {
  try {
    const now = new Date();
    const body = campsJson(await queryCamps(), now);
    return NextResponse.json(body, {
      headers: {
        ...CAMP_EXPORT_SUCCESS_HEADERS,
        'Content-Disposition': campExportDisposition('json', now),
      },
    });
  } catch (error) {
    console.error('[Camps JSON Export] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate the camps export' },
      { status: 500, headers: PUBLIC_EXPORT_ERROR_HEADERS }
    );
  }
}

export function OPTIONS() {
  return publicApiPreflight();
}
