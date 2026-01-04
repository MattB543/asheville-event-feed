'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import EventCard from './EventCard';
import FilterBar, {
  type DateFilterType,
  type PriceFilterType,
  type DateRange,
  type TimeOfDay,
} from './FilterBar';
import ActiveFilters, { type ActiveFilter } from './ActiveFilters';
import { parse, isValid } from 'date-fns';
import dynamic from 'next/dynamic';
import { EventFeedSkeleton } from './EventCardSkeleton';
import {
  useEventQuery,
  useInfiniteScrollTrigger,
  type Event as ApiEvent,
  type EventMetadata,
} from '@/lib/hooks/useEventQuery';

// Lazy load modals to reduce initial JS bundle - they're only needed when opened
const FilterModal = dynamic(() => import('./FilterModal'), { ssr: false });
const AIChatModal = dynamic(() => import('./AIChatModal'), { ssr: false });
const CurateModal = dynamic(() => import('./CurateModal'), { ssr: false });
const EventDetailModal = dynamic(() => import('./EventDetailModal'), { ssr: false });
// SaveFeedModal is not lazy loaded to avoid delay when showSavePrompt is in URL
import SaveFeedModal from './SaveFeedModal';
import { DEFAULT_BLOCKED_KEYWORDS } from '@/lib/config/defaultFilters';
import { useToast } from './ui/Toast';
import { ArrowDownIcon, ArrowUpIcon, ArrowRight, Loader2Icon, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { getZipName } from '@/lib/config/zipNames';
import { usePreferenceSync } from '@/lib/hooks/usePreferenceSync';
import { useAuth } from './AuthProvider';
import { extractMonthFromSearch, getMonthDateRange } from '@/lib/utils/monthSearch';

// Use the Event type from API, but with Date for startDate (parsed client-side)
type Event = Omit<ApiEvent, 'startDate'> & { startDate: Date };

type ForYouTier = 'great' | 'good' | null;
type ForYouBucket = 'today' | 'tomorrow' | 'week' | 'later';

interface ForYouScoredEvent {
  event: ApiEvent;
  score: number;
  tier: ForYouTier;
  explanation?: {
    primary: { eventId: string; title: string } | null;
  };
  bucket: ForYouBucket;
  matchCount?: number;
  sources?: Array<{
    signalEventId: string;
    signalEventTitle: string;
    similarity: number;
  }>;
}

interface ForYouMeta {
  signalCount: number;
  minimumMet: boolean;
  signalEventsUsed?: number;
  candidatesFound?: number;
}

interface ForYouResponse {
  events?: ForYouScoredEvent[];
  meta?: ForYouMeta;
}

interface CurationsResponse {
  curations?: Array<{ eventId: string }>;
}

// Initial event type from SSR (database format - may use Date objects or strings after serialization)
interface InitialEvent {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description?: string | null;
  aiSummary?: string | null;
  startDate: Date | string; // May be Date or string after SSR serialization
  location?: string | null;
  zip?: string | null;
  organizer?: string | null;
  price?: string | null;
  url: string;
  imageUrl?: string | null;
  tags?: string[] | null;
  hidden?: boolean | null;
  createdAt?: Date | string | null; // May be Date or string after SSR serialization
  timeUnknown?: boolean | null;
  recurringType?: string | null;
  favoriteCount?: number | null;
  score?: number | null;
  scoreRarity?: number | null;
  scoreUnique?: number | null;
  scoreMagnitude?: number | null;
  scoreReason?: string | null;
}

type DatedInitialEvent = Omit<InitialEvent, 'startDate'> & { startDate: Date };

interface EventFeedProps {
  initialEvents?: InitialEvent[];
  initialTotalCount?: number;
  initialMetadata?: EventMetadata;
  activeTab?: 'all' | 'top30' | 'yourList';
  top30Events?: InitialEvent[];
}

// Tag filter state for include/exclude tri-state filtering
export interface TagFilterState {
  include: string[];
  exclude: string[];
}

// Fingerprint for hiding recurring events (title + organizer combo)
interface HiddenEventFingerprint {
  title: string; // normalized: lowercase, trimmed
  organizer: string; // normalized: lowercase, trimmed (empty if null)
}

// Create a fingerprint key string for comparison
function createFingerprintKey(title: string, organizer: string | null | undefined): string {
  const normalizedTitle = title.toLowerCase().trim();
  const normalizedOrganizer = (organizer || '').toLowerCase().trim();
  return `${normalizedTitle}|||${normalizedOrganizer}`;
}

// Score tier for filtering events by quality
export type ScoreTier = 'hidden' | 'quality' | 'outstanding';

// Get the score tier for an event based on its score
function getEventScoreTier(score: number | null | undefined): ScoreTier {
  if (score === null || score === undefined) return 'hidden'; // null excluded from top events
  if (score <= 14) return 'hidden'; // Common: 0-14
  if (score <= 18) return 'quality'; // Quality: 15-18
  return 'outstanding'; // Outstanding: 19+
}

function getStorageItem<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = localStorage.getItem(key);
    if (!item) return defaultValue;
    return JSON.parse(item) as T;
  } catch {
    return defaultValue;
  }
}

// Check if localStorage contains non-default filters that would affect query results
// This runs synchronously at initialization to detect if we should skip SSR data
function hasNonDefaultLocalStorageFilters(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const dateFilter = getStorageItem('dateFilter', 'all');
    const priceFilter = getStorageItem('priceFilter', 'any');
    const tagFilters = getStorageItem<{
      include: string[];
      exclude: string[];
    } | null>('tagFilters', null);
    const selectedTags = getStorageItem<string[]>('selectedTags', []); // old format
    const selectedLocations = getStorageItem<string[]>('selectedLocations', []);
    const selectedZips = getStorageItem<string[]>('selectedZips', []);
    const selectedTimes = getStorageItem<TimeOfDay[]>('selectedTimes', []);
    const selectedDays = getStorageItem<number[]>('selectedDays', []);
    const blockedHosts = getStorageItem<string[]>('blockedHosts', []);
    const blockedKeywords = getStorageItem<string[]>('blockedKeywords', []);
    const hiddenEvents = getStorageItem<HiddenEventFingerprint[]>('hiddenEvents', []);
    const showDailyEvents = getStorageItem<boolean>('showDailyEvents', false);
    const customDateRange = getStorageItem<{
      start: string | null;
      end: string | null;
    }>('customDateRange', { start: null, end: null });
    const search = getStorageItem<string>('search', '');

    return (
      dateFilter !== 'all' ||
      priceFilter !== 'any' ||
      (tagFilters?.include?.length ?? 0) > 0 ||
      (tagFilters?.exclude?.length ?? 0) > 0 ||
      selectedTags.length > 0 ||
      selectedLocations.length > 0 ||
      selectedZips.length > 0 ||
      selectedTimes.length > 0 ||
      selectedDays.length > 0 ||
      blockedHosts.length > 0 ||
      blockedKeywords.length > 0 ||
      hiddenEvents.length > 0 ||
      showDailyEvents === true ||
      customDateRange.start !== null ||
      search.trim().length > 0
    );
  } catch {
    return false;
  }
}

// Parse URL filters on initial load (client-side only)
// Returns null if no filter params present, otherwise returns parsed filters
interface UrlFilters {
  search?: string;
  dateFilter?: DateFilterType;
  customDateRange?: DateRange;
  selectedDays?: number[];
  selectedTimes?: TimeOfDay[];
  priceFilter?: PriceFilterType;
  customMaxPrice?: number | null;
  tagsInclude?: string[];
  tagsExclude?: string[];
  selectedLocations?: string[];
}

function getInitialFiltersFromUrl(): {
  filters: UrlFilters;
  hasFilters: boolean;
} {
  if (typeof window === 'undefined') {
    return { filters: {}, hasFilters: false };
  }

  const params = new URLSearchParams(window.location.search);

  // Check if any filter params exist
  const hasFilters =
    params.has('search') ||
    params.has('dateFilter') ||
    params.has('times') ||
    params.has('priceFilter') ||
    params.has('tagsInclude') ||
    params.has('tagsExclude') ||
    params.has('locations') ||
    params.has('dateStart');

  if (!hasFilters) {
    return { filters: {}, hasFilters: false };
  }

  console.log(
    '[EventFeed] URL filters detected, parsing params:',
    Object.fromEntries(params.entries())
  );

  const filters: UrlFilters = {};

  // Search
  if (params.has('search')) {
    filters.search = params.get('search') || '';
  }

  // Date filter
  if (params.has('dateFilter')) {
    const df = params.get('dateFilter') as DateFilterType;
    if (['all', 'today', 'tomorrow', 'weekend', 'dayOfWeek', 'custom'].includes(df)) {
      filters.dateFilter = df;
    }
  }

  // Days
  if (params.has('days')) {
    const days =
      params
        .get('days')
        ?.split(',')
        .map(Number)
        .filter((n) => !isNaN(n) && n >= 0 && n <= 6) || [];
    filters.selectedDays = days;
  }

  // Times
  if (params.has('times')) {
    const validTimes = ['morning', 'afternoon', 'evening'] as const;
    const times =
      params
        .get('times')
        ?.split(',')
        .filter((t): t is TimeOfDay => validTimes.includes(t as TimeOfDay)) || [];
    filters.selectedTimes = times;
  }

  // Custom date range
  if (params.has('dateStart')) {
    filters.customDateRange = {
      start: params.get('dateStart'),
      end: params.get('dateEnd'),
    };
    // If dateStart is present but dateFilter isn't explicitly set, assume custom
    if (!filters.dateFilter) {
      filters.dateFilter = 'custom';
    }
  }

  // Price filter
  if (params.has('priceFilter')) {
    const pf = params.get('priceFilter') as PriceFilterType;
    if (['any', 'free', 'under20', 'under100', 'custom'].includes(pf)) {
      filters.priceFilter = pf;
    }
  }

  // Custom max price
  if (params.has('maxPrice')) {
    const mp = parseInt(params.get('maxPrice') || '', 10);
    if (!isNaN(mp) && mp >= 0) {
      filters.customMaxPrice = mp;
    }
  }

  // Tags include/exclude
  if (params.has('tagsInclude')) {
    filters.tagsInclude = params.get('tagsInclude')?.split(',').filter(Boolean) || [];
  }
  if (params.has('tagsExclude')) {
    filters.tagsExclude = params.get('tagsExclude')?.split(',').filter(Boolean) || [];
  }

  // Locations
  if (params.has('locations')) {
    filters.selectedLocations = params.get('locations')?.split(',').filter(Boolean) || [];
  }

  console.log('[EventFeed] Parsed URL filters:', filters);

  return { filters, hasFilters: true };
}

