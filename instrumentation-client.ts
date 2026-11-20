import posthog from 'posthog-js';

// Local setups have no key; skip analytics rather than log an error on every page
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: '/avl-data',
    ui_host: 'https://us.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    // Uncaught browser errors and unhandled promise rejections, for PostHog
    // error tracking. Set here so it doesn't depend on the project's toggle.
    capture_exceptions: true,
  });
}
