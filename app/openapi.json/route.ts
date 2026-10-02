import { NextResponse } from 'next/server';
import { openApiDocument } from '@/lib/api/openapi';
import { PUBLIC_API_CORS_HEADERS, publicApiPreflight } from '@/lib/api/publicEventsContract';

/**
 * GET /openapi.json - OpenAPI 3.1 description of the public events API.
 * A static object (no database access); it only changes with a deploy.
 */
export function GET() {
  return NextResponse.json(openApiDocument, {
    headers: {
      ...PUBLIC_API_CORS_HEADERS,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

export function OPTIONS() {
  return publicApiPreflight();
}
