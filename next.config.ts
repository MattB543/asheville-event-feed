import type { NextConfig } from 'next';
import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots';

const nextConfig: NextConfig = {
  // Googlebot gets a page's title, description and canonical inside <head>, like the crawlers
  // on Next's own list. Without this, pages with generateMetadata (events, camps, groups) stream
  // those tags into <body> for it, where they count only once Google has run the page's scripts.
  // Setting the option replaces Next's list, so this starts from it.
  htmlLimitedBots: new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|Googlebot`, 'i'),
  async rewrites() {
    return [
      {
        source: '/avl-data/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/avl-data/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  images: {
    // The 4h default re-transformed popular images every 4h on each crawler pass (88% of
    // transformations in an Oct 2026 sample). A week removes nearly all of that while bounding
    // how long a changed source image, or a poster taken down, can still be served from the
    // optimizer cache. Sooner: `vercel cache dangerously-delete --srcimg <url>`
    minimumCacheTTL: 60 * 60 * 24 * 7,
    remotePatterns: [
      {
        // Allow any HTTPS image
        protocol: 'https',
        hostname: '**',
      },
      {
        // Allow any HTTP image (some sources like Squarespace use http)
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  // Exclude patchright/playwright from bundling - they use native modules
  // and must be loaded dynamically at runtime
  serverExternalPackages: [
    'patchright',
    'patchright-core',
    'playwright',
    'playwright-core',
    'playwright-extra',
    'puppeteer-extra-plugin-stealth',
  ],
};

export default nextConfig;
