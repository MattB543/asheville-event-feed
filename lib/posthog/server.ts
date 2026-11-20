import { PostHog } from 'posthog-node';
import type { Instrumentation } from 'next';

/** How long a failed request waits for PostHog to take its error report. */
const FLUSH_LIMIT_MS = 3000;

let client: PostHog | null = null;

/** The server-side PostHog client, or null where there is no key (local setups). */
function getPostHogServer(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  // No batching: errors are rare, and each is flushed as it is reported
  client ??= new PostHog(key, { host: 'https://us.i.posthog.com', flushAt: 1, flushInterval: 0 });
  return client;
}

/**
 * The visitor's PostHog id, read from the cookie posthog-js keeps, so a server
 * error shows up beside what the same visitor did in the browser.
 */
function distinctIdFromCookie(cookie: string | string[] | undefined): string | undefined {
  const header = Array.isArray(cookie) ? cookie.join('; ') : cookie;
  const match = header?.match(/ph_phc_[^=;]*_posthog=([^;]+)/);
  if (!match) return undefined;
  try {
    const id: unknown = (JSON.parse(decodeURIComponent(match[1])) as { distinct_id?: unknown })
      .distinct_id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Send a server error (a failed page render, route handler, server action or
 * proxy run) to PostHog error tracking. Never throws: reporting an error must
 * not turn into a second one.
 */
export const reportServerError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  try {
    const posthog = getPostHogServer();
    if (!posthog) return;
    posthog.captureException(error, {
      distinctId: distinctIdFromCookie(request.headers.cookie),
      properties: {
        // No query string: some routes carry a private token there
        path: request.path.split('?')[0],
        method: request.method,
        route: context.routePath,
        route_type: context.routeType,
        render_source: context.renderSource,
        // 'stale' is a background refresh of a cached page: no visitor saw it fail
        revalidate_reason: context.revalidateReason,
      },
    });
    // Vercel can pause the function once this returns, so the event has to be
    // sent first. flush() has no time limit of its own.
    await Promise.race([
      posthog.flush(),
      new Promise((resolve) => setTimeout(resolve, FLUSH_LIMIT_MS)),
    ]);
  } catch (reportingError) {
    console.error('[PostHog] Could not report a server error:', reportingError);
  }
};
