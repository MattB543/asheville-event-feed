"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import EventCard from "./EventCard";
import FilterBar, {
  DateFilterType,
  PriceFilterType,
  DateRange,
  TimeOfDay,
} from "./FilterBar";
import ActiveFilters, { ActiveFilter } from "./ActiveFilters";
import { parse, isValid } from "date-fns";
import dynamic from "next/dynamic";
import { EventFeedSkeleton } from "./EventCardSkeleton";
import {
  useEventQuery,
  useInfiniteScrollTrigger,
  type Event as ApiEvent,
  type EventMetadata,
} from "@/lib/hooks/useEventQuery";

// Lazy load modals to reduce initial JS bundle - they're only needed when opened
const SettingsModal = dynamic(() => import("./SettingsModal"), { ssr: false });
const AIChatModal = dynamic(() => import("./AIChatModal"), { ssr: false });
const CurateModal = dynamic(() => import("./CurateModal"), { ssr: false });
// SaveFeedModal is not lazy loaded to avoid delay when showSavePrompt is in URL
import SaveFeedModal from "./SaveFeedModal";
import { DEFAULT_BLOCKED_KEYWORDS } from "@/lib/config/defaultFilters";
import { useToast } from "./ui/Toast";
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, Sparkles } from "lucide-react";
import { getZipName } from "@/lib/config/zipNames";
import { usePreferenceSync } from "@/lib/hooks/usePreferenceSync";
import { useAuth } from "./AuthProvider";

// Use the Event type from API, but with Date for startDate (parsed client-side)
type Event = Omit<ApiEvent, "startDate"> & { startDate: Date };

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

