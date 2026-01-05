import { unstable_cache } from 'next/cache';
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
  title: 'Top 30 Events',
  description:
    'Discover the top 30 most popular Asheville events, ranked by community interest and engagement.',
};

export const revalidate = 3600; // Fallback revalidation every hour

// Cached first page query - loads 250 events for SSR
const getFirstPageEvents = unstable_cache(
  async () => {
    console.log('[Top30] Fetching first page (250 events) for SSR...');
    return queryFilteredEvents({ limit: 250 });
  },
  ['events-first-page'],
  { tags: ['events'], revalidate: 3600 }
);

// Cached metadata - computed from ALL events for filter dropdowns
const getCachedMetadata = unstable_cache(
  async () => {
    console.log('[Top30] Fetching filter metadata...');
    return getEventMetadata();
  },
  ['events-metadata'],
  { tags: ['events'], revalidate: 3600 }
);

// Cached top 30 events query
const getTop30Events = unstable_cache(
  async () => {
    console.log('[Top30] Fetching top 30 events...');
    return queryTop30Events();
  },
  ['events-top30'],
  { tags: ['events'], revalidate: 3600 }
);

export default async function Top30Page() {
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
      getTop30Events(),
    ]);
    initialEvents = firstPageResult.events;
    initialTotalCount = firstPageResult.totalCount;
    metadata = metadataResult;
    top30Events = top30Result;
    console.log(
      `[Top30] SSR loaded ${initialEvents.length} events (of ${initialTotalCount} total), top30: ${top30Events.overall.length} overall, ${top30Events.weird.length} weird, ${top30Events.social.length} social`
    );
  } catch (error) {
    console.error('[Top30] Failed to fetch events:', error);
    // Fallback to empty arrays
  }

  return (
    <EventPageLayout
      activeTab="top30"
      initialEvents={initialEvents}
      initialTotalCount={initialTotalCount}
      metadata={metadata}
      top30Events={top30Events}
    />
  );
}
