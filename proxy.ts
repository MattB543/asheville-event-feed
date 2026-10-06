import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

/*
 * The proxy only refreshes an existing Supabase session, so it runs only when the request
 * carries a session cookie: `sb-<project ref>-auth-token`, or `.0`, `.1`, ... when Supabase
 * splits the session into chunks. That skips anonymous visitors and crawlers, which were most
 * of its ~375k daily invocations. The cookie is matched on the raw Cookie header because Next
 * compares cookie keys literally and the ref differs per Supabase project.
 *
 * Signing in doesn't depend on it. Starting Google OAuth sets only the PKCE code-verifier
 * cookie (`sb-<ref>-auth-token-code-verifier`, which the pattern skips); /auth/callback and
 * /auth/confirm then exchange the code and set the session cookie themselves.
 *
 * Prefetches skip it too. They render only down to the root loading.tsx, which never reads
 * the session, and the next real request refreshes it.
 *
 * Paths it never runs on, signed in or not:
 * - _next/static, _next/image, favicon.ico and public assets (images, fonts, etc.)
 * - avl-data/ (the PostHog proxy rewrite)
 * - api/city-status (anonymous, polled every minute by every open tab, CDN-cached:
 *   a session refresh here would cost a Supabase call and a Set-Cookie that defeats the cache)
 * - Public docs, crawler files and the documented exports (developers, openapi.json,
 *   llms.txt, sitemap.xml, robots.txt, api/export/json, api/export/markdown): anonymous
 *   and CDN-cached for the same reason. Each is anchored with `$` so only that exact
 *   path is skipped, never a sibling or child route
 */
export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|avl-data/|api/city-status|developers/?$|openapi\\.json/?$|llms\\.txt/?$|sitemap\\.xml/?$|robots\\.txt/?$|api/export/(?:json|markdown)/?$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|txt|webmanifest)$).*)',
      has: [
        {
          type: 'header',
          key: 'cookie',
          value: '(?:.*;\\s*)?sb-[^=;]+-auth-token(?:\\.0)?=[^;]+(?:;.*)?',
        },
      ],
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
