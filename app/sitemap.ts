import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { gte, asc, and, eq } from 'drizzle-orm';
import { generateEventSlug } from '@/lib/utils/slugify';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://avlgo.com';

  // Base pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
  ];

  // If no database, return only static pages
  if (!process.env.DATABASE_URL) {
    return staticPages;
  }

  try {
    // Get all upcoming, non-hidden events for the sitemap
    const startOfToday = getStartOfTodayEastern();

    const allEvents = await db
      .select({
        id: events.id,
        title: events.title,
        startDate: events.startDate,
      })
      .from(events)
      .where(and(gte(events.startDate, startOfToday), eq(events.hidden, false)))
      .orderBy(asc(events.startDate));

    // Generate event page URLs
    const eventPages: MetadataRoute.Sitemap = allEvents.map((event) => ({
      url: `${siteUrl}/events/${generateEventSlug(event.title, event.startDate, event.id)}`,
      lastModified: event.startDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...eventPages];
  } catch (error) {
    console.error('[Sitemap] Failed to fetch events:', error);
    return staticPages;
  }
}
