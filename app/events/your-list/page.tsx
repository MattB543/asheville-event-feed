import { unstable_cache } from 'next/cache';
import EventPageLayout from '@/components/EventPageLayout';
import type { Metadata } from 'next';
import { queryFilteredEvents, getEventMetadata, queryTop30Events } from '@/lib/db/queries/events';
import type { DbEvent, EventMetadata } from '@/lib/db/queries/events';

export const metadata: Metadata = {
  title: 'Your List',
  description:
    'Your personalized event list with recommendations and favorites for Asheville events.',
};

export const revalidate = 3600; // Fallback revalidation every hour

// Cached first page query - loads 250 events for SSR
const getFirstPageEvents = unstable_cache(
  async () => {
    console.log('[YourList] Fetching first page (250 events) for SSR...');
    return queryFilteredEvents({ limit: 250 });
  },
  ['events-first-page'],
  { tags: ['events'], revalidate: 3600 }
);

// Cached metadata - computed from ALL events for filter dropdowns
const getCachedMetadata = unstable_cache(
  async () => {
    console.log('[YourList] Fetching filter metadata...');
    return getEventMetadata();
  },
  ['events-metadata'],
  { tags: ['events'], revalidate: 3600 }
);

// Cached top 30 events query (needed for EventPageLayout props)
const getTop30Events = unstable_cache(
  async () => {
    console.log('[YourList] Fetching top 30 events...');
    return queryTop30Events();
  },
  ['events-top30'],
  { tags: ['events'], revalidate: 3600 }
);

export default async function YourListPage() {
  let initialEvents: DbEvent[] = [];
  let initialTotalCount = 0;
  let top30Events: DbEvent[] = [];
  let metadata: EventMetadata = {
    availableTags: [],
    availableLocations: [],
    availableZips: [],
  };

  try {
    // Fetch first page and metadata in parallel
    const [firstPageResult, metadataResult, top30Result] = await Promise.all([
      getFirstPageEvents(),
      getCachedMetadata(),
      getTop30Events(),
    ]);
    initialEvents = firstPageResult.events;
    initialTotalCount = firstPageResult.totalCount;
    metadata = metadataResult;
    top30Events = top30Result;
    console.log(
      `[YourList] SSR loaded ${initialEvents.length} events (of ${initialTotalCount} total)`
    );
  } catch (error) {
    console.error('[YourList] Failed to fetch events:', error);
    // Fallback to empty arrays
  }

  return (
    <EventPageLayout
      activeTab="yourList"
      initialEvents={initialEvents}
      initialTotalCount={initialTotalCount}
      metadata={metadata}
      top30Events={top30Events}
    />
  );
}
