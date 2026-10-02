import type { Metadata } from 'next';

/**
 * Site identity shared by the root metadata, the homepage, the root JSON-LD,
 * the web app manifest and the developer docs, so they all describe AVL GO the
 * same way.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';

export const SITE_NAME = 'AVL GO';

export const SITE_DESCRIPTION =
  'Discover Asheville events, live music, festivals and free things to do. AVL GO brings local listings together and offers a free public events API.';

export const SITE_TITLE = 'AVL GO - The best Asheville Events Aggregator. Calendar & Things To Do';

/**
 * The root layout's Open Graph tags. No `url` on purpose: every page without its own
 * would inherit it and claim to be the homepage. The homepage adds it back.
 */
export const SITE_OPEN_GRAPH = {
  type: 'website',
  locale: 'en_US',
  siteName: SITE_NAME,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  images: [
    {
      url: '/avlgo-og.png',
      width: 1200,
      height: 630,
      alt: 'AVL GO - All Asheville events in one place',
    },
  ],
} satisfies Metadata['openGraph'];
