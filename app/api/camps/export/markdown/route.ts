import { NextResponse } from 'next/server';
import { queryCamps } from '@/lib/db/queries/camps';
import {
  CAMP_EXPORT_SUCCESS_HEADERS,
  campExportDisposition,
  campsMarkdown,
} from '@/lib/camps/export';
import { PUBLIC_EXPORT_ERROR_HEADERS, publicApiPreflight } from '@/lib/api/publicEventsContract';

export const dynamic = 'force-dynamic';

/**
 * GET /api/camps/export/markdown - every listed summer camp as one Markdown file, for a parent's
 * own AI (lib/camps/export.ts). Uncached reader: the CDN holds the response for an hour.
 */
export async function GET() {
  try {
    const now = new Date();
    const markdown = campsMarkdown(await queryCamps(), now);
    return new NextResponse(markdown, {
      headers: {
        ...CAMP_EXPORT_SUCCESS_HEADERS,
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': campExportDisposition('md', now),
      },
    });
  } catch (error) {
    console.error('[Camps Markdown Export] Error:', error);
    return new NextResponse('# Error\n\nFailed to generate the camps export.', {
      status: 500,
      headers: { ...PUBLIC_EXPORT_ERROR_HEADERS, 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }
}

export function OPTIONS() {
  return publicApiPreflight();
}
