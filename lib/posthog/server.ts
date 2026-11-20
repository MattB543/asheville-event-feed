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

/** An error with only a name and a message: no stack that points at this file. */
function bareError(name: string, message: string, cause?: unknown): Error {
  const error = new Error(message, { cause });
  error.name = name;
  error.stack = `${name}: ${message}`;
  return error;
}

/** A failed Drizzle query. Told by shape: its class is bundled more than once. */
function failedQuery(error: Error): string | undefined {
  return 'params' in error && 'query' in error && typeof error.query === 'string'
    ? error.query
    : undefined;
}

/**
 * The error with every failed query in it stripped of the values it was run
 * with. Drizzle puts the bound parameters in the message ("Failed query: ...
 * params: ..."), and the database's own error underneath can quote them too
 * ("invalid input syntax for type uuid: ..."). Those can be a signed-in
 * visitor's id or what someone typed into a form, so PostHog gets the SQL with
 * its $1 placeholders, the database error's name and code, and where it was
 * thrown. A failed query can also sit under another error (`cause`, or an
 * AggregateError's `errors`), and PostHog reads those too. An error with no
 * failed query in it comes back as the same object.
 */
export function withoutQueryValues(error: unknown, seen = new Set<unknown>()): unknown {
  if (!(error instanceof Error)) return error;
  // An error that is its own cause, or listed twice: once is enough
  if (seen.has(error)) return undefined;
  seen.add(error);

  const query = failedQuery(error);
  if (query !== undefined) {
    const database = error.cause as { name?: unknown; code?: unknown } | undefined;
    const label = [database?.name, database?.code].filter((part) => typeof part === 'string');
    const message = `Failed query: ${query}`;
    const safe = bareError(
      error.name,
      message,
      label.length > 0 ? bareError('Error', label.join(' ')) : undefined
    );
    // The stack opens with the name and the whole message, and a typed value
    // can run over several lines, one of which could read like a frame. So the
    // frames are taken only from what follows that opening, or not at all.
    const opening = `${error.name}: ${error.message}\n`;
    if (error.stack?.startsWith(opening)) {
      const frames = error.stack
        .slice(opening.length)
        .split('\n')
        .filter((line) => /^\s+at /.test(line));
      safe.stack = [safe.stack, ...frames].join('\n');
    }
    return safe;
  }

  const cause = withoutQueryValues(error.cause, seen);
  const members = error instanceof AggregateError ? (error.errors as unknown[]) : [];
  const safeMembers = members.map((member) => withoutQueryValues(member, seen));
  if (cause === error.cause && safeMembers.every((member, i) => member === members[i])) {
    return error;
  }

  const copy =
    error instanceof AggregateError
      ? new AggregateError(safeMembers, error.message, { cause })
      : new Error(error.message, { cause });
  copy.name = error.name;
  copy.stack = error.stack;
  return copy;
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
