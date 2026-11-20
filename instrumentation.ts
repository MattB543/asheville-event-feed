import type { Instrumentation } from 'next';

/**
 * Asks Vercel to keep this function running until `work` settles, and does
 * nothing anywhere else. It is what `waitUntil` from `@vercel/functions` does;
 * that package would add 17 others for these two lines.
 */
function keepAliveFor(work: Promise<unknown>): void {
  const requestContext = (
    globalThis as {
      [key: symbol]:
        | { get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined }
        | undefined;
    }
  )[Symbol.for('@vercel/request-context')];
  requestContext?.get?.()?.waitUntil?.(work);
}

// Next calls this for a server error it would log. Vercel keeps those logs for
// a week at most and groups nothing; PostHog error tracking keeps them, grouped.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  // posthog-node needs Node; nothing here runs on the edge runtime today
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const reported = import('./lib/posthog/server')
    .then(({ reportServerError }) => reportServerError(error, request, context))
    .catch((reportingError: unknown) => {
      console.error('[PostHog] Could not report a server error:', reportingError);
    });
  // Next waits for this hook before it sends a failed route handler's response,
  // but not when a page fails while rendering, and Vercel can pause the
  // function as soon as the response is out.
  keepAliveFor(reported);
  return reported;
};