// Safe date parsing helper that returns undefined on invalid dates
// This parses yyyy-MM-dd strings as LOCAL dates (not UTC)
function safeParseDateString(dateStr: string | null): Date | undefined {
  if (!dateStr) return undefined;
  try {
    const parsed = parse(dateStr, 'yyyy-MM-dd', new Date());
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dateLabels: Record<DateFilterType, string> = {
  all: 'All Dates',
  today: 'Today',
  tomorrow: 'Tomorrow',
  weekend: 'This Weekend',
  dayOfWeek: 'Day of Week',
  custom: 'Custom Dates',
};

const priceLabels: Record<PriceFilterType, string> = {
  any: 'Any Price',
  free: 'Free',
  under20: 'Under $20',
  under100: 'Under $100',
  custom: 'Custom Max',
};

export default function EventFeed({
  initialEvents,
  initialTotalCount,
  initialMetadata,
  activeTab = 'all',
  top30Events: initialTop30Events,
}: EventFeedProps) {
  const { showToast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const isLoggedIn = !!user;

  // For You feed state
  const [forYouEvents, setForYouEvents] = useState<ForYouScoredEvent[]>([]);
  const [forYouMeta, setForYouMeta] = useState<ForYouMeta | null>(null);
  const [forYouLoading, setForYouLoading] = useState(false);
  // Track events being hidden (for animation)
  const [hidingEventIds, setHidingEventIds] = useState<Set<string>>(new Set());

  // Top 30 feed state
  const [top30SortMode, setTop30SortMode] = useState<'score' | 'date'>('score');
  const [forYouSortMode, setForYouSortMode] = useState<'score' | 'date'>('score');

  // Your List sub-tab state (recommended vs favorites)
  const [yourListSubTab, setYourListSubTab] = useState<'recommended' | 'favorites'>('recommended');

  // Parse URL filters once at initialization (not in useEffect)
  // This ensures filters are correct from the first render
  const [urlFilterState] = useState(() => getInitialFiltersFromUrl());
  const urlFilters = urlFilterState.filters;
  const hasUrlFilters = urlFilterState.hasFilters;

  // Check if localStorage has non-default filters at initialization
  // This runs synchronously before useEventQuery decides to use SSR data
  const [hasLocalStorageFilters] = useState(() => hasNonDefaultLocalStorageFilters());

  // Track which events the user has favorited (persisted to localStorage)
  const [favoritedEventIds, setFavoritedEventIds] = useState<string[]>(() =>
    getStorageItem('favoritedEventIds', [])
  );
  const [favoriteEventsData, setFavoriteEventsData] = useState<ApiEvent[]>([]);
  const [favoriteEventsLoading, setFavoriteEventsLoading] = useState(false);

  const [curatedEventIds, setCuratedEventIds] = useState<Set<string>>(new Set());
  const [curateModalOpen, setCurateModalOpen] = useState(false);
  const [curateModalEventId, setCurateModalEventId] = useState<string | null>(null);
  const [curateModalEventTitle, setCurateModalEventTitle] = useState('');

  // Event detail modal state
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedEventForModal, setSelectedEventForModal] = useState<Event | null>(null);

  // Search (committed value only - FilterBar handles local input state)
  // URL params take priority over localStorage
  const [search, setSearch] = useState(() => urlFilters.search ?? '');

  // Filters - URL params take priority over localStorage for shared links
  const [dateFilter, setDateFilter] = useState<DateFilterType>(
    () => urlFilters.dateFilter ?? getStorageItem('dateFilter', 'all')
  );
  const [customDateRange, setCustomDateRange] = useState<DateRange>(
    () =>
      urlFilters.customDateRange ?? getStorageItem('customDateRange', { start: null, end: null })
  );
  const [selectedDays, setSelectedDays] = useState<number[]>(
    () => urlFilters.selectedDays ?? getStorageItem('selectedDays', [])
  );
  const [selectedTimes, setSelectedTimes] = useState<TimeOfDay[]>(
    () => urlFilters.selectedTimes ?? getStorageItem('selectedTimes', [])
  );
  const [priceFilter, setPriceFilter] = useState<PriceFilterType>(
    () => urlFilters.priceFilter ?? getStorageItem('priceFilter', 'any')
  );
  const [customMaxPrice, setCustomMaxPrice] = useState<number | null>(() =>
    urlFilters.customMaxPrice !== undefined
      ? urlFilters.customMaxPrice
      : getStorageItem('customMaxPrice', null)
  );
  // Tag filters with include/exclude (with migration from old selectedTags format)
  const [tagFilters, setTagFilters] = useState<TagFilterState>(() => {
    // URL params take priority
    if (urlFilters.tagsInclude || urlFilters.tagsExclude) {
      return {
        include: urlFilters.tagsInclude || [],
        exclude: urlFilters.tagsExclude || [],
      };
    }
    // Try new format first
    const newFormat = getStorageItem<TagFilterState | null>('tagFilters', null);
    if (newFormat && (newFormat.include || newFormat.exclude)) return newFormat;

    // Migrate from old format
    const oldSelectedTags = getStorageItem<string[]>('selectedTags', []);
    return { include: oldSelectedTags, exclude: [] };
  });
  const [selectedLocations, setSelectedLocations] = useState<string[]>(
    () => urlFilters.selectedLocations ?? getStorageItem('selectedLocations', [])
  );
  const [selectedZips, setSelectedZips] = useState<string[]>(() =>
    getStorageItem('selectedZips', [])
  );
  // Daily events filter - default to hiding daily events
  const [showDailyEvents, setShowDailyEvents] = useState<boolean>(() =>
    getStorageItem('showDailyEvents', false)
  );

  // Track which date groups show all events (session only)
  const [expandedDateGroups, setExpandedDateGroups] = useState<Set<string>>(new Set());

  // Track expanded minimized events (session only - resets on page reload)
  const [expandedMinimizedIds, setExpandedMinimizedIds] = useState<Set<string>>(new Set());

  // Track expanded mobile cards (session only - resets on page reload)
  const [mobileExpandedIds, setMobileExpandedIds] = useState<Set<string>>(new Set());

  // Settings & Modals
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [blockedHosts, setBlockedHosts] = useState<string[]>(() =>
    getStorageItem('blockedHosts', [])
  );
  const [blockedKeywords, setBlockedKeywords] = useState<string[]>(() =>
    getStorageItem('blockedKeywords', [])
  );
  const [hiddenEvents, setHiddenEvents] = useState<HiddenEventFingerprint[]>(() =>
    getStorageItem('hiddenEvents', [])
  );
  // Track events hidden THIS session (not persisted) - these show greyed out instead of being filtered
  const [sessionHiddenKeys, setSessionHiddenKeys] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Track if filters have been modified after initial load
  // This ensures we don't use SSR initialData after user changes filters
  const hasModifiedFilters = useRef(false);
  const isFirstFilterChange = useRef(true);

  // Build filters object for the query
  const filters = useMemo(
    () => ({
      search,
      dateFilter,
      customDateRange,
      selectedDays,
      selectedTimes,
      priceFilter,
      customMaxPrice,
      tagsInclude: tagFilters.include,
      tagsExclude: tagFilters.exclude,
      selectedLocations,
      selectedZips,
      blockedHosts,
      blockedKeywords,
      hiddenFingerprints: hiddenEvents,
      showDailyEvents,
      useDefaultFilters: true,
    }),
    [
      search,
      dateFilter,
      customDateRange,
      selectedDays,
      selectedTimes,
      priceFilter,
      customMaxPrice,
      tagFilters,
      selectedLocations,
      selectedZips,
      blockedHosts,
      blockedKeywords,
      hiddenEvents,
      showDailyEvents,
    ]
  );

  // Detect when filters change after initial load - this means we shouldn't use SSR data
  useEffect(() => {
    if (!isLoaded) return;

    // Skip the first change (which is the initial load)
    if (isFirstFilterChange.current) {
      isFirstFilterChange.current = false;
      return;
    }

    // Mark that filters have been modified by user interaction
    hasModifiedFilters.current = true;
  }, [filters, isLoaded]);

  // Prepare initial data for hydration (convert Date objects to ISO strings for API format)
  const preparedInitialData = useMemo(() => {
    if (!initialEvents || initialEvents.length === 0) return undefined;
    return {
      events: initialEvents.map((e) => ({
        ...e,
        // Handle both Date objects and string dates (from SSR serialization)
        startDate: typeof e.startDate === 'string' ? e.startDate : e.startDate.toISOString(),
        createdAt: e.createdAt
          ? typeof e.createdAt === 'string'
            ? e.createdAt
            : e.createdAt.toISOString()
          : null,
      })) as ApiEvent[],
      totalCount: initialTotalCount,
      metadata: initialMetadata,
    };
  }, [initialEvents, initialTotalCount, initialMetadata]);

  // Use the event query hook for server-side filtering
  // Only use SSR initialData on first load with no URL filters and no user filter changes
  // Once filters change, we must fetch fresh data to avoid showing stale SSR results
  const shouldUseInitialData =
    !hasUrlFilters && !hasLocalStorageFilters && !hasModifiedFilters.current;

  const {
    events: apiEvents,
    metadata: queryMetadata,
    totalCount,
    hasMore,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
  } = useEventQuery({
    filters,
    initialData: shouldUseInitialData ? preparedInitialData : undefined,
    enabled: isLoaded, // Only fetch after client hydration
  });

  // Log when URL or localStorage filters cause fresh fetch
  useEffect(() => {
    if (isLoaded) {
      if (hasUrlFilters) {
        console.log('[EventFeed] Fetching fresh data (URL filters present, skipped SSR data)');
      } else if (hasLocalStorageFilters) {
        console.log(
          '[EventFeed] Fetching fresh data (localStorage filters present, skipped SSR data)'
        );
      }
    }
  }, [hasUrlFilters, hasLocalStorageFilters, isLoaded]);

  // Convert API events to component format (parse startDate string to Date)
  const events = useMemo(
    () =>
      apiEvents.map((e) => ({
        ...e,
        startDate: new Date(e.startDate),
      })),
    [apiEvents]
  );

  // Use query metadata or initial metadata
  const metadata = queryMetadata || initialMetadata;

  // Infinite scroll trigger
  const loadMoreRef = useInfiniteScrollTrigger(
    () => {
      if (hasMore && !isFetchingNextPage) {
        void fetchNextPage();
      }
    },
    { enabled: hasMore && !isFetchingNextPage }
  );

  // Show loading indicator when fetching
  const isFilterPending = isFetching && !isFetchingNextPage;

  // filteredEvents is now just events from the query (server already filtered)
  // Score tier filtering is now done per-day in the rendering logic
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Only filter out events hidden in THIS session if they're newly hidden
      // Events hidden in previous sessions are already filtered server-side
      const eventKey = createFingerprintKey(event.title, event.organizer);
      if (sessionHiddenKeys.has(eventKey)) {
        // Don't filter, just mark as hidden (will show greyed out)
        return true;
      }
      return true;
    });
  }, [events, sessionHiddenKeys]);

  // Whether we should show the per-day toggle (hide during search/tags/locations)
  const showDayToggle = useMemo(() => {
    const hasActiveSearch = search.trim().length > 0;
    const hasIncludedTags = tagFilters.include.length > 0;
    const hasLocationFilter = selectedLocations.length > 0;
    return !hasActiveSearch && !hasIncludedTags && !hasLocationFilter;
  }, [search, tagFilters.include, selectedLocations]);

  const favoritedEvents = useMemo(() => {
    if (favoritedEventIds.length === 0) return [];
    const favoriteIds = new Set(favoritedEventIds);
    const seen = new Set<string>();
    const results: DatedInitialEvent[] = [];

    const addEvent = (event: InitialEvent | ApiEvent) => {
      if (!favoriteIds.has(event.id) || seen.has(event.id)) return;
      seen.add(event.id);
      results.push({
        ...event,
        startDate:
          typeof event.startDate === 'string' ? new Date(event.startDate) : event.startDate,
      });
    };

    favoriteEventsData.forEach(addEvent);
    initialEvents?.forEach(addEvent);

    return results.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [favoritedEventIds, favoriteEventsData, initialEvents]);

  // Preference sync with database (for logged-in users)
  // Uses refs to avoid stale closures in callbacks
  const blockedHostsRef = useRef(blockedHosts);
  const blockedKeywordsRef = useRef(blockedKeywords);
  const hiddenEventsRef = useRef(hiddenEvents);
  const favoritedEventIdsRef = useRef(favoritedEventIds);

  useEffect(() => {
    blockedHostsRef.current = blockedHosts;
    blockedKeywordsRef.current = blockedKeywords;
    hiddenEventsRef.current = hiddenEvents;
    favoritedEventIdsRef.current = favoritedEventIds;
  }, [blockedHosts, blockedKeywords, hiddenEvents, favoritedEventIds]);

  const { saveToDatabase, isLoggedIn: isPrefSyncLoggedIn } = usePreferenceSync({
    getBlockedHosts: () => blockedHostsRef.current,
    getBlockedKeywords: () => blockedKeywordsRef.current,
    getHiddenEvents: () => hiddenEventsRef.current,
    getFavoritedEventIds: () => favoritedEventIdsRef.current,
    setBlockedHosts,
    setBlockedKeywords,
    setHiddenEvents,
    setFavoritedEventIds,
  });

  // Set isLoaded after mount to prevent hydration mismatch
  useEffect(() => {
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    const uniqueIds = Array.from(new Set(favoritedEventIds)).filter((id) => id.trim().length > 0);
    if (uniqueIds.length === 0) {
      setFavoriteEventsData([]);
      setFavoriteEventsLoading(false);
      return;
    }

    const controller = new AbortController();
    setFavoriteEventsLoading(true);

    void (async () => {
      try {
        const response = await fetch('/api/events/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: uniqueIds.slice(0, 200) }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to load favorites: ${response.status}`);
        }

        const data = (await response.json()) as { events?: ApiEvent[] };
        const events = Array.isArray(data.events) ? data.events : [];
        setFavoriteEventsData(events);
      } catch (error) {
        if ((error as DOMException).name === 'AbortError') return;
        console.error('[Favorites] Failed to load favorites:', error);
      } finally {
        setFavoriteEventsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [favoritedEventIds, isLoaded]);

  // Fetch For You feed when tab switches to yourList
  useEffect(() => {
    console.log('[YourList] useEffect triggered:', {
      isLoaded,
      activeTab,
      isLoggedIn,
      authLoading,
    });

    if (!isLoaded || activeTab !== 'yourList' || !isLoggedIn) {
      console.log('[YourList] Early return - conditions not met:', {
        isLoaded,
        activeTab,
        isLoggedIn,
      });
      return;
    }

    const fetchForYou = async () => {
      console.log('[ForYou] Starting fetch...');
      setForYouLoading(true);
      try {
        const response = await fetch('/api/for-you');
        console.log('[ForYou] Response status:', response.status);
        if (!response.ok) {
          throw new Error('Failed to fetch personalized feed');
        }
        const data = (await response.json()) as ForYouResponse;
        const events = Array.isArray(data.events) ? data.events : [];
        const meta = data.meta ?? { signalCount: 0, minimumMet: false };
        console.log('[ForYou] Data received:', {
          eventCount: events.length,
          meta,
        });
        setForYouEvents(events);
        setForYouMeta(meta);
      } catch (error) {
        console.error('[ForYou] Error fetching:', error);
        showToast('Failed to load personalized feed', 'error');
      } finally {
        console.log('[ForYou] Fetch complete, setting loading to false');
        setForYouLoading(false);
      }
    };

    void fetchForYou();
  }, [activeTab, isLoaded, isLoggedIn, authLoading, showToast]);

  // Fetch curations on mount for logged-in users
  useEffect(() => {
    if (!isLoggedIn) return;

    const fetchCurations = async () => {
      try {
        const res = await fetch('/api/curate');
        if (!res.ok) return;
        const data = (await res.json()) as CurationsResponse;
        const curations = Array.isArray(data.curations) ? data.curations : [];
        if (curations.length === 0) return;
        const ids = new Set<string>(curations.map((c) => c.eventId));
        setCuratedEventIds(ids);
      } catch (error) {
        console.error(error);
      }
    };

    void fetchCurations();
  }, [isLoggedIn]);

  // Track scroll position for scroll-to-top button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Save filter settings to localStorage
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('search', JSON.stringify(search));
      localStorage.setItem('dateFilter', JSON.stringify(dateFilter));
      localStorage.setItem('customDateRange', JSON.stringify(customDateRange));
      localStorage.setItem('selectedDays', JSON.stringify(selectedDays));
      localStorage.setItem('selectedTimes', JSON.stringify(selectedTimes));
      localStorage.setItem('priceFilter', JSON.stringify(priceFilter));
      localStorage.setItem('customMaxPrice', JSON.stringify(customMaxPrice));
      localStorage.setItem('tagFilters', JSON.stringify(tagFilters));
      localStorage.setItem('selectedLocations', JSON.stringify(selectedLocations));
      localStorage.setItem('selectedZips', JSON.stringify(selectedZips));
      localStorage.setItem('blockedHosts', JSON.stringify(blockedHosts));
      localStorage.setItem('blockedKeywords', JSON.stringify(blockedKeywords));
      localStorage.setItem('hiddenEvents', JSON.stringify(hiddenEvents));
      localStorage.setItem('showDailyEvents', JSON.stringify(showDailyEvents));
      localStorage.setItem('favoritedEventIds', JSON.stringify(favoritedEventIds));
    }
  }, [
    dateFilter,
    customDateRange,
    selectedDays,
    selectedTimes,
    priceFilter,
    customMaxPrice,
    tagFilters,
    selectedLocations,
    selectedZips,
    blockedHosts,
    blockedKeywords,
    hiddenEvents,
    showDailyEvents,
    favoritedEventIds,
    isLoaded,
    search,
  ]);

  // Sync preferences to database when they change (for logged-in users)
  useEffect(() => {
    if (isLoaded && isPrefSyncLoggedIn) {
      saveToDatabase();
    }
  }, [
    blockedHosts,
    blockedKeywords,
    hiddenEvents,
    favoritedEventIds,
    isLoaded,
    isPrefSyncLoggedIn,
    saveToDatabase,
  ]);

  // Handle non-filter URL params on mount (filter params are handled at initialization)
  useEffect(() => {
    if (!isLoaded) return;

    const params = new URLSearchParams(window.location.search);

    // Check for save feed prompt (from custom feed builder)
    if (params.has('showSavePrompt')) {
      // Only show once per session
      const hasShownSavePrompt = sessionStorage.getItem('hasShownSavePrompt');
      if (!hasShownSavePrompt) {
        setShowSaveModal(true);
        sessionStorage.setItem('hasShownSavePrompt', 'true');
      }
      // Remove the param from URL without triggering a reload
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('showSavePrompt');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, [isLoaded]); // Only run once after hydration

  // Use pre-computed metadata from server (API returns this with first page)
  const availableTags = metadata?.availableTags || [];
  const availableLocations = metadata?.availableLocations || [];
  const availableZips = metadata?.availableZips || [];

  // Check if all locations are selected (empty array means "all selected" = no filter)
  const allLocationsSelected = selectedLocations.length === 0;

  // Handle search changes with month detection
  // If user searches a month name (e.g., "March", "events in jan"), convert to date filter
  const handleSearchChange = useCallback(
    (value: string) => {
      const monthResult = extractMonthFromSearch(value);

      if (monthResult) {
        const { month, year, remainingText } = monthResult;
        const dateRange = getMonthDateRange(month, year);
        setDateFilter('custom');
        setCustomDateRange({ start: dateRange.start, end: dateRange.end });
        setSearch(remainingText); // Keep remaining keywords as search
      } else {
        setSearch(value); // Normal search
      }
    },
    [setDateFilter, setCustomDateRange, setSearch]
  );

  // Build active filters list for display
  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];

    if (search) {
      filters.push({ id: 'search', type: 'search', label: `"${search}"` });
    }
    if (dateFilter !== 'all') {
      let label = dateLabels[dateFilter];
      if (dateFilter === 'dayOfWeek' && selectedDays.length > 0) {
        label = selectedDays.map((d) => DAY_NAMES[d]).join(', ');
      } else if (dateFilter === 'custom' && customDateRange.start) {
        const startDate = safeParseDateString(customDateRange.start);
        const endDate = safeParseDateString(customDateRange.end);
        if (endDate && customDateRange.end !== customDateRange.start) {
          label = `${startDate!.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })} - ${endDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}`;
        } else if (startDate) {
          label = startDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
        }
      }
      filters.push({ id: 'date', type: 'date', label });
    }
    if (selectedTimes.length > 0) {
      const timeLabels: Record<TimeOfDay, string> = {
        morning: 'Morning',
        afternoon: 'Afternoon',
        evening: 'Evening',
      };
      const label = selectedTimes.map((t) => timeLabels[t]).join(', ');
      filters.push({ id: 'time', type: 'time', label });
    }
    if (priceFilter !== 'any') {
      let label = priceLabels[priceFilter];
      if (priceFilter === 'custom' && customMaxPrice !== null) {
        label = `Under $${customMaxPrice}`;
      }
      filters.push({ id: 'price', type: 'price', label });
    }
    tagFilters.include.forEach((tag) => {
      filters.push({
        id: `tag-include-${tag}`,
        type: 'tag-include',
        label: tag,
      });
    });
    tagFilters.exclude.forEach((tag) => {
      filters.push({
        id: `tag-exclude-${tag}`,
        type: 'tag-exclude',
        label: tag,
      });
    });
    // Only show location filters if not all locations are selected
    if (!allLocationsSelected) {
      selectedLocations.forEach((loc) => {
        let label = loc;
        if (loc === 'asheville') label = 'Asheville area';
        filters.push({ id: `location-${loc}`, type: 'location', label });
      });
    }
    selectedZips.forEach((zip) => {
      const name = getZipName(zip);
      filters.push({
        id: `zip-${zip}`,
        type: 'zip',
        label: `${zip} (${name})`,
      });
    });

    return filters;
  }, [
    search,
    dateFilter,
    customDateRange,
    selectedDays,
    selectedTimes,
    priceFilter,
    customMaxPrice,
    tagFilters,
    selectedLocations,
    selectedZips,
    allLocationsSelected,
  ]);

  // Handle removing filters
  const handleRemoveFilter = useCallback((id: string) => {
    if (id === 'search') {
      setSearch('');
    } else if (id === 'date') {
      setDateFilter('all');
      setCustomDateRange({ start: null, end: null });
      setSelectedDays([]);
    } else if (id === 'time') {
      setSelectedTimes([]);
    } else if (id === 'price') {
      setPriceFilter('any');
      setCustomMaxPrice(null);
    } else if (id.startsWith('location-')) {
      const loc = id.replace('location-', '');
      setSelectedLocations((prev) => prev.filter((l) => l !== loc));
    } else if (id.startsWith('zip-')) {
      const zip = id.replace('zip-', '');
      setSelectedZips((prev) => prev.filter((z) => z !== zip));
    } else if (id.startsWith('tag-include-')) {
      const tag = id.replace('tag-include-', '');
      setTagFilters((prev) => ({
        ...prev,
        include: prev.include.filter((t) => t !== tag),
      }));
    } else if (id.startsWith('tag-exclude-')) {
      const tag = id.replace('tag-exclude-', '');
      setTagFilters((prev) => ({
        ...prev,
        exclude: prev.exclude.filter((t) => t !== tag),
      }));
    }
  }, []);

  // Clear all filters
  const handleClearAllFilters = useCallback(() => {
    setSearch('');
    setDateFilter('all');
    setCustomDateRange({ start: null, end: null });
    setSelectedDays([]);
    setSelectedTimes([]);
    setPriceFilter('any');
    setCustomMaxPrice(null);
    setTagFilters({ include: [], exclude: [] });
    setSelectedLocations([]);
    setSelectedZips([]);
  }, []);

  // Helper to capture signal
  const captureSignal = useCallback(
    async (
      eventId: string,
      signalType: 'favorite' | 'calendar' | 'share' | 'viewSource' | 'hide'
    ): Promise<boolean> => {
      console.log('[Signal] captureSignal called:', {
        eventId,
        signalType,
        isLoggedIn,
        authLoading,
        userId: user?.id,
      });

      // If auth is still loading, wait a moment
      if (authLoading) {
        console.log('[Signal] Auth still loading, waiting 500ms...');
        await new Promise((resolve) => setTimeout(resolve, 500));
        console.log('[Signal] Done waiting, isLoggedIn now:', isLoggedIn);
      }

      if (!isLoggedIn) {
        console.log('[Signal] Skipped - user not logged in (authLoading:', authLoading, ')');
        return false;
      }

      console.log('[Signal] Making API call to /api/signals...');
      try {
        const response = await fetch('/api/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, signalType }),
        });

        console.log('[Signal] API response status:', response.status);

        if (!response.ok) {
          const errorData: unknown = await response.json().catch(() => ({}));
          console.error('[Signal] API error:', response.status, errorData);
          return false;
        }

        const data: unknown = await response.json();
        console.log('[Signal] Captured successfully:', signalType, eventId, data);
        return true;
      } catch (error) {
        console.error('[Signal] Network error:', error);
        return false;
      }
    },
    [isLoggedIn, authLoading, user?.id]
  );

  // Handler for capturing calendar/share/viewSource signals
  const handleSignalCapture = useCallback(
    (eventId: string, signalType: 'calendar' | 'share' | 'viewSource') => {
      void captureSignal(eventId, signalType);
    },
    [captureSignal]
  );

  // Hide event (by title + organizer fingerprint)
  const handleHideEvent = useCallback(
    (title: string, organizer: string | null, eventId?: string) => {
      const fingerprint: HiddenEventFingerprint = {
        title: title.toLowerCase().trim(),
        organizer: (organizer || '').toLowerCase().trim(),
      };
      const key = createFingerprintKey(title, organizer);

      // Capture hide signal if eventId provided
      if (eventId) {
        void captureSignal(eventId, 'hide');
      }

      // If on Your List tab and eventId provided, add animation
      if (activeTab === 'yourList' && eventId) {
        setHidingEventIds((prev) => new Set([...prev, eventId]));
        // Remove from For You feed after animation (300ms)
        setTimeout(() => {
          setForYouEvents((prev) => prev.filter((e) => e.event.id !== eventId));
          setHidingEventIds((prev) => {
            const next = new Set(prev);
            next.delete(eventId);
            return next;
          });
        }, 300);
      }

      // Add to session hidden keys first (so UI updates immediately)
      setSessionHiddenKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });

      // Add to persistent hidden events
      setHiddenEvents((prev) => {
        // Avoid duplicates
        const exists = prev.some(
          (fp) => fp.title === fingerprint.title && fp.organizer === fingerprint.organizer
        );
        if (exists) return prev;
        return [...prev, fingerprint];
      });
    },
    [activeTab, captureSignal]
  );

  // Block host
  const handleBlockHost = useCallback(
    (host: string) => {
      if (!blockedHosts.includes(host)) {
        setBlockedHosts((prev) => [...prev, host]);
        showToast(`Blocked events from ${host}`);
      }
    },
    [blockedHosts, showToast]
  );

  // Toggle favorite for an event
  const toggleFavorite = useCallback(
    async (eventId: string) => {
      const isFavorited = favoritedEventIds.includes(eventId);
      const action = isFavorited ? 'remove' : 'add';

      console.log('[Favorite] Toggle:', eventId, 'action:', action, 'isLoggedIn:', isLoggedIn);

      // Optimistically update local state
      setFavoritedEventIds((prev) =>
        isFavorited ? prev.filter((id) => id !== eventId) : [...prev, eventId]
      );

      try {
        const response = await fetch(`/api/events/${eventId}/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });

        if (!response.ok) {
          throw new Error('Failed to update favorite');
        }

        // Capture signal for favorites (only when adding, not removing)
        if (!isFavorited) {
          // Await to ensure signal is captured before function returns
          await captureSignal(eventId, 'favorite');
        } else {
          console.log('[Favorite] Unfavorite - no signal captured (expected)');
        }
      } catch (error) {
        // Revert optimistic update on error
        setFavoritedEventIds((prev) =>
          isFavorited ? [...prev, eventId] : prev.filter((id) => id !== eventId)
        );
        console.error('[Favorite] Failed to toggle:', error);
      }
    },
    [favoritedEventIds, captureSignal, isLoggedIn]
  );

  const handleToggleFavorite = useCallback(
    (eventId: string) => {
      void toggleFavorite(eventId);
    },
    [toggleFavorite]
  );

  const handleOpenCurateModal = (eventId: string) => {
    const event = filteredEvents.find((e) => e.id === eventId);
    if (event) {
      setCurateModalEventId(eventId);
      setCurateModalEventTitle(event.title);
      setCurateModalOpen(true);
    }
  };

  // Event detail modal handlers
  const handleOpenEventModal = useCallback((event: Event) => {
    setSelectedEventForModal(event);
    setEventModalOpen(true);
  }, []);

  const handleCloseEventModal = useCallback(() => {
    setEventModalOpen(false);
    setSelectedEventForModal(null);
  }, []);

  const curateEvent = useCallback(
    async (note?: string) => {
      if (!curateModalEventId) return;

      // Optimistic update
      setCuratedEventIds((prev) => new Set([...prev, curateModalEventId]));

      try {
        const res = await fetch('/api/curate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: curateModalEventId,
            action: 'add',
            note,
          }),
        });

        if (!res.ok) {
          // Revert on error
          setCuratedEventIds((prev) => {
            const next = new Set(prev);
            next.delete(curateModalEventId);
            return next;
          });
        }
      } catch {
        // Revert on error
        setCuratedEventIds((prev) => {
          const next = new Set(prev);
          next.delete(curateModalEventId);
          return next;
        });
      }

      setCurateModalOpen(false);
      setCurateModalEventId(null);
    },
    [curateModalEventId]
  );

  const handleCurate = useCallback(
    (note?: string) => {
      void curateEvent(note);
    },
    [curateEvent]
  );

  const uncurateEvent = useCallback(async (eventId: string) => {
    // Optimistic update
    setCuratedEventIds((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });

    try {
      const res = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, action: 'remove' }),
      });

      if (!res.ok) {
        // Revert on error
        setCuratedEventIds((prev) => new Set([...prev, eventId]));
      }
    } catch {
      // Revert on error
      setCuratedEventIds((prev) => new Set([...prev, eventId]));
    }
  }, []);

  const handleUncurate = useCallback(
    (eventId: string) => {
      void uncurateEvent(eventId);
    },
    [uncurateEvent]
  );

  // Build export URL with current filters (includes personal filters for XML/Markdown export)
  const exportParams = useMemo(() => {
    const params = new URLSearchParams();

    if (search) params.set('search', search);
    if (dateFilter !== 'all') params.set('dateFilter', dateFilter);
    if (dateFilter === 'dayOfWeek' && selectedDays.length > 0) {
      params.set('days', selectedDays.join(','));
    }
    if (selectedTimes.length > 0) {
      params.set('times', selectedTimes.join(','));
    }
    if (dateFilter === 'custom' && customDateRange.start) {
      params.set('dateStart', customDateRange.start);
      if (customDateRange.end) params.set('dateEnd', customDateRange.end);
    }
    if (priceFilter !== 'any') params.set('priceFilter', priceFilter);
    if (priceFilter === 'custom' && customMaxPrice !== null) {
      params.set('maxPrice', customMaxPrice.toString());
    }
    if (tagFilters.include.length > 0) params.set('tagsInclude', tagFilters.include.join(','));
    if (tagFilters.exclude.length > 0) params.set('tagsExclude', tagFilters.exclude.join(','));

    // Client-side filters that need to be passed to export
    if (blockedHosts.length > 0) params.set('blockedHosts', blockedHosts.join(','));
    if (blockedKeywords.length > 0) params.set('blockedKeywords', blockedKeywords.join(','));
    if (hiddenEvents.length > 0) params.set('hiddenEvents', JSON.stringify(hiddenEvents));
    if (selectedLocations.length > 0) params.set('locations', selectedLocations.join(','));
    if (selectedZips.length > 0) params.set('zips', selectedZips.join(','));
    if (showDailyEvents) params.set('showDailyEvents', 'true');

    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }, [
    search,
    dateFilter,
    customDateRange,
    selectedDays,
    selectedTimes,
    priceFilter,
    customMaxPrice,
    tagFilters,
    blockedHosts,
    blockedKeywords,
    hiddenEvents,
    selectedLocations,
    selectedZips,
    showDailyEvents,
  ]);

  // Build shareable URL with only public filters (excludes personal blockedHosts/blockedKeywords/hiddenEvents)
  const shareParams = useMemo(() => {
    const params = new URLSearchParams();

    if (search) params.set('search', search);
    if (dateFilter !== 'all') params.set('dateFilter', dateFilter);
    if (dateFilter === 'dayOfWeek' && selectedDays.length > 0) {
      params.set('days', selectedDays.join(','));
    }
    if (selectedTimes.length > 0) {
      params.set('times', selectedTimes.join(','));
    }
    if (dateFilter === 'custom' && customDateRange.start) {
      params.set('dateStart', customDateRange.start);
      if (customDateRange.end) params.set('dateEnd', customDateRange.end);
    }
    if (priceFilter !== 'any') params.set('priceFilter', priceFilter);
    if (priceFilter === 'custom' && customMaxPrice !== null) {
      params.set('maxPrice', customMaxPrice.toString());
    }
    if (tagFilters.include.length > 0) params.set('tagsInclude', tagFilters.include.join(','));
    if (tagFilters.exclude.length > 0) params.set('tagsExclude', tagFilters.exclude.join(','));
    if (selectedLocations.length > 0) params.set('locations', selectedLocations.join(','));
    if (selectedZips.length > 0) params.set('zips', selectedZips.join(','));
    if (showDailyEvents) params.set('showDailyEvents', 'true');

    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }, [
    search,
    dateFilter,
    customDateRange,
    selectedDays,
    selectedTimes,
    priceFilter,
    customMaxPrice,
    tagFilters,
    selectedLocations,
    selectedZips,
    showDailyEvents,
  ]);

  // Sync URL with current filter state (enables sharing via address bar)
  useEffect(() => {
    if (!isLoaded) return;

    const newUrl = `${window.location.pathname}${shareParams}`;

    // Only update if URL actually changed
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, '', newUrl);
    }
  }, [shareParams, isLoaded]);

  // SSR renders skeleton, client renders events after hydration (no artificial delay)
  // This keeps the page size small for Vercel's ISR limits
  if (!isLoaded) return <EventFeedSkeleton />;

  return (
    <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-6">
      <FilterBar
        search={search}
        onSearchChange={handleSearchChange}
        dateFilter={dateFilter}
        customDateRange={customDateRange}
        selectedDays={selectedDays}
        selectedTimes={selectedTimes}
        priceFilter={priceFilter}
        customMaxPrice={customMaxPrice}
        selectedLocations={selectedLocations}
        selectedZips={selectedZips}
        tagFilters={tagFilters}
        showDailyEvents={showDailyEvents}
        onOpenFilters={() => setIsFilterModalOpen(true)}
        exportParams={exportParams}
        shareParams={shareParams}
        onOpenChat={() => setIsChatOpen(true)}
        simplified={activeTab === 'top30'}
      />

      <ActiveFilters
        filters={activeFilters}
        onRemove={handleRemoveFilter}
        onClearAll={handleClearAllFilters}
        onClearAllTags={() => setTagFilters({ include: [], exclude: [] })}
        isPending={isFilterPending}
      />

      {/* Filtering indicator */}
      {isFilterPending && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Filtering...</span>
          </div>
        </div>
      )}

      {/* Your List Feed */}
      {activeTab === 'yourList' && (
        <>
          {/* Sign-in Prompt + Favorites for Anonymous Users */}
          {!isLoggedIn && (
            <>
              <div className="text-center py-12 px-4">
                <Sparkles size={48} className="mx-auto text-brand-500 mb-4" />
                <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
                  Get personalized recommendations
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                  Sign in to build a feed tailored to your interests. Like events you love, and
                  we&apos;ll show you more like them.
                </p>
                <a
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors"
                >
                  Sign in to get started
                </a>
              </div>

              {/* Your Favorites Section (below CTA) */}
              {favoritedEventIds.length > 0 && (
                <div className="mt-4">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 px-3 sm:px-0">
                    Your Favorites (
                    {favoritedEvents.length > 0 ? favoritedEvents.length : favoritedEventIds.length}
                    )
                  </h2>
                  {favoriteEventsLoading && favoritedEvents.length === 0 ? (
                    <div className="flex items-center justify-center py-10 text-sm text-gray-500 dark:text-gray-400">
                      Loading your favorites...
                    </div>
                  ) : (
                    <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700">
                      {favoritedEvents.map((event) => (
                        <EventCard
                          key={event.id}
                          event={{
                            ...event,
                            sourceId: event.sourceId,
                            location: event.location ?? null,
                            organizer: event.organizer ?? null,
                            price: event.price ?? null,
                            imageUrl: event.imageUrl ?? null,
                            timeUnknown: event.timeUnknown ?? false,
                            recurringType: event.recurringType ?? null,
                          }}
                          onHide={handleHideEvent}
                          onBlockHost={handleBlockHost}
                          onSignalCapture={handleSignalCapture}
                          isNewlyHidden={false}
                          hideBorder
                          isFavorited={true}
                          favoriteCount={event.favoriteCount ?? 0}
                          onToggleFavorite={handleToggleFavorite}
                          isTagFilterActive={false}
                          isCurated={curatedEventIds.has(event.id)}
                          onCurate={handleOpenCurateModal}
                          onUncurate={handleUncurate}
                          isLoggedIn={isLoggedIn}
                          displayMode="full"
                          isHiding={hidingEventIds.has(event.id)}
                          isMobileExpanded={mobileExpandedIds.has(event.id)}
                          onMobileExpand={(id) =>
                            setMobileExpandedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) {
                                next.delete(id);
                              } else {
                                next.add(id);
                              }
                              return next;
                            })
                          }
                          onOpenModal={handleOpenEventModal}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Sub-Tab Switcher for Logged-In Users */}
          {isLoggedIn && !forYouLoading && (
            <div className="flex items-center gap-1 mb-4 px-3 sm:px-0">
              <button
                onClick={() => setYourListSubTab('recommended')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  yourListSubTab === 'recommended'
                    ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                Recommended
              </button>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <button
                onClick={() => setYourListSubTab('favorites')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  yourListSubTab === 'favorites'
                    ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                Your Favorites
                {favoritedEventIds.length > 0 && (
                  <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">
                    ({favoritedEventIds.length})
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Recommended Tab Content */}
          {isLoggedIn && yourListSubTab === 'recommended' && (
            <>
              {/* Onboarding Banner */}
              {forYouMeta && !forYouMeta.minimumMet && forYouMeta.signalCount > 0 && (
                <div className="mb-4 px-3 sm:px-0">
                  <div className="bg-brand-50 dark:bg-brand-950/50 border border-brand-200 dark:border-brand-800 rounded-lg px-4 py-3 flex items-center gap-3">
                    <Sparkles size={18} className="text-brand-600 dark:text-brand-400 shrink-0" />
                    <p className="text-sm text-brand-700 dark:text-brand-300">
                      <strong>{forYouMeta.signalCount}/5 events liked</strong> — keep going to
                      improve your recommendations!
                    </p>
                  </div>
                </div>
              )}

              {/* Empty State */}
              {forYouMeta &&
                forYouMeta.signalCount === 0 &&
                forYouEvents.length === 0 &&
                !forYouLoading && (
                  <div className="text-center py-20 px-4">
                    <Sparkles size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Build your personalized feed
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                      Search and favorite events you&apos;re interested in to build your custom feed
                    </p>
                  </div>
                )}

              {/* Sort Mode Toggle */}
              {!forYouLoading && forYouEvents.length > 0 && (
                <div className="flex items-center justify-between mb-4 px-3 sm:px-0">
                  <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                    <button
                      onClick={() => setForYouSortMode('score')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                        forYouSortMode === 'score'
                          ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                      }`}
                    >
                      By Score
                    </button>
                    <button
                      onClick={() => setForYouSortMode('date')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                        forYouSortMode === 'date'
                          ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                      }`}
                    >
                      By Date
                    </button>
                  </div>
                  <a
                    href="/profile/taste"
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                  >
                    Edit taste profile →
                  </a>
                </div>
              )}

              {/* Score-ranked view */}
              {!forYouLoading && forYouEvents.length > 0 && forYouSortMode === 'score' && (
                <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700 ">
                  {[...forYouEvents]
                    .sort((a, b) => b.score - a.score)
                    .map((scoredEvent, index) => {
                      const event: Event = {
                        ...scoredEvent.event,
                        startDate: new Date(scoredEvent.event.startDate),
                      };
                      return (
                        <EventCard
                          key={event.id}
                          event={{
                            ...event,
                            sourceId: event.sourceId,
                            location: event.location ?? null,
                            organizer: event.organizer ?? null,
                            price: event.price ?? null,
                            imageUrl: event.imageUrl ?? null,
                            timeUnknown: event.timeUnknown ?? false,
                            recurringType: event.recurringType ?? null,
                          }}
                          onHide={handleHideEvent}
                          onBlockHost={handleBlockHost}
                          onSignalCapture={handleSignalCapture}
                          isNewlyHidden={false}
                          hideBorder
                          isFavorited={favoritedEventIds.includes(event.id)}
                          favoriteCount={event.favoriteCount ?? 0}
                          onToggleFavorite={handleToggleFavorite}
                          isTagFilterActive={false}
                          isCurated={curatedEventIds.has(event.id)}
                          onCurate={handleOpenCurateModal}
                          onUncurate={handleUncurate}
                          isLoggedIn={isLoggedIn}
                          displayMode="full"
                          isHiding={hidingEventIds.has(event.id)}
                          isGreatMatch={scoredEvent.tier === 'great'}
                          ranking={index + 1}
                          isMobileExpanded={mobileExpandedIds.has(event.id)}
                          onMobileExpand={(id) =>
                            setMobileExpandedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) {
                                next.delete(id);
                              } else {
                                next.add(id);
                              }
                              return next;
                            })
                          }
                          onOpenModal={handleOpenEventModal}
                        />
                      );
                    })}
                </div>
              )}

              {/* Date-grouped view */}
              {!forYouLoading && forYouEvents.length > 0 && forYouSortMode === 'date' && (
                <div className="flex flex-col gap-10 mt-3">
                  {Object.entries(
                    forYouEvents.reduce(
                      (
                        groups: Record<string, { date: Date; events: ForYouScoredEvent[] }>,
                        scoredEvent
                      ) => {
                        const date = new Date(scoredEvent.event.startDate);
                        const dateKey = date.toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        });
                        if (!groups[dateKey]) {
                          groups[dateKey] = { date: date, events: [] };
                        }
                        groups[dateKey].events.push(scoredEvent);
                        return groups;
                      },
                      {} as Record<string, { date: Date; events: ForYouScoredEvent[] }>
                    )
                  )
                    .sort(([, a], [, b]) => a.date.getTime() - b.date.getTime())
                    .map(([dateKey, { date, events: groupEvents }]) => {
                      const today = new Date();
                      const tomorrow = new Date(today);
                      tomorrow.setDate(tomorrow.getDate() + 1);

                      let headerText = dateKey;
                      if (date.toDateString() === today.toDateString()) {
                        headerText = `Today, ${date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}`;
                      } else if (date.toDateString() === tomorrow.toDateString()) {
                        headerText = `Tomorrow, ${date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}`;
                      }

                      // Sort by score within each day
                      const sortedGroupEvents = [...groupEvents].sort((a, b) => b.score - a.score);

                      return (
                        <div key={dateKey} className="flex flex-col">
                          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 sticky top-0 bg-white dark:bg-gray-900 sm:border sm:border-b-0 sm:border-gray-200 dark:sm:border-gray-700 sm:rounded-t-lg pt-3 pb-2 px-3 sm:px-4 z-10">
                            {headerText}
                          </h2>
                          <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-b-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700 ">
                            {sortedGroupEvents.map((scoredEvent) => {
                              const event: Event = {
                                ...scoredEvent.event,
                                startDate: new Date(scoredEvent.event.startDate),
                              };
                              return (
                                <EventCard
                                  key={event.id}
                                  event={{
                                    ...event,
                                    sourceId: event.sourceId,
                                    location: event.location ?? null,
                                    organizer: event.organizer ?? null,
                                    price: event.price ?? null,
                                    imageUrl: event.imageUrl ?? null,
                                    timeUnknown: event.timeUnknown ?? false,
                                    recurringType: event.recurringType ?? null,
                                  }}
                                  onHide={handleHideEvent}
                                  onBlockHost={handleBlockHost}
                                  onSignalCapture={handleSignalCapture}
                                  isNewlyHidden={false}
                                  hideBorder
                                  isFavorited={favoritedEventIds.includes(event.id)}
                                  favoriteCount={event.favoriteCount ?? 0}
                                  onToggleFavorite={handleToggleFavorite}
                                  isTagFilterActive={false}
                                  isCurated={curatedEventIds.has(event.id)}
                                  onCurate={handleOpenCurateModal}
                                  onUncurate={handleUncurate}
                                  isLoggedIn={isLoggedIn}
                                  displayMode="full"
                                  isHiding={hidingEventIds.has(event.id)}
                                  isGreatMatch={scoredEvent.tier === 'great'}
                                  isMobileExpanded={mobileExpandedIds.has(event.id)}
                                  onMobileExpand={(id) =>
                                    setMobileExpandedIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(id)) {
                                        next.delete(id);
                                      } else {
                                        next.add(id);
                                      }
                                      return next;
                                    })
                                  }
                                  onOpenModal={handleOpenEventModal}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}

          {/* Loading State (applies to both sub-tabs) */}
          {isLoggedIn && forYouLoading && (
            <div className="text-center py-20">
              <div className="inline-block w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading your personalized feed...
              </p>
            </div>
          )}

          {/* Your Favorites Tab Content */}
          {isLoggedIn && yourListSubTab === 'favorites' && (
            <>
              {/* Loading state */}
              {favoriteEventsLoading && favoritedEventIds.length > 0 && (
                <div className="text-center py-20 px-4 text-sm text-gray-500 dark:text-gray-400">
                  Loading your favorites...
                </div>
              )}

              {/* Empty state for no favorites */}
              {!favoriteEventsLoading && favoritedEvents.length === 0 && (
                <div className="text-center py-20 px-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                  </svg>
                  <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    No favorites yet
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                    Tap the heart icon on any event to add it to your favorites.
                  </p>
                </div>
              )}

              {/* Favorites list */}
              {!favoriteEventsLoading && favoritedEvents.length > 0 && (
                <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700">
                  {favoritedEvents.map((event) => (
                    <EventCard
                      key={event.id}
                      event={{
                        ...event,
                        sourceId: event.sourceId,
                        location: event.location ?? null,
                        organizer: event.organizer ?? null,
                        price: event.price ?? null,
                        imageUrl: event.imageUrl ?? null,
                        timeUnknown: event.timeUnknown ?? false,
                        recurringType: event.recurringType ?? null,
                      }}
                      onHide={handleHideEvent}
                      onBlockHost={handleBlockHost}
                      onSignalCapture={handleSignalCapture}
                      isNewlyHidden={false}
                      hideBorder
                      isFavorited={true}
                      favoriteCount={event.favoriteCount ?? 0}
                      onToggleFavorite={handleToggleFavorite}
                      isTagFilterActive={false}
                      isCurated={curatedEventIds.has(event.id)}
                      onCurate={handleOpenCurateModal}
                      onUncurate={handleUncurate}
                      isLoggedIn={isLoggedIn}
                      displayMode="full"
                      isHiding={hidingEventIds.has(event.id)}
                      isMobileExpanded={mobileExpandedIds.has(event.id)}
                      onMobileExpand={(id) =>
                        setMobileExpandedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) {
                            next.delete(id);
                          } else {
                            next.add(id);
                          }
                          return next;
                        })
                      }
                      onOpenModal={handleOpenEventModal}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Top 30 Feed */}
      {activeTab === 'top30' && (
        <>
          {/* Page Title */}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 px-3 sm:px-0">
            Top 30 events in the next 30 days
          </h1>

          {/* Sort Mode Toggle */}
          <div className="flex items-center mb-4 px-3 sm:px-0">
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setTop30SortMode('score')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  top30SortMode === 'score'
                    ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                By Score
              </button>
              <button
                onClick={() => setTop30SortMode('date')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  top30SortMode === 'date'
                    ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                By Date
              </button>
            </div>
          </div>

          {/* Empty State */}
          {(!initialTop30Events || initialTop30Events.length === 0) && (
            <div className="text-center py-20 px-4">
              <div className="text-4xl mb-4">🏆</div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                No top-rated events found
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                Check back later for the highest-scored events in the next 30 days.
              </p>
            </div>
          )}

          {/* Score-ranked view */}
          {top30SortMode === 'score' && initialTop30Events && initialTop30Events.length > 0 && (
            <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700 ">
              {(initialTop30Events || [])
                .map((event) => ({
                  ...event,
                  startDate:
                    typeof event.startDate === 'string'
                      ? new Date(event.startDate)
                      : event.startDate,
                }))
                .filter((event) => {
                  // Apply search filter
                  if (search.trim()) {
                    const searchLower = search.toLowerCase();
                    const matchesSearch =
                      event.title.toLowerCase().includes(searchLower) ||
                      event.description?.toLowerCase().includes(searchLower) ||
                      event.organizer?.toLowerCase().includes(searchLower) ||
                      event.location?.toLowerCase().includes(searchLower);
                    if (!matchesSearch) return false;
                  }
                  // Apply price filter
                  if (priceFilter !== 'any') {
                    const priceStr = event.price?.toLowerCase() || '';
                    const isFree =
                      !event.price ||
                      priceStr === 'unknown' ||
                      priceStr === '' ||
                      priceStr.includes('free');
                    const priceNum = parseFloat(event.price?.replace(/[^0-9.]/g, '') || '0');
                    if (priceFilter === 'free' && !isFree) return false;
                    if (priceFilter === 'under20' && priceNum > 20) return false;
                    if (priceFilter === 'under100' && priceNum > 100) return false;
                  }
                  // Apply date filter
                  if (dateFilter !== 'all') {
                    const eventDate = new Date(event.startDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const dayAfterTomorrow = new Date(tomorrow);
                    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

                    if (dateFilter === 'today' && (eventDate < today || eventDate >= tomorrow))
                      return false;
                    if (
                      dateFilter === 'tomorrow' &&
                      (eventDate < tomorrow || eventDate >= dayAfterTomorrow)
                    )
                      return false;
                  }
                  return true;
                })
                .map((event, index) => (
                  <EventCard
                    key={event.id}
                    event={{
                      ...event,
                      sourceId: event.sourceId,
                      location: event.location ?? null,
                      organizer: event.organizer ?? null,
                      price: event.price ?? null,
                      imageUrl: event.imageUrl ?? null,
                      timeUnknown: event.timeUnknown ?? false,
                      recurringType: event.recurringType ?? null,
                    }}
                    onHide={handleHideEvent}
                    onBlockHost={handleBlockHost}
                    onSignalCapture={handleSignalCapture}
                    isNewlyHidden={false}
                    hideBorder
                    isFavorited={favoritedEventIds.includes(event.id)}
                    favoriteCount={event.favoriteCount ?? 0}
                    onToggleFavorite={handleToggleFavorite}
                    isTagFilterActive={false}
                    isCurated={curatedEventIds.has(event.id)}
                    onCurate={handleOpenCurateModal}
                    onUncurate={handleUncurate}
                    isLoggedIn={isLoggedIn}
                    displayMode="full"
                    eventScore={event.score}
                    ranking={index + 1}
                    isMobileExpanded={mobileExpandedIds.has(event.id)}
                    onMobileExpand={(id) =>
                      setMobileExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) {
                          next.delete(id);
                        } else {
                          next.add(id);
                        }
                        return next;
                      })
                    }
                    onOpenModal={handleOpenEventModal}
                  />
                ))}
            </div>
          )}

          {/* Date-grouped view */}
          {top30SortMode === 'date' && initialTop30Events && initialTop30Events.length > 0 && (
            <div className="flex flex-col gap-10 mt-3">
              {Object.entries(
                (initialTop30Events || [])
                  .map(
                    (event): DatedInitialEvent => ({
                      ...event,
                      startDate:
                        typeof event.startDate === 'string'
                          ? new Date(event.startDate)
                          : event.startDate,
                    })
                  )
                  .filter((event) => {
                    // Apply search filter
                    if (search.trim()) {
                      const searchLower = search.toLowerCase();
                      const matchesSearch =
                        event.title.toLowerCase().includes(searchLower) ||
                        event.description?.toLowerCase().includes(searchLower) ||
                        event.organizer?.toLowerCase().includes(searchLower) ||
                        event.location?.toLowerCase().includes(searchLower);
                      if (!matchesSearch) return false;
                    }
                    // Apply price filter
                    if (priceFilter !== 'any') {
                      const priceStr = event.price?.toLowerCase() || '';
                      const isFree =
                        !event.price ||
                        priceStr === 'unknown' ||
                        priceStr === '' ||
                        priceStr.includes('free');
                      const priceNum = parseFloat(event.price?.replace(/[^0-9.]/g, '') || '0');
                      if (priceFilter === 'free' && !isFree) return false;
                      if (priceFilter === 'under20' && priceNum > 20) return false;
                      if (priceFilter === 'under100' && priceNum > 100) return false;
                    }
                    // Apply date filter
                    if (dateFilter !== 'all') {
                      const eventDate = new Date(event.startDate);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const tomorrow = new Date(today);
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      const dayAfterTomorrow = new Date(tomorrow);
                      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

                      if (dateFilter === 'today' && (eventDate < today || eventDate >= tomorrow))
                        return false;
                      if (
                        dateFilter === 'tomorrow' &&
                        (eventDate < tomorrow || eventDate >= dayAfterTomorrow)
                      )
                        return false;
                    }
                    return true;
                  })
                  .reduce(
                    (groups, event) => {
                      const date = new Date(event.startDate);
                      const dateKey = date.toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      });
                      if (!groups[dateKey]) {
                        groups[dateKey] = { date: date, events: [] };
                      }
                      groups[dateKey].events.push(event);
                      return groups;
                    },
                    {} as Record<string, { date: Date; events: DatedInitialEvent[] }>
                  )
              )
                .sort(([, a], [, b]) => a.date.getTime() - b.date.getTime())
                .map(([dateKey, { date, events: groupEvents }]) => {
                  const today = new Date();
                  const tomorrow = new Date(today);
                  tomorrow.setDate(tomorrow.getDate() + 1);

                  let headerText = dateKey;
                  if (date.toDateString() === today.toDateString()) {
                    headerText = `Today, ${date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}`;
                  } else if (date.toDateString() === tomorrow.toDateString()) {
                    headerText = `Tomorrow, ${date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}`;
                  }

                  // Sort by score within each day
                  const sortedGroupEvents = [...groupEvents].sort(
                    (a, b) => (b.score ?? 0) - (a.score ?? 0)
                  );

                  return (
                    <div key={dateKey} className="flex flex-col">
                      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 sticky top-0 bg-white dark:bg-gray-900 sm:border sm:border-b-0 sm:border-gray-200 dark:sm:border-gray-700 sm:rounded-t-lg pt-3 pb-2 px-3 sm:px-4 z-10">
                        {headerText}
                      </h2>
                      <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-b-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700 ">
                        {sortedGroupEvents.map((event) => (
                          <EventCard
                            key={event.id}
                            event={{
                              ...event,
                              sourceId: event.sourceId,
                              location: event.location ?? null,
                              organizer: event.organizer ?? null,
                              price: event.price ?? null,
                              imageUrl: event.imageUrl ?? null,
                              timeUnknown: event.timeUnknown ?? false,
                              recurringType: event.recurringType ?? null,
                            }}
                            onHide={handleHideEvent}
                            onBlockHost={handleBlockHost}
                            onSignalCapture={handleSignalCapture}
                            isNewlyHidden={false}
                            hideBorder
                            isFavorited={favoritedEventIds.includes(event.id)}
                            favoriteCount={event.favoriteCount ?? 0}
                            onToggleFavorite={handleToggleFavorite}
                            isTagFilterActive={false}
                            isCurated={curatedEventIds.has(event.id)}
                            onCurate={handleOpenCurateModal}
                            onUncurate={handleUncurate}
                            isLoggedIn={isLoggedIn}
                            displayMode="full"
                            eventScore={event.score}
                            isMobileExpanded={mobileExpandedIds.has(event.id)}
                            onMobileExpand={(id) =>
                              setMobileExpandedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(id)) {
                                  next.delete(id);
                                } else {
                                  next.add(id);
                                }
                                return next;
                              })
                            }
                            onOpenModal={handleOpenEventModal}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* View All Events CTA */}
          <div className="flex justify-center mt-8 mb-4">
            <Link
              href="/events"
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-full transition-colors shadow-md hover:shadow-lg"
            >
              View All Asheville Events
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </>
      )}

      {/* All Events Feed */}
      {activeTab === 'all' && (
        <>
          <div
            className={`flex flex-col gap-10 mt-3 transition-opacity duration-150 ${
              isFilterPending ? 'opacity-50' : 'opacity-100'
            }`}
          >
            {Object.entries(
              filteredEvents.reduce(
                (groups, event) => {
                  const date = new Date(event.startDate);
                  const dateKey = date.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });

                  if (!groups[dateKey]) {
                    groups[dateKey] = { date: date, events: [] };
                  }
                  groups[dateKey].events.push(event);
                  return groups;
                },
                {} as Record<string, { date: Date; events: Event[] }>
              )
            )
              .sort(([, a], [, b]) => a.date.getTime() - b.date.getTime())
              .map(([dateKey, { date, events: groupEvents }]) => {
                const today = new Date();
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);

                let headerText = dateKey;
                const isTodayGroup = date.toDateString() === today.toDateString();
                if (isTodayGroup) {
                  headerText = `Today, ${date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}`;
                } else if (date.toDateString() === tomorrow.toDateString()) {
                  headerText = `Tomorrow, ${date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}`;
                }

                // Sort events by start time for display
                const sortedGroupEvents = [...groupEvents].sort(
                  (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
                );

                // Per-day score tier filtering: Top Events (default) vs All Events
                const showAllForDay = expandedDateGroups.has(dateKey);
                const scoreTierFilteredEvents =
                  showDayToggle && !showAllForDay
                    ? sortedGroupEvents.filter((event) => {
                        const tier = getEventScoreTier(event.score);
                        return tier === 'quality' || tier === 'outstanding';
                      })
                    : sortedGroupEvents;

                const displayEvents = scoreTierFilteredEvents;

                // Skip rendering this date group if no events match the filter
                if (displayEvents.length === 0) {
                  return null;
                }

                return (
                  <div key={dateKey} className="flex flex-col">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 sticky top-0 bg-white dark:bg-gray-900 sm:border sm:border-b-0 sm:border-gray-200 dark:sm:border-gray-700 sm:rounded-t-lg pt-3 pb-2 px-3 sm:px-4 z-10 flex items-center justify-between">
                      <span>{headerText}</span>
                      {showDayToggle && (
                        <div className="flex items-center gap-1 text-sm font-normal">
                          <button
                            onClick={() => {
                              if (showAllForDay) {
                                setExpandedDateGroups((prev) => {
                                  const next = new Set(prev);
                                  next.delete(dateKey);
                                  return next;
                                });
                              }
                            }}
                            className={`transition-colors cursor-pointer ${
                              !showAllForDay
                                ? 'text-brand-600 dark:text-brand-400'
                                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400'
                            }`}
                          >
                            Top Events
                          </button>
                          <span className="text-gray-300 dark:text-gray-600">|</span>
                          <button
                            onClick={() => {
                              if (!showAllForDay) {
                                setExpandedDateGroups((prev) => {
                                  const next = new Set(prev);
                                  next.add(dateKey);
                                  return next;
                                });
                              }
                            }}
                            className={`transition-colors cursor-pointer ${
                              showAllForDay
                                ? 'text-brand-600 dark:text-brand-400'
                                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400'
                            }`}
                          >
                            All Events
                          </button>
                        </div>
                      )}
                    </h2>
                    <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-b-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700 ">
                      {displayEvents.map((event) => {
                        const eventKey = createFingerprintKey(event.title, event.organizer);
                        const isNewlyHidden = sessionHiddenKeys.has(eventKey);

                        // Determine display mode based on score tier
                        // Common and Quality tiers are minimized by default, Outstanding is full
                        const tier = getEventScoreTier(event.score);
                        const isMinimized =
                          (tier === 'quality' || tier === 'hidden') &&
                          !expandedMinimizedIds.has(event.id);

                        return (
                          <EventCard
                            key={event.id}
                            event={{
                              ...event,
                              sourceId: event.sourceId,
                              location: event.location ?? null,
                              organizer: event.organizer ?? null,
                              price: event.price ?? null,
                              imageUrl: event.imageUrl ?? null,
                              timeUnknown: event.timeUnknown ?? false,
                              recurringType: event.recurringType ?? null,
                            }}
                            onHide={handleHideEvent}
                            onBlockHost={handleBlockHost}
                            onSignalCapture={handleSignalCapture}
                            isNewlyHidden={isNewlyHidden}
                            hideBorder
                            isFavorited={favoritedEventIds.includes(event.id)}
                            favoriteCount={event.favoriteCount ?? 0}
                            onToggleFavorite={handleToggleFavorite}
                            isTagFilterActive={tagFilters.include.length > 0}
                            isCurated={curatedEventIds.has(event.id)}
                            onCurate={handleOpenCurateModal}
                            onUncurate={handleUncurate}
                            isLoggedIn={isLoggedIn}
                            displayMode={isMinimized ? 'minimized' : 'full'}
                            onExpandMinimized={(id) =>
                              setExpandedMinimizedIds((prev) => new Set([...prev, id]))
                            }
                            onCollapseDesktop={(id) =>
                              setExpandedMinimizedIds((prev) => {
                                const next = new Set(prev);
                                next.delete(id);
                                return next;
                              })
                            }
                            scoreTier={tier}
                            eventScore={event.score}
                            isMobileExpanded={mobileExpandedIds.has(event.id)}
                            onMobileExpand={(id) =>
                              setMobileExpandedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(id)) {
                                  next.delete(id);
                                } else {
                                  next.add(id);
                                }
                                return next;
                              })
                            }
                            onOpenModal={handleOpenEventModal}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>

          {filteredEvents.length === 0 && !isFetching && (
            <div className="text-center py-20 text-gray-500 dark:text-gray-400">
              No events found matching your criteria.
            </div>
          )}

          {/* Infinite scroll trigger + Show more button */}
          {hasMore && (
            <div ref={loadMoreRef} className="py-8 flex flex-col items-center justify-center gap-4">
              {isFetchingNextPage ? (
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                  <Loader2Icon size={20} className="animate-spin" />
                  <span className="text-sm">Loading more events...</span>
                </div>
              ) : (
                <button
                  onClick={() => void fetchNextPage()}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <ArrowDownIcon size={18} />
                  Show More Events
                </button>
              )}
            </div>
          )}
        </>
      )}

      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        // Date filters
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        customDateRange={customDateRange}
        onCustomDateRangeChange={setCustomDateRange}
        selectedDays={selectedDays}
        onSelectedDaysChange={setSelectedDays}
        selectedTimes={selectedTimes}
        onSelectedTimesChange={setSelectedTimes}
        // Price filters
        priceFilter={priceFilter}
        onPriceFilterChange={setPriceFilter}
        customMaxPrice={customMaxPrice}
        onCustomMaxPriceChange={setCustomMaxPrice}
        // Location filters
        selectedLocations={selectedLocations}
        onLocationsChange={setSelectedLocations}
        availableLocations={availableLocations}
        selectedZips={selectedZips}
        onZipsChange={setSelectedZips}
        availableZips={availableZips}
        // Tag filters
        availableTags={availableTags}
        tagFilters={tagFilters}
        onTagFiltersChange={setTagFilters}
        showDailyEvents={showDailyEvents}
        onShowDailyEventsChange={setShowDailyEvents}
        // Keyword filters (from SettingsModal)
        blockedHosts={blockedHosts}
        blockedKeywords={blockedKeywords}
        hiddenEvents={hiddenEvents}
        onUpdateHosts={setBlockedHosts}
        onUpdateKeywords={setBlockedKeywords}
        onUpdateHiddenEvents={setHiddenEvents}
        defaultFilterKeywords={DEFAULT_BLOCKED_KEYWORDS}
      />

      <AIChatModal
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        totalCount={totalCount}
        activeFilters={{
          search,
          priceFilter,
          tagsInclude: tagFilters.include,
          tagsExclude: tagFilters.exclude,
          selectedLocations,
        }}
      />

      <CurateModal
        isOpen={curateModalOpen}
        onClose={() => {
          setCurateModalOpen(false);
          setCurateModalEventId(null);
        }}
        onConfirm={handleCurate}
        eventTitle={curateModalEventTitle}
      />

      {selectedEventForModal && (
        <EventDetailModal
          isOpen={eventModalOpen}
          onClose={handleCloseEventModal}
          event={selectedEventForModal}
          isFavorited={favoritedEventIds.includes(selectedEventForModal.id)}
          favoriteCount={selectedEventForModal.favoriteCount ?? 0}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      <SaveFeedModal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} />

      {/* Scroll to top button */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 transition-all duration-300 z-50 ${
          showScrollTop
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        <button
          onClick={scrollToTop}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg hover:shadow-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all cursor-pointer"
          aria-label="Scroll to top"
        >
          <ArrowUpIcon size={16} className="text-gray-600 dark:text-gray-300" />
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            Scroll to top
          </span>
        </button>
      </div>
    </div>
  );
}
