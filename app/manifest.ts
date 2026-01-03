import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AVL GO - Asheville Events Calendar',
    short_name: 'AVL GO',
    description:
      'Discover events in Asheville, NC. Concerts, festivals, food & drink events, outdoor activities, and more.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0871aa',
    orientation: 'portrait-primary',
    scope: '/',
    lang: 'en',
    categories: ['events', 'entertainment', 'lifestyle', 'social'],
    icons: [
      {
        src: '/favicon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/favicon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/favicon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/favicon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/avlgo_favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
