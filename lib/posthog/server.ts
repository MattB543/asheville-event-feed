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
 * Send a server error (a failed page render, route handler or server action)
 * to PostHog error tracking. Never throws: reporting an error must not turn
 * into a second one.
 */
export const reportServerError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const posthog = getPostHogServer();
  if (!posthog) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The route pattern (/events/[slug]) and never the path that was asked for:
    // /api/camps/calendar/<token>.ics has a private token in it. No visitor id
    // either, so the report is tied to no person.
    posthog.captureException(error, {
      properties: {
        method: request.method,
        route: context.routePath,
        route_type: context.routeType,
        render_source: context.renderSource,
        revalidate_reason: context.revalidateReason,
      },
    });
    // Vercel can pause the function once this returns, so try to send first.
    // flush() has no time limit of its own, and Next holds a failed route's
    // response until this resolves.
    await Promise.race([
      posthog.flush(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, FLUSH_LIMIT_MS);
      }),
    ]);
  } catch (reportingError) {
    console.error('[PostHog] Could not report a server error:', reportingError);
  } finally {
    clearTimeout(timer);
  }
};
