import { unstable_cache } from 'next/cache';
import EventPageLayout from '@/components/EventPageLayout';
import type { Metadata } from 'next';
import { getListedEventCount, getEventMetadata } from '@/lib/db/queries/events';
import type { EventMetadata } from '@/lib/db/queries/events';
import { cleanEventIds, getEventsByIds } from '@/lib/db/queries/sharedList';
import { formatDateEastern } from '@/lib/utils/timezone';
import { hasRealEventImage } from '@/lib/utils/eventImages';

const DEFAULT_METADATA: Metadata = {
  title: 'Your List',
  description:
    'Your personalized event list with recommendations and favorites for Asheville events.',
};

// Every unfurl of a shared link would otherwise hit the database; the cache stores
// JSON, so the date travels as a string
const getSharedPreview = unstable_cache(
  async (ids: string[]) =>
    (await getEventsByIds(ids)).map((e) => ({
      title: e.title,
      startDate: e.startDate.toISOString(),
      imageUrl: e.imageUrl,
    })),
  ['shared-list-preview'],
  { tags: ['events'], revalidate: 3600 }
);

// A shared list's link preview describes its events instead of the site
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ shared?: string }>;
}): Promise<Metadata> {
  const ids = cleanEventIds(((await searchParams).shared ?? '').split(','));
  if (ids.length === 0) return DEFAULT_METADATA;
  let shared: Awaited<ReturnType<typeof getSharedPreview>> = [];
  try {
    // Sorted so the same list in a different order shares one cache entry
    shared = await getSharedPreview([...ids].sort());
  } catch (error) {
    console.error('[YourList] Failed to load shared events for the preview:', error);
  }
  if (shared.length === 0) return DEFAULT_METADATA;

  const title =
    shared.length === 1
      ? `${shared[0].title}, picked for you`
      : `${shared.length} Asheville events, picked for you`;
  const listed = shared
    .slice(0, 3)
    .map(
      (e) =>
        `${e.title}, ${formatDateEastern(new Date(e.startDate), { weekday: 'short', month: 'short', day: 'numeric' })}`
    );
  const more = shared.length > 3 ? ` · +${shared.length - 3} more` : '';
  const description = `${listed.join(' · ')}${more}`;
  // Mountain Xpress refuses image requests from other sites, so its posters would preview blank
  const image = shared.find(
    (e) => hasRealEventImage(e.imageUrl) && !e.imageUrl!.includes('mountainx.com')
  )?.imageUrl;
  return {
    title,
    description,
    openGraph: { title, description, ...(image ? { images: [image] } : {}) },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export const revalidate = 3600; // Fallback revalidation every hour

// Cached metadata - computed from ALL events for filter dropdowns
const getCachedMetadata = unstable_cache(
  async () => {
    console.log('[YourList] Fetching filter metadata...');
    return getEventMetadata();
  },
  ['events-metadata'],
  { tags: ['events'], revalidate: 3600 }
);

export default async function YourListPage() {
  let initialTotalCount = 0;
  let metadata: EventMetadata = {
    availableTags: [],
    availableLocations: [],
    availableZips: [],
  };

  try {
    // Fetch the event count and metadata in parallel
    // Only the count (for the AI chat's greeting): everything Your List shows is per-user and
    // fetched in the browser, and sending the feed's first 250 events made this a 1.2 MB page
    // rebuilt on every events invalidation
    const [eventCount, metadataResult] = await Promise.all([
      getListedEventCount(),
      getCachedMetadata(),
    ]);
    initialTotalCount = eventCount;
    metadata = metadataResult;
    console.log(`[YourList] SSR loaded metadata (${initialTotalCount} events total)`);
  } catch (error) {
    console.error('[YourList] Failed to fetch events:', error);
    // Fallback to empty arrays
  }

  return (
    <EventPageLayout
      activeTab="yourList"
      initialEvents={[]}
      initialTotalCount={initialTotalCount}
      metadata={metadata}
      top30Events={{ overall: [], weird: [], social: [] }}
    />
  );
}
