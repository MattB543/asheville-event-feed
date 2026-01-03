import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import { JsonLd } from '@/components/JsonLd';

const inter = Inter({ subsets: ['latin'] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://avlgo.com';
const siteName = 'AVL GO';
const siteTitle = 'AVL GO - The best Asheville Events Aggregator. Calendar & Things To Do';
const siteDescription =
  'Discover events in Asheville, NC. AVLGO aggregates concerts, food & drink events, outdoor activities, & more from AVL Today, Eventbrite, Meetup, & others';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  // Basic metadata
  title: {
    default: siteTitle,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  keywords: [
    'Asheville events',
    'Asheville NC events',
    'things to do in Asheville',
    'Asheville concerts',
    'Asheville festivals',
    'Asheville calendar',
    'AVL events',
    'Asheville nightlife',
    'Asheville live music',
    'Asheville food events',
    'Asheville outdoor activities',
    'Western NC events',
    'Blue Ridge events',
    'Asheville weekend events',
    'Asheville today',
  ],
  authors: [{ name: 'Matt Brooks', url: 'https://mattbrooks.xyz' }],
  creator: 'Brooks Solutions, LLC',
  publisher: 'Brooks Solutions, LLC',

  // Favicon and icons
  icons: {
    icon: [
      { url: '/avlgo_favicon.svg', type: 'image/svg+xml' },
      { url: '/avlgo_favicon.ico', sizes: '32x32' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },

  // Open Graph (Facebook, LinkedIn, etc.)
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: siteName,
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: '/avlgo-og.png',
        width: 1200,
        height: 630,
        alt: 'AVL GO - All Asheville events in one place',
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: ['/avlgo-og.png'],
    creator: '@mattbrooksxyz',
  },

  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // Verification (add your IDs when you have them)
  // verification: {
  //   google: "your-google-verification-code",
  //   yandex: "your-yandex-verification-code",
  // },

  // Alternate languages (if you ever add i18n)
  alternates: {
    canonical: siteUrl,
  },

  // App-specific
  applicationName: siteName,
  category: 'events',

  // Additional metadata
  other: {
    'geo.region': 'US-NC',
    'geo.placename': 'Asheville',
    'geo.position': '35.5951;-82.5515',
    ICBM: '35.5951, -82.5515',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0871aa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

// Inline script to prevent flash of wrong theme (runs before body renders)
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('theme');
      if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <JsonLd />
      </head>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
