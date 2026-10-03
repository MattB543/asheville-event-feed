import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { generateEventSlug } from '@/lib/utils/slugify';
import EventPageClient from './EventPageClient';
import { getEventBySlug, getSimilarEvents, serializeEvent } from '@/lib/events/getEvent';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { isUserVerifiedCurator } from '@/lib/supabase/curatorProfile';
import { buildEventJsonLd, buildEventMetaDescription, isLiveEvent } from '@/lib/seo/eventJsonLd';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';

// ISR: Revalidate every hour
export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Titles are bare: the root layout's template appends " | AVL GO"
const notFoundMetadata: Metadata = {
  title: 'Event Not Found',
  description: "The event you're looking for could not be found.",
  robots: { index: false },
};

/**
 * Generate dynamic metadata for SEO
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  if (!event) {
    return notFoundMetadata;
  }

  const eventUrl = `${siteUrl}/events/${generateEventSlug(event.title, event.startDate, event.id)}`;
  const description = buildEventMetaDescription(event);

  // Use event image or fall back to site OG image
  const ogImage = event.imageUrl?.startsWith('data:')
    ? `${siteUrl}/avlgo-og.png` // Don't use base64 for OG images
    : event.imageUrl || `${siteUrl}/avlgo-og.png`;

  return {
    title: event.title,
    description,
    keywords: event.tags || [],

    alternates: {
      canonical: eventUrl,
    },

    openGraph: {
      type: 'website',
      url: eventUrl,
      title: event.title,
      description,
      siteName: 'AVL GO',
      locale: 'en_US',
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: event.title,
        },
      ],
    },

    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description,
      images: [ogImage],
      creator: '@mattbrooksxyz',
    },

    // Deduped/dead rows still render so shared links work, but stay out of search.
    // Live rows inherit the root robots settings.
    ...(isLiveEvent(event) ? {} : { robots: { index: false, follow: true } }),
  };
}

/**
 * Event Page Component
 */
export default async function EventPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  if (!event) {
    notFound();
  }

  // Verify the slug matches (prevents accessing same event via wrong slug)
  const expectedSlug = generateEventSlug(event.title, event.startDate, event.id);
  if (slug !== expectedSlug) {
    // Redirect to canonical URL would be ideal, but for now just show the event
    // In production, you might want: redirect(`/events/${expectedSlug}`)
  }

  const eventUrl = `${siteUrl}/events/${expectedSlug}`;

  // Check user permissions for score viewing/editing
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const viewerIsSuperAdmin = isSuperAdmin(user?.id);
  const viewerIsVerifiedCurator = user?.id ? await isUserVerifiedCurator(user.id) : false;

  // Determine score permissions
  const canViewScores = viewerIsSuperAdmin || viewerIsVerifiedCurator;
  const canEditScores = viewerIsSuperAdmin;

  // Fetch similar events
  const similarEvents = await getSimilarEvents(event.id);

  // JSON-LD structured data for SEO (null for deduped/dead rows)
  const jsonLd = buildEventJsonLd(event, eventUrl, siteUrl);

  return (
    <>
      {/* JSON-LD Structured Data */}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      )}

      {/* Client Component with interactive features */}
      <EventPageClient
        event={serializeEvent(event)}
        eventPageUrl={eventUrl}
        similarEvents={similarEvents}
        canViewScores={canViewScores}
        canEditScores={canEditScores}
      />
    </>
  );
}
