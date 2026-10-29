import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { gte, asc, and } from 'drizzle-orm';
import { queryGroupSitemapEntries } from '@/lib/db/queries/groups';
import { generateEventSlug } from '@/lib/utils/slugify';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';
import { liveEvent } from '@/lib/db/liveEvent';
import { SITE_URL } from '@/lib/seo/site';
import { currentSeason } from '@/lib/seasons';

// An async sitemap is otherwise rendered once at build time and never refreshed. Hourly:
// each regeneration writes ~1.1 MB, and crawlers read it far less often than every 5 minutes
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Base pages. No lastModified: we have no real revision time for these, and a
  // request-time "now" teaches crawlers to ignore lastmod on the event pages too
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      changeFrequency: 'hourly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/events`,
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/events/top30`,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/posters`,
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/groups`,
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/playlist`,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/parking`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/plan`,
      changeFrequency: 'daily',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/developers`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  // A holiday page is listed while its season runs (once: /plan is listed all year)
  const season = currentSeason();
  const seasonUrl = season && `${SITE_URL}${season.href}`;
  if (seasonUrl && !staticPages.some((page) => page.url === seasonUrl)) {
    staticPages.push({ url: seasonUrl, changeFrequency: 'daily', priority: 0.8 });
  }

  // If no database, return only static pages
  if (!process.env.DATABASE_URL) {
    return staticPages;
  }

  // Group pages get their own try, so a groups failure never drops the event pages
  try {
    const groupEntries = await queryGroupSitemapEntries();
    staticPages.push(
      ...groupEntries.map((group) => ({
        url: `${SITE_URL}/groups/${group.slug}`,
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
      .where(and(gte(events.startDate, startOfToday), liveEvent))
      .orderBy(asc(events.startDate));

    // Generate event page URLs
    const eventPages: MetadataRoute.Sitemap = allEvents.map((event) => ({
      url: `${SITE_URL}/events/${generateEventSlug(event.title, event.startDate, event.id)}`,
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
