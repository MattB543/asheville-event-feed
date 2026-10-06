import { unstable_cache } from 'next/cache';
import EventPageLayout from '@/components/EventPageLayout';
import type { Metadata } from 'next';
import {
  getListedEventCount,
  getEventMetadata,
  queryTop30Events,
  type EventMetadata,
  type Top30EventsByCategory,
} from '@/lib/db/queries/events';

export const metadata: Metadata = {
  title: 'Top 30 Events',
  description:
    'Discover the top 30 most popular Asheville events, ranked by community interest and engagement.',
};

export const revalidate = 3600; // Fallback revalidation every hour
const TOP30_CANDIDATE_LIMIT = 50;

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
    console.log(`[Top30] Fetching top 30 candidates (limit=${TOP30_CANDIDATE_LIMIT})...`);
    return queryTop30Events(TOP30_CANDIDATE_LIMIT);
  },
  ['events-top30'],
  { tags: ['events'], revalidate: 3600 }
);

export default async function Top30Page() {
  let initialTotalCount = 0;
  let top30Events: Top30EventsByCategory = { overall: [], weird: [], social: [] };
  let metadata: EventMetadata = {
    availableTags: [],
    availableLocations: [],
    availableZips: [],
  };

  try {
    // Fetch the event count, metadata, and top 30 in parallel
    const [eventCount, metadataResult, top30Result] = await Promise.all([
      // Only the count (for the AI chat's greeting), not the feed's first page: the tab renders
      // its own candidates, and the 250 events made this a 1.2 MB page rebuilt on every
      // events invalidation
      getListedEventCount(),
      getCachedMetadata(),
      getTop30Events(),
    ]);
    initialTotalCount = eventCount;
    metadata = metadataResult;
    top30Events = top30Result;
    console.log(
      `[Top30] SSR loaded top30: ${top30Events.overall.length} overall, ${top30Events.weird.length} weird, ${top30Events.social.length} social (${initialTotalCount} events total)`
    );
  } catch (error) {
    console.error('[Top30] Failed to fetch events:', error);
    // Fallback to empty arrays
  }

  return (
    <EventPageLayout
      activeTab="top30"
      initialEvents={[]}
      initialTotalCount={initialTotalCount}
      metadata={metadata}
      top30Events={top30Events}
    />
  );
}
