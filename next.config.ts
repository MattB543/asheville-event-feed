import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Allow any HTTPS image
        protocol: 'https',
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
