import { unstable_cache } from 'next/cache';
import { redirect } from 'next/navigation';
import EventPageLayout from '@/components/EventPageLayout';
import type { Metadata } from 'next';
import {
  queryFilteredEvents,
  getEventMetadata,
  queryTop30Events,
  type DbEvent,
  type EventMetadata,
  type Top30EventsByCategory,
} from '@/lib/db/queries/events';

export const metadata: Metadata = {
  title: 'All Events',
  description:
    'Browse all Asheville events aggregated from 10+ sources. Filter by date, price, tags, and location.',
};

export const revalidate = 3600; // Fallback revalidation every hour

// Cached first page query - loads 250 events for SSR to ensure enough content
// for users who have many events hidden/collapsed
const getFirstPageEvents = unstable_cache(
  async () => {
    console.log('[Events] Fetching first page (250 events) for SSR...');
    return queryFilteredEvents({ limit: 250 });
  },
  ['events-first-page'],
  { tags: ['events'], revalidate: 3600 }
);

// Cached metadata - computed from ALL events for filter dropdowns
const getCachedMetadata = unstable_cache(
  async () => {
    console.log('[Events] Fetching filter metadata...');
    return getEventMetadata();
  },
  ['events-metadata'],
  { tags: ['events'], revalidate: 3600 }
);

// Cached top 30 events query
const getTop30Events = unstable_cache(
  async () => {
    console.log('[Events] Fetching top 30 events...');
    return queryTop30Events();
  },
  ['events-top30'],
  { tags: ['events'], revalidate: 3600 }
);

interface EventsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const params = await searchParams;

  // Backwards compatibility: redirect ?tab=forYou to /events/your-list
  if (params.tab === 'forYou') {
    const newParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'tab' && value) {
        newParams.set(key, Array.isArray(value) ? value[0] : value);
      }
    });
    const queryString = newParams.toString();
    redirect(`/events/your-list${queryString ? `?${queryString}` : ''}`);
  }

  const activeTab = params.tab === 'top30' ? 'top30' : 'all';

  let initialEvents: DbEvent[] = [];
  let initialTotalCount = 0;
  let top30Events: Top30EventsByCategory = { overall: [], weird: [], social: [] };
  let metadata: EventMetadata = {
    availableTags: [],
    availableLocations: [],
    availableZips: [],
  };

  try {
    // Fetch first page, metadata, and top 30 in parallel
    const [firstPageResult, metadataResult, top30Result] = await Promise.all([
      getFirstPageEvents(),
      getCachedMetadata(),
      activeTab === 'top30'
        ? getTop30Events()
        : Promise.resolve({ overall: [], weird: [], social: [] }),
    ]);
    initialEvents = firstPageResult.events;
    initialTotalCount = firstPageResult.totalCount;
    metadata = metadataResult;
    top30Events = top30Result;
    console.log(
      `[Events] SSR loaded ${initialEvents.length} events (of ${initialTotalCount} total)${
        activeTab === 'top30'
          ? `, top30: ${top30Events.overall.length} overall, ${top30Events.weird.length} weird, ${top30Events.social.length} social`
          : ''
      }`
    );
  } catch (error) {
    console.error('[Events] Failed to fetch events:', error);
    // Fallback to empty arrays
  }

  return (
    <EventPageLayout
      activeTab={activeTab}
      initialEvents={initialEvents}
      initialTotalCount={initialTotalCount}
      metadata={metadata}
      top30Events={top30Events}
    />
  );
}
