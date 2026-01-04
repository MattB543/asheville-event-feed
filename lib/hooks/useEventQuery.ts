'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useDebounce } from './useDebounce';

// Filter parameter types
export type DateFilterType = 'all' | 'today' | 'tomorrow' | 'weekend' | 'dayOfWeek' | 'custom';
export type PriceFilterType = 'any' | 'free' | 'under20' | 'under100' | 'custom';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface TagFilterState {
  include: string[];
  exclude: string[];
}

export interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

// Event type from API
export interface Event {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description?: string | null;
  aiSummary?: string | null;
  startDate: string; // ISO string from API
  location?: string | null;
  zip?: string | null;
  organizer?: string | null;
  price?: string | null;
  url: string;
  imageUrl?: string | null;
  tags?: string[] | null;
  hidden?: boolean | null;
  createdAt?: string | null;
  timeUnknown?: boolean | null;
  recurringType?: string | null;
  favoriteCount?: number | null;
  score?: number | null;
  scoreRarity?: number | null;
  scoreUnique?: number | null;
  scoreMagnitude?: number | null;
  scoreReason?: string | null;
}

// Metadata for filter dropdowns
export interface EventMetadata {
  availableTags: string[];
  availableLocations: string[];
  availableZips: { zip: string; count: number }[];
}

// API response
interface EventsApiResponse {
  events: Event[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  metadata?: EventMetadata;
}

// Filter state
export interface EventFilters {
  search: string;
  dateFilter: DateFilterType;
  customDateRange: DateRange;
  selectedDays: number[];
  selectedTimes: TimeOfDay[];
  priceFilter: PriceFilterType;
  customMaxPrice: number | null;
  tagsInclude: string[];
  tagsExclude: string[];
  selectedLocations: string[];
  selectedZips: string[];
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenFingerprints: HiddenEventFingerprint[];
  showDailyEvents: boolean;
  useDefaultFilters: boolean;
}

// Build query params from filters
function buildQueryParams(filters: EventFilters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();

  if (cursor) params.set('cursor', cursor);
  params.set('limit', '100'); // Load 100 events per page for smooth scrolling

  if (filters.search) params.set('search', filters.search);
  if (filters.dateFilter !== 'all') params.set('dateFilter', filters.dateFilter);
  if (filters.dateFilter === 'custom' && filters.customDateRange.start) {
    params.set('dateStart', filters.customDateRange.start);
    if (filters.customDateRange.end) {
      params.set('dateEnd', filters.customDateRange.end);
    }
  }
  if (filters.selectedDays.length > 0) {
    params.set('days', filters.selectedDays.join(','));
  }
  if (filters.selectedTimes.length > 0) {
    params.set('times', filters.selectedTimes.join(','));
  }
  if (filters.priceFilter !== 'any') params.set('priceFilter', filters.priceFilter);
  if (filters.priceFilter === 'custom' && filters.customMaxPrice !== null) {
    params.set('maxPrice', filters.customMaxPrice.toString());
  }
  if (filters.tagsInclude.length > 0) {
    params.set('tagsInclude', filters.tagsInclude.join(','));
  }
  if (filters.tagsExclude.length > 0) {
    params.set('tagsExclude', filters.tagsExclude.join(','));
  }
  if (filters.selectedLocations.length > 0) {
    params.set('locations', filters.selectedLocations.join(','));
  }
  if (filters.selectedZips.length > 0) {
    params.set('zips', filters.selectedZips.join(','));
  }
  if (filters.blockedHosts.length > 0) {
    params.set('blockedHosts', filters.blockedHosts.join(','));
  }
  if (filters.blockedKeywords.length > 0) {
    params.set('blockedKeywords', filters.blockedKeywords.join(','));
  }
  if (filters.showDailyEvents) {
    params.set('showDailyEvents', 'true');
  }
  if (!filters.useDefaultFilters) {
    params.set('useDefaultFilters', 'false');
  }

  return params;
}

// Fetch events from API
async function fetchEvents(filters: EventFilters, cursor?: string): Promise<EventsApiResponse> {
  const params = buildQueryParams(filters, cursor);

  // Log API request for debugging
  const activeFilters = {
    dateFilter: filters.dateFilter,
    dateRange: filters.customDateRange.start
      ? `${filters.customDateRange.start} to ${filters.customDateRange.end}`
      : undefined,
    priceFilter: filters.priceFilter,
    tagsInclude: filters.tagsInclude.length > 0 ? filters.tagsInclude : undefined,
  };
  const hasActiveFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== 'all' && v !== 'any'
  );
  if (hasActiveFilters) {
    console.log(
      '[useEventQuery] Fetching with filters:',
      activeFilters,
      'cursor:',
      cursor || 'none'
    );
  }

  // Use POST for complex filters (hidden fingerprints)
  if (filters.hiddenFingerprints.length > 0) {
    const response = await fetch(`/api/events?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hiddenFingerprints: filters.hiddenFingerprints,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.status}`);
    }

    return response.json() as Promise<EventsApiResponse>;
  }

  // Use GET for simple filters
  const response = await fetch(`/api/events?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.status}`);
  }

  return response.json() as Promise<EventsApiResponse>;
}

interface UseEventQueryOptions {
  filters: EventFilters;
  initialData?: {
    events: Event[];
    totalCount?: number;
    metadata?: EventMetadata;
  };
  enabled?: boolean;
}

export function useEventQuery({ filters, initialData, enabled = true }: UseEventQueryOptions) {
  // Debounce filters to avoid too many API calls
  const debouncedFilters = useDebounce(filters, 150);

  const query = useInfiniteQuery({
    queryKey: ['events', debouncedFilters],
    queryFn: async ({ pageParam }) => {
      return fetchEvents(debouncedFilters, pageParam);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled,
    // Use initialData for SSR hydration
    ...(initialData &&
      initialData.events.length > 0 && {
        initialData: {
          pages: [
            {
              events: initialData.events,
              // Generate cursor from last event so we can fetch more
              nextCursor: (() => {
                const lastEvent = initialData.events[initialData.events.length - 1];
                return `${lastEvent.startDate}_${lastEvent.id}`;
              })(),
              hasMore: true, // Assume there are more events until proven otherwise
              totalCount: initialData.totalCount ?? initialData.events.length,
              metadata: initialData.metadata,
            },
          ],
          pageParams: [undefined],
        },
      }),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnMount: !initialData, // Don't refetch on mount if we have SSR data
  });

  // Flatten pages into single events array
  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  // Get metadata from first page
  const metadata = query.data?.pages[0]?.metadata;

  // Get total count from first page
  const totalCount = query.data?.pages[0]?.totalCount ?? 0;

  // Check if there are more pages
  const hasMore = query.data?.pages[query.data.pages.length - 1]?.hasMore ?? false;

  return {
    events,
    metadata,
    totalCount,
    hasMore,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    error: query.error,
  };
}

// Hook for intersection observer (infinite scroll trigger)
export function useInfiniteScrollTrigger(
  onIntersect: () => void,
  options: {
    enabled?: boolean;
    rootMargin?: string;
  } = {}
) {
  const { enabled = true, rootMargin = '200px' } = options;
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const trigger = triggerRef.current;
    if (!trigger) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onIntersect();
        }
      },
      { rootMargin }
    );

    observer.observe(trigger);

    return () => {
      observer.disconnect();
    };
  }, [enabled, onIntersect, rootMargin]);

  return triggerRef;
}
