import { unstable_cache } from 'next/cache';
import EventPageLayout from '@/components/EventPageLayout';
import type { Metadata } from 'next';
import { getListedEventCount, getEventMetadata } from '@/lib/db/queries/events';
import type { EventMetadata } from '@/lib/db/queries/events';

export const metadata: Metadata = {
  title: 'Your List',
  description:
    'Your personalized event list with recommendations and favorites for Asheville events.',
};

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
