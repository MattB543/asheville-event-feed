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
 * A failed query's error without the values it was run with. Drizzle puts the
 * bound parameters in the message ("Failed query: ... params: ..."), and the
 * database's own error underneath can quote them too ("invalid input syntax
 * for type uuid: ..."). Those can be a signed-in visitor's id or what someone
 * typed into a form, so PostHog gets the SQL with its $1 placeholders, the
 * database error's name and code, and where it was thrown. Told apart by shape,
 * not `instanceof`: Drizzle's class can be bundled twice. Any other error is
 * sent as it is.
 */
export function withoutQueryValues(error: unknown): unknown {
  if (!(error instanceof Error) || !('query' in error) || !('params' in error)) return error;
  if (typeof error.query !== 'string') return error;

  const cause = error.cause as { name?: unknown; code?: unknown } | undefined;
  const causeLabel = [cause?.name, cause?.code].filter((part) => typeof part === 'string');
  const safe = new Error(`Failed query: ${error.query}`, {
    cause: causeLabel.length > 0 ? new Error(causeLabel.join(' ')) : undefined,
  });
  safe.name = error.name;
  // The stack's first lines repeat the message, values included
  const frames = (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  safe.stack = [`${safe.name}: ${safe.message}`, ...frames].join('\n');
  return safe;
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const posthog = getPostHogServer();
    if (!posthog) return;
    // The route pattern (/events/[slug]) and never the path that was asked for:
    // /api/camps/calendar/<token>.ics has a private token in it. No visitor id
    // either, so the report is tied to no person.
    posthog.captureException(withoutQueryValues(error), {
      properties: {
        method: request.method,
        route: context.routePath,
        route_type: context.routeType,
        render_source: context.renderSource,
        revalidate_reason: context.revalidateReason,
      },
    });
    // flush() has no time limit of its own, and Next holds a failed route
    // handler's response until this resolves
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
