import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Public assets (images, fonts, etc.)
     * - api/city-status (anonymous, polled every minute by every open tab, CDN-cached:
     *   a session refresh here would cost a Supabase call and a Set-Cookie that defeats the cache)
     * - Public docs, crawler files and the documented exports (developers, openapi.json,
     *   llms.txt, sitemap.xml, robots.txt, api/export/json, api/export/markdown): anonymous
     *   and CDN-cached for the same reason. Each is anchored with `$` so only that exact
     *   path is skipped, never a sibling or child route
     */
    '/((?!_next/static|_next/image|favicon.ico|api/city-status|developers/?$|openapi\\.json/?$|llms\\.txt/?$|sitemap\\.xml/?$|robots\\.txt/?$|api/export/(?:json|markdown)/?$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
