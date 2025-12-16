import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { sql, InferSelectModel } from "drizzle-orm";
import { parseEventSlug, generateEventSlug } from "@/lib/utils/slugify";
import { cleanMarkdown } from "@/lib/utils/cleanMarkdown";
import EventPageClient from "./EventPageClient";
import { findSimilarEvents } from "@/lib/db/similaritySearch";

type DbEvent = InferSelectModel<typeof events>;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://avlgo.com";

// ISR: Revalidate every hour
export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Fetch event by short ID (first 6 chars of UUID)
 */
async function getEventByShortId(shortId: string): Promise<DbEvent | null> {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const result = await db
    .select()
    .from(events)
    .where(sql`${events.id}::text LIKE ${shortId + "%"}`)
    .limit(1);

  return result[0] || null;
}

/**
 * Generate dynamic metadata for SEO
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseEventSlug(slug);

  if (!parsed) {
    return {
      title: "Event Not Found | AVL GO",
      description: "The event you're looking for could not be found.",
    };
  }

  const event = await getEventByShortId(parsed.shortId);

  if (!event) {
    return {
      title: "Event Not Found | AVL GO",
      description: "The event you're looking for could not be found.",
    };
  }

  const eventUrl = `${siteUrl}/events/${generateEventSlug(event.title, event.startDate, event.id)}`;
  const description =
    cleanMarkdown(event.description)?.slice(0, 160) ||
    `Join us for ${event.title} in Asheville, NC on ${new Date(event.startDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`;

  // Use event image or fall back to site OG image
  const ogImage = event.imageUrl?.startsWith("data:")
    ? `${siteUrl}/avlgo-og.png` // Don't use base64 for OG images
    : event.imageUrl || `${siteUrl}/avlgo-og.png`;

  return {
    title: `${event.title} | AVL GO`,
    description,
    keywords: event.tags || [],

    alternates: {
      canonical: eventUrl,
    },

    openGraph: {
      type: "website",
      url: eventUrl,
      title: event.title,
      description,
      siteName: "AVL GO",
      locale: "en_US",
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
      card: "summary_large_image",
      title: event.title,
      description,
      images: [ogImage],
      creator: "@mattbrooksxyz",
    },

    robots: {
      index: !event.hidden,
      follow: !event.hidden,
    },
  };
}

/**
 * Event Page Component
 */
export default async function EventPage({ params }: PageProps) {
  const { slug } = await params;
  const parsed = parseEventSlug(slug);

  if (!parsed) {
    notFound();
  }

  const event = await getEventByShortId(parsed.shortId);

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

  // Fetch similar events (only if event has embedding)
  let similarEvents: Array<{
    id: string;
    sourceId: string;
    source: string;
    title: string;
    description: string | null;
    aiSummary: string | null;
    startDate: string;
    location: string | null;
    organizer: string | null;
    price: string | null;
    url: string;
    imageUrl: string | null;
    tags: string[] | null;
    timeUnknown: boolean;
    recurringType: string | null;
    favoriteCount: number;
    similarity: number;
  }> = [];

  try {
    // Fetch extra events to allow for recurring event deduplication on client
    const similar = await findSimilarEvents(event.id, { limit: 50, futureOnly: true, orderBy: 'similarity' });
    similarEvents = similar.map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      source: e.source,
      title: e.title,
      description: e.description,
      aiSummary: e.aiSummary,
      startDate: e.startDate.toISOString(),
      location: e.location,
      organizer: e.organizer,
      price: e.price,
      url: e.url,
      imageUrl: e.imageUrl,
      tags: e.tags,
      timeUnknown: e.timeUnknown || false,
      recurringType: e.recurringType,
      favoriteCount: e.favoriteCount || 0,
      similarity: e.similarity,
    }));
  } catch {
    // Silently fail if similarity search fails (e.g., no embedding)
  }

  // JSON-LD structured data for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: cleanMarkdown(event.description) || undefined,
    startDate: event.startDate.toISOString(),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "Place",
      name: event.location || "Asheville, NC",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Asheville",
        addressRegion: "NC",
        postalCode: event.zip || undefined,
        addressCountry: "US",
      },
    },
    image: event.imageUrl && !event.imageUrl.startsWith("data:") ? [event.imageUrl] : [],
    url: eventUrl,
    offers:
      event.price && event.price !== "Unknown"
        ? {
            "@type": "Offer",
            url: event.url,
            price: event.price === "Free" ? "0" : event.price.replace(/[^0-9.]/g, ""),
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
          }
        : undefined,
    organizer: event.organizer
      ? {
          "@type": "Organization",
          name: event.organizer,
        }
      : undefined,
  };

  return (
    <>
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      {/* Client Component with interactive features */}
      <EventPageClient
        event={{
          id: event.id,
          sourceId: event.sourceId,
          title: event.title,
          description: event.description,
          aiSummary: event.aiSummary,
          startDate: event.startDate.toISOString(),
          location: event.location,
          organizer: event.organizer,
          price: event.price,
          imageUrl: event.imageUrl,
          url: event.url,
          tags: event.tags,
          source: event.source,
          timeUnknown: event.timeUnknown || false,
          favoriteCount: event.favoriteCount || 0,
        }}
        eventPageUrl={eventUrl}
        similarEvents={similarEvents}
      />
    </>
  );
}
