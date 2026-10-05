import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { gte, asc, and, eq, isNull } from 'drizzle-orm';
import { queryGroupSitemapEntries } from '@/lib/db/queries/groups';
import { generateEventSlug } from '@/lib/utils/slugify';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';

// An async sitemap is otherwise rendered once at build time and never refreshed
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';

  // Base pages. No lastModified: we have no real revision time for these, and a
  // request-time "now" teaches crawlers to ignore lastmod on the event pages too
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      changeFrequency: 'hourly',
      priority: 1,
    },
    {
      url: `${siteUrl}/events`,
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${siteUrl}/events/top30`,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${siteUrl}/posters`,
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/groups`,
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/parking`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${siteUrl}/developers`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  // If no database, return only static pages
  if (!process.env.DATABASE_URL) {
    return staticPages;
  }

  // Group pages get their own try, so a groups failure never drops the event pages
  try {
    const groupEntries = await queryGroupSitemapEntries();
    staticPages.push(
      ...groupEntries.map((group) => ({
        url: `${siteUrl}/groups/${group.slug}`,
        lastModified: group.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }))
    );
  } catch (error) {
    console.error('[Sitemap] Failed to fetch groups:', error);
  }

  try {
    // Get all upcoming, live (non-hidden, non-deduped, non-dead) events for the sitemap
    const startOfToday = getStartOfTodayEastern();

    const allEvents = await db
      .select({
        id: events.id,
        title: events.title,
        startDate: events.startDate,
        updatedAt: events.updatedAt,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(
        and(
          gte(events.startDate, startOfToday),
          eq(events.hidden, false),
          isNull(events.dedupedAt),
          isNull(events.deadAt)
        )
      )
      .orderBy(asc(events.startDate));

    // Generate event page URLs
    const eventPages: MetadataRoute.Sitemap = allEvents.map((event) => ({
      url: `${siteUrl}/events/${generateEventSlug(event.title, event.startDate, event.id)}`,
      // When the listing last changed, not when the event happens
      lastModified: event.updatedAt ?? event.createdAt ?? undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...eventPages];
  } catch (error) {
    console.error('[Sitemap] Failed to fetch events:', error);
    return staticPages;
  }
}