interface EventFeedProps {
  initialEvents?: InitialEvent[];
  initialTotalCount?: number;
  initialMetadata?: EventMetadata;
  activeTab?: "all" | "forYou";
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
function createFingerprintKey(
  title: string,
  organizer: string | null | undefined
): string {
  const normalizedTitle = title.toLowerCase().trim();
  const normalizedOrganizer = (organizer || "").toLowerCase().trim();
  return `${normalizedTitle}|||${normalizedOrganizer}`;
}

// Score tier for filtering events by quality
export type ScoreTier = "hidden" | "quality" | "outstanding";

// Get the score tier for an event based on its score
function getEventScoreTier(score: number | null | undefined): ScoreTier {
  if (score === null || score === undefined) return "quality"; // null treated as quality
  if (score <= 12) return "hidden"; // Common: 0-12
  if (score <= 16) return "quality"; // Quality: 13-16
  return "outstanding"; // Outstanding: 17+
}

function getStorageItem<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

// Check if localStorage contains non-default filters that would affect query results
// This runs synchronously at initialization to detect if we should skip SSR data
function hasNonDefaultLocalStorageFilters(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const dateFilter = getStorageItem("dateFilter", "all");
    const priceFilter = getStorageItem("priceFilter", "any");
    const tagFilters = getStorageItem<{
      include: string[];
      exclude: string[];
    } | null>("tagFilters", null);
    const selectedTags = getStorageItem<string[]>("selectedTags", []); // old format
    const selectedLocations = getStorageItem<string[]>("selectedLocations", []);
    const selectedZips = getStorageItem<string[]>("selectedZips", []);
    const selectedTimes = getStorageItem<TimeOfDay[]>("selectedTimes", []);
    const selectedDays = getStorageItem<number[]>("selectedDays", []);
    const customDateRange = getStorageItem<{
      start: string | null;
      end: string | null;
    }>("customDateRange", { start: null, end: null });
    const search = getStorageItem<string>("search", "");

    return (
      dateFilter !== "all" ||
      priceFilter !== "any" ||
      (tagFilters?.include?.length ?? 0) > 0 ||
      (tagFilters?.exclude?.length ?? 0) > 0 ||
      selectedTags.length > 0 ||
      selectedLocations.length > 0 ||
      selectedZips.length > 0 ||
      selectedTimes.length > 0 ||
      selectedDays.length > 0 ||
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
  if (typeof window === "undefined") {
    return { filters: {}, hasFilters: false };
  }

  const params = new URLSearchParams(window.location.search);

  // Check if any filter params exist
  const hasFilters =
    params.has("search") ||
    params.has("dateFilter") ||
    params.has("times") ||
    params.has("priceFilter") ||
    params.has("tagsInclude") ||
    params.has("tagsExclude") ||
    params.has("locations") ||
    params.has("dateStart");

  if (!hasFilters) {
    return { filters: {}, hasFilters: false };
  }

  console.log(
    "[EventFeed] URL filters detected, parsing params:",
    Object.fromEntries(params.entries())
  );

  const filters: UrlFilters = {};

  // Search
  if (params.has("search")) {
    filters.search = params.get("search") || "";
  }

  // Date filter
  if (params.has("dateFilter")) {
    const df = params.get("dateFilter") as DateFilterType;
    if (
      ["all", "today", "tomorrow", "weekend", "dayOfWeek", "custom"].includes(
        df
      )
    ) {
      filters.dateFilter = df;
    }
  }

  // Days
  if (params.has("days")) {
    const days =
      params
        .get("days")
        ?.split(",")
        .map(Number)
        .filter((n) => !isNaN(n) && n >= 0 && n <= 6) || [];
    filters.selectedDays = days;
  }

  // Times
  if (params.has("times")) {
    const validTimes = ["morning", "afternoon", "evening"] as const;
    const times =
      params
        .get("times")
        ?.split(",")
        .filter((t): t is TimeOfDay => validTimes.includes(t as TimeOfDay)) ||
      [];
    filters.selectedTimes = times;
  }

  // Custom date range
  if (params.has("dateStart")) {
    filters.customDateRange = {
      start: params.get("dateStart"),
      end: params.get("dateEnd"),
    };
    // If dateStart is present but dateFilter isn't explicitly set, assume custom
    if (!filters.dateFilter) {
      filters.dateFilter = "custom";
    }
  }

  // Price filter
  if (params.has("priceFilter")) {
    const pf = params.get("priceFilter") as PriceFilterType;
    if (["any", "free", "under20", "under100", "custom"].includes(pf)) {
      filters.priceFilter = pf;
    }
  }

  // Custom max price
  if (params.has("maxPrice")) {
    const mp = parseInt(params.get("maxPrice") || "", 10);
    if (!isNaN(mp) && mp >= 0) {
      filters.customMaxPrice = mp;
    }
  }

  // Tags include/exclude
  if (params.has("tagsInclude")) {
    filters.tagsInclude =
      params.get("tagsInclude")?.split(",").filter(Boolean) || [];
  }
  if (params.has("tagsExclude")) {
    filters.tagsExclude =
      params.get("tagsExclude")?.split(",").filter(Boolean) || [];
  }

  // Locations
  if (params.has("locations")) {
    filters.selectedLocations =
      params.get("locations")?.split(",").filter(Boolean) || [];
  }

  console.log("[EventFeed] Parsed URL filters:", filters);

  return { filters, hasFilters: true };
}

// Safe date parsing helper that returns undefined on invalid dates
// This parses yyyy-MM-dd strings as LOCAL dates (not UTC)
function safeParseDateString(dateStr: string | null): Date | undefined {
  if (!dateStr) return undefined;
  try {
    const parsed = parse(dateStr, "yyyy-MM-dd", new Date());
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dateLabels: Record<DateFilterType, string> = {
  all: "All Dates",
  today: "Today",
  tomorrow: "Tomorrow",
  weekend: "This Weekend",
  dayOfWeek: "Day of Week",
  custom: "Custom Dates",
};

const priceLabels: Record<PriceFilterType, string> = {
  any: "Any Price",
  free: "Free",
  under20: "Under $20",
  under100: "Under $100",
  custom: "Custom Max",
};

export default function EventFeed({
  initialEvents,
  initialTotalCount,
  initialMetadata,
  activeTab = "all",
}: EventFeedProps) {
  const { showToast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const isLoggedIn = !!user;

  // For You feed state
  const [forYouEvents, setForYouEvents] = useState<any[]>([]);
  const [forYouMeta, setForYouMeta] = useState<{ signalCount: number; minimumMet: boolean } | null>(null);
  const [forYouLoading, setForYouLoading] = useState(false);
  // Track events being hidden (for animation)
  const [hidingEventIds, setHidingEventIds] = useState<Set<string>>(new Set());

  // Parse URL filters once at initialization (not in useEffect)
  // This ensures filters are correct from the first render
  const [urlFilterState] = useState(() => getInitialFiltersFromUrl());
  const urlFilters = urlFilterState.filters;
  const hasUrlFilters = urlFilterState.hasFilters;

  // Check if localStorage has non-default filters at initialization
  // This runs synchronously before useEventQuery decides to use SSR data
  const [hasLocalStorageFilters] = useState(() =>
    hasNonDefaultLocalStorageFilters()
  );

  // Track which events the user has favorited (persisted to localStorage)
  const [favoritedEventIds, setFavoritedEventIds] = useState<string[]>(() =>
    getStorageItem("favoritedEventIds", [])
  );

  const [curatedEventIds, setCuratedEventIds] = useState<Set<string>>(
    new Set()
  );
  const [curateModalOpen, setCurateModalOpen] = useState(false);
  const [curateModalEventId, setCurateModalEventId] = useState<string | null>(
    null
  );
  const [curateModalEventTitle, setCurateModalEventTitle] = useState("");

  // Search (committed value only - FilterBar handles local input state)
  // URL params take priority over localStorage
  const [search, setSearch] = useState(() => urlFilters.search ?? "");

  // Filters - URL params take priority over localStorage for shared links
  const [dateFilter, setDateFilter] = useState<DateFilterType>(
    () => urlFilters.dateFilter ?? getStorageItem("dateFilter", "all")
  );
  const [customDateRange, setCustomDateRange] = useState<DateRange>(
    () =>
      urlFilters.customDateRange ??
      getStorageItem("customDateRange", { start: null, end: null })
  );
  const [selectedDays, setSelectedDays] = useState<number[]>(
    () => urlFilters.selectedDays ?? getStorageItem("selectedDays", [])
  );
  const [selectedTimes, setSelectedTimes] = useState<TimeOfDay[]>(
    () => urlFilters.selectedTimes ?? getStorageItem("selectedTimes", [])
  );
  const [priceFilter, setPriceFilter] = useState<PriceFilterType>(
    () => urlFilters.priceFilter ?? getStorageItem("priceFilter", "any")
  );
  const [customMaxPrice, setCustomMaxPrice] = useState<number | null>(() =>
    urlFilters.customMaxPrice !== undefined
      ? urlFilters.customMaxPrice
      : getStorageItem("customMaxPrice", null)
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
    const newFormat = getStorageItem<TagFilterState | null>("tagFilters", null);
    if (newFormat && (newFormat.include || newFormat.exclude)) return newFormat;

    // Migrate from old format
    const oldSelectedTags = getStorageItem<string[]>("selectedTags", []);
    return { include: oldSelectedTags, exclude: [] };
  });
  const [selectedLocations, setSelectedLocations] = useState<string[]>(
    () =>
      urlFilters.selectedLocations ?? getStorageItem("selectedLocations", [])
  );
  const [selectedZips, setSelectedZips] = useState<string[]>(() =>
    getStorageItem("selectedZips", [])
  );
  // Daily events filter - default to showing daily events
  const [showDailyEvents, setShowDailyEvents] = useState<boolean>(() =>
    getStorageItem("showDailyEvents", true)
  );

  // Track which date groups show all events (session only)
  const [expandedDateGroups, setExpandedDateGroups] = useState<Set<string>>(
    new Set()
  );

  // Track expanded minimized events (session only - resets on page reload)
  const [expandedMinimizedIds, setExpandedMinimizedIds] = useState<Set<string>>(
    new Set()
  );

  // Settings & Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [blockedHosts, setBlockedHosts] = useState<string[]>(() =>
    getStorageItem("blockedHosts", [])
  );
  const [blockedKeywords, setBlockedKeywords] = useState<string[]>(() =>
    getStorageItem("blockedKeywords", [])
  );
  const [hiddenEvents, setHiddenEvents] = useState<HiddenEventFingerprint[]>(
    () => getStorageItem("hiddenEvents", [])
  );
  // Track events hidden THIS session (not persisted) - these show greyed out instead of being filtered
  const [sessionHiddenKeys, setSessionHiddenKeys] = useState<Set<string>>(
    new Set()
  );
  const [showAllPreviousEvents, setShowAllPreviousEvents] = useState(false);
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
        startDate:
          typeof e.startDate === "string"
            ? e.startDate
            : e.startDate.toISOString(),
        createdAt: e.createdAt
          ? typeof e.createdAt === "string"
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
        console.log(
          "[EventFeed] Fetching fresh data (URL filters present, skipped SSR data)"
        );
      } else if (hasLocalStorageFilters) {
        console.log(
          "[EventFeed] Fetching fresh data (localStorage filters present, skipped SSR data)"
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
        fetchNextPage();
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

  // Whether we should show the per-day toggle (hide during search/tags)
  const showDayToggle = useMemo(() => {
    const hasActiveSearch = search.trim().length > 0;
    const hasIncludedTags = tagFilters.include.length > 0;
    return !hasActiveSearch && !hasIncludedTags;
  }, [search, tagFilters.include]);

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

  // Fetch For You feed when tab switches to forYou
  useEffect(() => {
    console.log("[ForYou] useEffect triggered:", { isLoaded, activeTab, isLoggedIn, authLoading });

    if (!isLoaded || activeTab !== "forYou" || !isLoggedIn) {
      console.log("[ForYou] Early return - conditions not met:", { isLoaded, activeTab, isLoggedIn });
      return;
    }

    const fetchForYou = async () => {
      console.log("[ForYou] Starting fetch...");
      setForYouLoading(true);
      try {
        const response = await fetch("/api/for-you");
        console.log("[ForYou] Response status:", response.status);
        if (!response.ok) {
          throw new Error("Failed to fetch personalized feed");
        }
        const data = await response.json();
        console.log("[ForYou] Data received:", { eventCount: data.events?.length, meta: data.meta });
        setForYouEvents(data.events || []);
        setForYouMeta(data.meta || { signalCount: 0, minimumMet: false });
      } catch (error) {
        console.error("[ForYou] Error fetching:", error);
        showToast("Failed to load personalized feed", "error");
      } finally {
        console.log("[ForYou] Fetch complete, setting loading to false");
        setForYouLoading(false);
      }
    };

    fetchForYou();
  }, [activeTab, isLoaded, isLoggedIn, authLoading, showToast]);

  // Fetch curations on mount for logged-in users
  useEffect(() => {
    if (isLoggedIn) {
      fetch("/api/curate")
        .then((res) => res.json())
        .then((data) => {
          if (data.curations) {
            const ids = new Set<string>(
              data.curations.map((c: { eventId: string }) => c.eventId)
            );
            setCuratedEventIds(ids);
          }
        })
        .catch(console.error);
    }
  }, [isLoggedIn]);

  // Track scroll position for scroll-to-top button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Save filter settings to localStorage
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("search", JSON.stringify(search));
      localStorage.setItem("dateFilter", JSON.stringify(dateFilter));
      localStorage.setItem("customDateRange", JSON.stringify(customDateRange));
      localStorage.setItem("selectedDays", JSON.stringify(selectedDays));
      localStorage.setItem("selectedTimes", JSON.stringify(selectedTimes));
      localStorage.setItem("priceFilter", JSON.stringify(priceFilter));
      localStorage.setItem("customMaxPrice", JSON.stringify(customMaxPrice));
      localStorage.setItem("tagFilters", JSON.stringify(tagFilters));
      localStorage.setItem(
        "selectedLocations",
        JSON.stringify(selectedLocations)
      );
      localStorage.setItem("selectedZips", JSON.stringify(selectedZips));
      localStorage.setItem("blockedHosts", JSON.stringify(blockedHosts));
      localStorage.setItem("blockedKeywords", JSON.stringify(blockedKeywords));
      localStorage.setItem("hiddenEvents", JSON.stringify(hiddenEvents));
      localStorage.setItem("showDailyEvents", JSON.stringify(showDailyEvents));
      localStorage.setItem(
        "favoritedEventIds",
        JSON.stringify(favoritedEventIds)
      );
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
    if (params.has("showSavePrompt")) {
      // Only show once per session
      const hasShownSavePrompt = sessionStorage.getItem("hasShownSavePrompt");
      if (!hasShownSavePrompt) {
        setShowSaveModal(true);
        sessionStorage.setItem("hasShownSavePrompt", "true");
      }
      // Remove the param from URL without triggering a reload
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("showSavePrompt");
      window.history.replaceState({}, "", newUrl.toString());
    }
  }, [isLoaded]); // Only run once after hydration

  // Use pre-computed metadata from server (API returns this with first page)
  const availableTags = metadata?.availableTags || [];
  const availableLocations = metadata?.availableLocations || [];
  const availableZips = metadata?.availableZips || [];

  // Build active filters list for display
  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];

    if (search) {
      filters.push({ id: "search", type: "search", label: `"${search}"` });
    }
    if (dateFilter !== "all") {
      let label = dateLabels[dateFilter];
      if (dateFilter === "dayOfWeek" && selectedDays.length > 0) {
        label = selectedDays.map((d) => DAY_NAMES[d]).join(", ");
      } else if (dateFilter === "custom" && customDateRange.start) {
        const startDate = safeParseDateString(customDateRange.start);
        const endDate = safeParseDateString(customDateRange.end);
        if (endDate && customDateRange.end !== customDateRange.start) {
          label = `${startDate!.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })} - ${endDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}`;
        } else if (startDate) {
          label = startDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
        }
      }
      filters.push({ id: "date", type: "date", label });
    }
    if (selectedTimes.length > 0) {
      const timeLabels: Record<TimeOfDay, string> = {
        morning: "Morning",
        afternoon: "Afternoon",
        evening: "Evening",
      };
      const label = selectedTimes.map((t) => timeLabels[t]).join(", ");
      filters.push({ id: "time", type: "time", label });
    }
    if (priceFilter !== "any") {
      let label = priceLabels[priceFilter];
      if (priceFilter === "custom" && customMaxPrice !== null) {
        label = `Under $${customMaxPrice}`;
      }
      filters.push({ id: "price", type: "price", label });
    }
    tagFilters.include.forEach((tag) => {
      filters.push({
        id: `tag-include-${tag}`,
        type: "tag-include",
        label: tag,
      });
    });
    tagFilters.exclude.forEach((tag) => {
      filters.push({
        id: `tag-exclude-${tag}`,
        type: "tag-exclude",
        label: tag,
      });
    });
    selectedLocations.forEach((loc) => {
      let label = loc;
      if (loc === "asheville") label = "Asheville area";
      filters.push({ id: `location-${loc}`, type: "location", label });
    });
    selectedZips.forEach((zip) => {
      const name = getZipName(zip);
      filters.push({
        id: `zip-${zip}`,
        type: "zip",
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
  ]);

  // Handle removing filters
  const handleRemoveFilter = useCallback((id: string) => {
    if (id === "search") {
      setSearch("");
    } else if (id === "date") {
      setDateFilter("all");
      setCustomDateRange({ start: null, end: null });
      setSelectedDays([]);
    } else if (id === "time") {
      setSelectedTimes([]);
    } else if (id === "price") {
      setPriceFilter("any");
      setCustomMaxPrice(null);
    } else if (id.startsWith("location-")) {
      const loc = id.replace("location-", "");
      setSelectedLocations((prev) => prev.filter((l) => l !== loc));
    } else if (id.startsWith("zip-")) {
      const zip = id.replace("zip-", "");
      setSelectedZips((prev) => prev.filter((z) => z !== zip));
    } else if (id.startsWith("tag-include-")) {
      const tag = id.replace("tag-include-", "");
      setTagFilters((prev) => ({
        ...prev,
        include: prev.include.filter((t) => t !== tag),
      }));
    } else if (id.startsWith("tag-exclude-")) {
      const tag = id.replace("tag-exclude-", "");
      setTagFilters((prev) => ({
        ...prev,
        exclude: prev.exclude.filter((t) => t !== tag),
      }));
    }
  }, []);

  // Clear all filters
  const handleClearAllFilters = useCallback(() => {
    setSearch("");
    setDateFilter("all");
    setCustomDateRange({ start: null, end: null });
    setSelectedDays([]);
    setSelectedTimes([]);
    setPriceFilter("any");
    setCustomMaxPrice(null);
    setTagFilters({ include: [], exclude: [] });
    setSelectedLocations([]);
    setSelectedZips([]);
  }, []);

  // Helper to capture signal
  const captureSignal = useCallback(
    async (eventId: string, signalType: 'favorite' | 'calendar' | 'share' | 'viewSource' | 'hide'): Promise<boolean> => {
      console.log("[Signal] captureSignal called:", { eventId, signalType, isLoggedIn, authLoading, userId: user?.id });

      // If auth is still loading, wait a moment
      if (authLoading) {
        console.log("[Signal] Auth still loading, waiting 500ms...");
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log("[Signal] Done waiting, isLoggedIn now:", isLoggedIn);
      }

      if (!isLoggedIn) {
        console.log("[Signal] Skipped - user not logged in (authLoading:", authLoading, ")");
        return false;
      }

      console.log("[Signal] Making API call to /api/signals...");
      try {
        const response = await fetch("/api/signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, signalType }),
        });

        console.log("[Signal] API response status:", response.status);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error("[Signal] API error:", response.status, errorData);
          return false;
        }

        const data = await response.json();
        console.log("[Signal] Captured successfully:", signalType, eventId, data);
        return true;
      } catch (error) {
        console.error("[Signal] Network error:", error);
        return false;
      }
    },
    [isLoggedIn, authLoading, user?.id]
  );

  // Handler for capturing calendar/share/viewSource signals
  const handleSignalCapture = useCallback(
    (eventId: string, signalType: 'calendar' | 'share' | 'viewSource') => {
      captureSignal(eventId, signalType);
    },
    [captureSignal]
  );

  // Hide event (by title + organizer fingerprint)
  const handleHideEvent = useCallback(
    (title: string, organizer: string | null, eventId?: string) => {
      const fingerprint: HiddenEventFingerprint = {
        title: title.toLowerCase().trim(),
        organizer: (organizer || "").toLowerCase().trim(),
      };
      const key = createFingerprintKey(title, organizer);

      // Capture hide signal if eventId provided
      if (eventId) {
        captureSignal(eventId, "hide");
      }

      // If on For You tab and eventId provided, add animation
      if (activeTab === "forYou" && eventId) {
        setHidingEventIds((prev) => new Set([...prev, eventId]));
        // Remove from For You feed after animation (300ms)
        setTimeout(() => {
          setForYouEvents((prev) =>
            prev.filter((e: any) => e.event.id !== eventId)
          );
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
          (fp) =>
            fp.title === fingerprint.title &&
            fp.organizer === fingerprint.organizer
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
  const handleToggleFavorite = useCallback(
    async (eventId: string) => {
      const isFavorited = favoritedEventIds.includes(eventId);
      const action = isFavorited ? "remove" : "add";

      console.log("[Favorite] Toggle:", eventId, "action:", action, "isLoggedIn:", isLoggedIn);

      // Optimistically update local state
      setFavoritedEventIds((prev) =>
        isFavorited ? prev.filter((id) => id !== eventId) : [...prev, eventId]
      );

      try {
        const response = await fetch(`/api/events/${eventId}/favorite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });

        if (!response.ok) {
          throw new Error("Failed to update favorite");
        }

        // Capture signal for favorites (only when adding, not removing)
        if (!isFavorited) {
          // Await to ensure signal is captured before function returns
          await captureSignal(eventId, "favorite");
        } else {
          console.log("[Favorite] Unfavorite - no signal captured (expected)");
        }
      } catch (error) {
        // Revert optimistic update on error
        setFavoritedEventIds((prev) =>
          isFavorited ? [...prev, eventId] : prev.filter((id) => id !== eventId)
        );
        console.error("[Favorite] Failed to toggle:", error);
      }
    },
    [favoritedEventIds, captureSignal, isLoggedIn]
  );

  const handleOpenCurateModal = (eventId: string) => {
    const event = filteredEvents.find((e) => e.id === eventId);
    if (event) {
      setCurateModalEventId(eventId);
      setCurateModalEventTitle(event.title);
      setCurateModalOpen(true);
    }
  };

  const handleCurate = async (note?: string) => {
    if (!curateModalEventId) return;

    // Optimistic update
    setCuratedEventIds((prev) => new Set([...prev, curateModalEventId]));

    try {
      const res = await fetch("/api/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: curateModalEventId,
          action: "add",
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
  };

  const handleUncurate = async (eventId: string) => {
    // Optimistic update
    setCuratedEventIds((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });

    try {
      const res = await fetch("/api/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action: "remove" }),
      });

      if (!res.ok) {
        // Revert on error
        setCuratedEventIds((prev) => new Set([...prev, eventId]));
      }
    } catch {
      // Revert on error
      setCuratedEventIds((prev) => new Set([...prev, eventId]));
    }
  };

  // Build export URL with current filters (includes personal filters for XML/Markdown export)
  const exportParams = useMemo(() => {
    const params = new URLSearchParams();

    if (search) params.set("search", search);
    if (dateFilter !== "all") params.set("dateFilter", dateFilter);
    if (dateFilter === "dayOfWeek" && selectedDays.length > 0) {
      params.set("days", selectedDays.join(","));
    }
    if (selectedTimes.length > 0) {
      params.set("times", selectedTimes.join(","));
    }
    if (dateFilter === "custom" && customDateRange.start) {
      params.set("dateStart", customDateRange.start);
      if (customDateRange.end) params.set("dateEnd", customDateRange.end);
    }
    if (priceFilter !== "any") params.set("priceFilter", priceFilter);
    if (priceFilter === "custom" && customMaxPrice !== null) {
      params.set("maxPrice", customMaxPrice.toString());
    }
    if (tagFilters.include.length > 0)
      params.set("tagsInclude", tagFilters.include.join(","));
    if (tagFilters.exclude.length > 0)
      params.set("tagsExclude", tagFilters.exclude.join(","));

    // Client-side filters that need to be passed to export
    if (blockedHosts.length > 0)
      params.set("blockedHosts", blockedHosts.join(","));
    if (blockedKeywords.length > 0)
      params.set("blockedKeywords", blockedKeywords.join(","));
    if (hiddenEvents.length > 0)
      params.set("hiddenEvents", JSON.stringify(hiddenEvents));
    if (selectedLocations.length > 0)
      params.set("locations", selectedLocations.join(","));

    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
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
  ]);

  // Build shareable URL with only public filters (excludes personal blockedHosts/blockedKeywords/hiddenEvents)
  const shareParams = useMemo(() => {
    const params = new URLSearchParams();

    if (search) params.set("search", search);
    if (dateFilter !== "all") params.set("dateFilter", dateFilter);
    if (dateFilter === "dayOfWeek" && selectedDays.length > 0) {
      params.set("days", selectedDays.join(","));
    }
    if (selectedTimes.length > 0) {
      params.set("times", selectedTimes.join(","));
    }
    if (dateFilter === "custom" && customDateRange.start) {
      params.set("dateStart", customDateRange.start);
      if (customDateRange.end) params.set("dateEnd", customDateRange.end);
    }
    if (priceFilter !== "any") params.set("priceFilter", priceFilter);
    if (priceFilter === "custom" && customMaxPrice !== null) {
      params.set("maxPrice", customMaxPrice.toString());
    }
    if (tagFilters.include.length > 0)
      params.set("tagsInclude", tagFilters.include.join(","));
    if (tagFilters.exclude.length > 0)
      params.set("tagsExclude", tagFilters.exclude.join(","));
    if (selectedLocations.length > 0)
      params.set("locations", selectedLocations.join(","));

    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
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
  ]);

  // Sync URL with current filter state (enables sharing via address bar)
  useEffect(() => {
    if (!isLoaded) return;

    const newUrl = `${window.location.pathname}${shareParams}`;

    // Only update if URL actually changed
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [shareParams, isLoaded]);

  // SSR renders skeleton, client renders events after hydration (no artificial delay)
  // This keeps the page size small for Vercel's ISR limits
  if (!isLoaded) return <EventFeedSkeleton />;

  return (
    <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-4 sm:py-8">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        customDateRange={customDateRange}
        onCustomDateRangeChange={setCustomDateRange}
        selectedDays={selectedDays}
        onSelectedDaysChange={setSelectedDays}
        selectedTimes={selectedTimes}
        onSelectedTimesChange={setSelectedTimes}
        priceFilter={priceFilter}
        onPriceFilterChange={setPriceFilter}
        customMaxPrice={customMaxPrice}
        onCustomMaxPriceChange={setCustomMaxPrice}
        selectedLocations={selectedLocations}
        onLocationsChange={setSelectedLocations}
        availableLocations={availableLocations}
        selectedZips={selectedZips}
        onZipsChange={setSelectedZips}
        availableZips={availableZips}
        availableTags={availableTags}
        tagFilters={tagFilters}
        onTagFiltersChange={setTagFilters}
        showDailyEvents={showDailyEvents}
        onShowDailyEventsChange={setShowDailyEvents}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <ActiveFilters
        filters={activeFilters}
        onRemove={handleRemoveFilter}
        onClearAll={handleClearAllFilters}
        onClearAllTags={() => setTagFilters({ include: [], exclude: [] })}
        exportParams={exportParams}
        shareParams={shareParams}
        onOpenChat={() => setIsChatOpen(true)}
        isPending={isFilterPending}
        activeTab={activeTab}
      />

      {/* Filtering indicator */}
      {isFilterPending && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Filtering...
            </span>
          </div>
        </div>
      )}

      {/* For You Feed */}
      {activeTab === "forYou" && (
        <>
          {/* Sign-in Prompt for Anonymous Users */}
          {!isLoggedIn && (
            <div className="text-center py-20 px-4">
              <Sparkles size={48} className="mx-auto text-brand-500 mb-4" />
              <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
                Get personalized recommendations
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                Sign in to build a feed tailored to your interests. Like events you love, and we'll show you more like them.
              </p>
              <a
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors"
              >
                Sign in to get started
              </a>
            </div>
          )}

          {/* Onboarding Banner */}
          {isLoggedIn && forYouMeta && !forYouMeta.minimumMet && forYouMeta.signalCount > 0 && (
            <div className="mb-4 px-3 sm:px-0">
              <div className="bg-brand-50 dark:bg-brand-950/50 border border-brand-200 dark:border-brand-800 rounded-lg px-4 py-3 flex items-center gap-3">
                <Sparkles size={18} className="text-brand-600 dark:text-brand-400 shrink-0" />
                <p className="text-sm text-brand-700 dark:text-brand-300">
                  <strong>{forYouMeta.signalCount}/5 events liked</strong> — keep going to improve your recommendations!
                </p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {isLoggedIn && forYouMeta && forYouMeta.signalCount === 0 && forYouEvents.length === 0 && !forYouLoading && (
            <div className="text-center py-20 px-4">
              <Sparkles size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Build your personalized feed
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                Search and favorite events you're interested in to build your custom feed
              </p>
            </div>
          )}

          {/* Loading State */}
          {isLoggedIn && forYouLoading && (
            <div className="text-center py-20">
              <div className="inline-block w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading your personalized feed...
              </p>
            </div>
          )}

          {/* Time Bucket Sections */}
          {isLoggedIn && !forYouLoading && forYouEvents.length > 0 && (
            <div className="flex flex-col gap-10 mt-3">
              {['today', 'tomorrow', 'week', 'later'].map((bucket) => {
                const bucketEvents = forYouEvents.filter((e: any) => e.bucket === bucket);
                if (bucketEvents.length === 0) return null;

                const bucketLabels: Record<string, string> = {
                  today: "Today",
                  tomorrow: "Tomorrow",
                  week: "This Week",
                  later: "Later",
                };

                return (
                  <div key={bucket} className="flex flex-col">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 sticky top-0 sm:top-9 bg-white dark:bg-gray-900 sm:border sm:border-b-0 sm:border-gray-200 dark:sm:border-gray-700 sm:rounded-t-lg py-2 px-3 sm:px-4 z-10">
                      {bucketLabels[bucket]}
                    </h2>
                    <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-b-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700">
                      {bucketEvents.map((scoredEvent: any) => {
                        const event = {
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
                            hideBorder={false}
                            isFavorited={favoritedEventIds.includes(event.id)}
                            favoriteCount={event.favoriteCount ?? 0}
                            onToggleFavorite={handleToggleFavorite}
                            isTagFilterActive={false}
                            isCurated={curatedEventIds.has(event.id)}
                            onCurate={handleOpenCurateModal}
                            onUncurate={handleUncurate}
                            isLoggedIn={isLoggedIn}
                            displayMode="full"
                            matchTier={scoredEvent.tier}
                            matchExplanation={scoredEvent.explanation}
                            isHiding={hidingEventIds.has(event.id)}
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

      {/* All Events Feed */}
      {activeTab === "all" && (
        <>
          <div
            className={`flex flex-col gap-10 mt-3 transition-opacity duration-150 ${
              isFilterPending ? "opacity-50" : "opacity-100"
            }`}
          >
          {Object.entries(
            filteredEvents.reduce((groups, event) => {
            const date = new Date(event.startDate);
            const dateKey = date.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            if (!groups[dateKey]) {
              groups[dateKey] = { date: date, events: [] };
            }
            groups[dateKey].events.push(event);
            return groups;
          }, {} as Record<string, { date: Date; events: Event[] }>)
        )
          .sort(([, a], [, b]) => a.date.getTime() - b.date.getTime())
          .map(([dateKey, { date, events: groupEvents }]) => {
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const now = new Date();
            const twoAndHalfHoursAgo = new Date(
              now.getTime() - 2.5 * 60 * 60 * 1000
            );

            let headerText = dateKey;
            const isTodayGroup = date.toDateString() === today.toDateString();
            if (isTodayGroup) {
              headerText = `Today, ${date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}`;
            } else if (date.toDateString() === tomorrow.toDateString()) {
              headerText = `Tomorrow, ${date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}`;
            }

            // Sort events by start time for display
            const sortedGroupEvents = [...groupEvents].sort(
              (a, b) =>
                new Date(a.startDate).getTime() -
                new Date(b.startDate).getTime()
            );

            // Per-day score tier filtering: Top Events (default) vs All Events
            const showAllForDay = expandedDateGroups.has(dateKey);
            const scoreTierFilteredEvents = showDayToggle && !showAllForDay
              ? sortedGroupEvents.filter((event) => {
                  const tier = getEventScoreTier(event.score);
                  return tier === "quality" || tier === "outstanding";
                })
              : sortedGroupEvents;

            // For today, filter out events that started more than 2.5 hours ago (unless showing all)
            let displayEvents = scoreTierFilteredEvents;
            let hiddenPreviousCount = 0;
            if (isTodayGroup && !showAllPreviousEvents) {
              const recentAndUpcoming = scoreTierFilteredEvents.filter(
                (event) => new Date(event.startDate) >= twoAndHalfHoursAgo
              );
              hiddenPreviousCount =
                scoreTierFilteredEvents.length - recentAndUpcoming.length;
              displayEvents = recentAndUpcoming;
            }

            // For today, find the index where events transition from past to upcoming
            let nowDividerIndex = -1;
            if (isTodayGroup) {
              // Find first event that hasn't started yet
              const firstUpcomingIndex = displayEvents.findIndex(
                (event) => new Date(event.startDate) > now
              );
              if (firstUpcomingIndex > 0) {
                // There are both past and upcoming events
                nowDividerIndex = firstUpcomingIndex;
              }
            }

            // Skip rendering this date group if no events match the filter
            if (displayEvents.length === 0) {
              return null;
            }

            return (
              <div key={dateKey} className="flex flex-col">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 sticky top-0 sm:top-9 bg-white dark:bg-gray-900 sm:border sm:border-b-0 sm:border-gray-200 dark:sm:border-gray-700 sm:rounded-t-lg pt-3 pb-2 px-3 sm:px-4 z-10 flex items-center justify-between">
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
                            ? "text-brand-600 dark:text-brand-400 opacity-80"
                            : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
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
                            ? "text-brand-600 dark:text-brand-400 opacity-80"
                            : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
                        }`}
                      >
                        All Events
                      </button>
                    </div>
                  )}
                </h2>
                <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-b-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700">
                  {/* Show previous events toggle for today when events are hidden */}
                  {isTodayGroup &&
                    hiddenPreviousCount > 0 &&
                    !showAllPreviousEvents && (
                      <button
                        onClick={() => setShowAllPreviousEvents(true)}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:text-brand-700 dark:hover:text-brand-400 font-medium px-3 sm:px-5 py-3 sm:py-3 pt-0 text-left border-b border-gray-200 dark:border-gray-700 hover:bg-brand-50 dark:hover:bg-brand-950/50 transition-colors cursor-pointer underline sm:no-underline"
                      >
                        Show {hiddenPreviousCount} event
                        {hiddenPreviousCount !== 1 ? "s" : ""} from earlier
                        today +
                      </button>
                    )}
                  {/* Show collapse option when viewing all previous events */}
                  {isTodayGroup &&
                    showAllPreviousEvents &&
                    (() => {
                      // Calculate how many events would be hidden if we collapse
                      const wouldHideCount = scoreTierFilteredEvents.filter(
                        (event) =>
                          new Date(event.startDate) < twoAndHalfHoursAgo
                      ).length;
                      return wouldHideCount > 0 ? (
                        <button
                          onClick={() => setShowAllPreviousEvents(false)}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium px-3 sm:px-5 py-3 text-left border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                        >
                          Hide earlier events
                        </button>
                      ) : null;
                    })()}
                  {displayEvents.map((event, index) => {
                    const eventKey = createFingerprintKey(
                      event.title,
                      event.organizer
                    );
                    const isNewlyHidden = sessionHiddenKeys.has(eventKey);
                    const showNowDivider =
                      isTodayGroup && index === nowDividerIndex;
                    // Hide border on the card before the divider
                    const hideCardBorder =
                      isTodayGroup && index === nowDividerIndex - 1;

                    // Determine display mode based on score tier
                    // Common and Quality tiers are minimized by default, Outstanding is full
                    const tier = getEventScoreTier(event.score);
                    const isMinimized =
                      (tier === "quality" || tier === "hidden") && !expandedMinimizedIds.has(event.id);

                    return (
                      <div key={event.id}>
                        {showNowDivider && (
                          <div className="border-b-2 border-brand-600 pt-0 pb-2 px-5">
                            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">
                              Upcoming{" "}
                              <ArrowDownIcon
                                size={15}
                                className="inline-block mb-1 text-brand-600"
                              />
                            </span>
                          </div>
                        )}
                        <EventCard
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
                          hideBorder={hideCardBorder}
                          isFavorited={favoritedEventIds.includes(event.id)}
                          favoriteCount={event.favoriteCount ?? 0}
                          onToggleFavorite={handleToggleFavorite}
                          isTagFilterActive={tagFilters.include.length > 0}
                          isCurated={curatedEventIds.has(event.id)}
                          onCurate={handleOpenCurateModal}
                          onUncurate={handleUncurate}
                          isLoggedIn={isLoggedIn}
                          displayMode={isMinimized ? "minimized" : "full"}
                          onExpandMinimized={(id) =>
                            setExpandedMinimizedIds(
                              (prev) => new Set([...prev, id])
                            )
                          }
                          scoreTier={tier}
                          eventScore={event.score}
                        />
                      </div>
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
          <div
            ref={loadMoreRef}
            className="py-8 flex flex-col items-center justify-center gap-4"
          >
            {isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <Loader2Icon size={20} className="animate-spin" />
                <span className="text-sm">Loading more events...</span>
              </div>
            ) : (
              <button
                onClick={() => fetchNextPage()}
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

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
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

      <SaveFeedModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
      />

      {/* Scroll to top button */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 transition-all duration-300 z-50 ${
          showScrollTop
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
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
