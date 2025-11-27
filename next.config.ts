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
};

export default nextConfig;
