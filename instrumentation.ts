import type { Instrumentation } from 'next';

// Next calls this for every server error it would log. Vercel keeps those logs
// for a week at most and groups nothing; PostHog error tracking keeps them, grouped.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // posthog-node needs Node; nothing here runs on the edge runtime today
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportServerError } = await import('./lib/posthog/server');
  await reportServerError(error, request, context);
};
