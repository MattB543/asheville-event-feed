"use client";

import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useDeferredValue,
} from "react";
import EventCard from "./EventCard";
import FilterBar, {
  DateFilterType,
  PriceFilterType,
  DateRange,
  TimeOfDay,
} from "./FilterBar";
import { extractCity, isAshevilleArea } from "@/lib/utils/extractCity";
import ActiveFilters, { ActiveFilter } from "./ActiveFilters";
import { parse, isValid } from "date-fns";
import SettingsModal from "./SettingsModal";
import AIChatModal from "./AIChatModal";
import { EventFeedSkeleton } from "./EventCardSkeleton";
import {
  DEFAULT_BLOCKED_KEYWORDS,
  matchesDefaultFilter,
} from "@/lib/config/defaultFilters";
import { useToast } from "./ui/Toast";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { getZipName, isAshevilleZip } from "@/lib/config/zipNames";

interface Event {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description?: string | null;
  startDate: Date;
  location?: string | null;
  zip?: string | null;
  organizer?: string | null;
  price?: string | null;
  url: string;
  imageUrl?: string | null;
  tags?: string[] | null;
  hidden?: boolean | null;
  createdAt?: Date | null;
  timeUnknown?: boolean | null;
  recurringType?: string | null;
  favoriteCount?: number | null;
}

interface EventFeedProps {
  initialEvents: Event[];
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

// Check if event matches any hidden fingerprint
function matchesHiddenFingerprint(
  event: Event,
  hiddenEvents: HiddenEventFingerprint[]
): boolean {
  const eventKey = createFingerprintKey(event.title, event.organizer);
  return hiddenEvents.some((fp) => {
    const fpKey = `${fp.title}|||${fp.organizer}`;
    return eventKey === fpKey;
  });
}

const parsePrice = (priceStr: string | null | undefined): number => {
  if (!priceStr) return 0;
  const lower = priceStr.toLowerCase();
  if (lower.includes("free") || lower.includes("donation")) return 0;
  const matches = priceStr.match(/(\d+(\.\d+)?)/);
  if (matches) return parseFloat(matches[0]);
  return 0;
};

function getStorageItem<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
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

// Helper functions for date filtering
function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.toDateString() === tomorrow.toDateString();
}

function isThisWeekend(date: Date): boolean {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday

  // Calculate Friday of THIS week (weekend = Fri, Sat, Sun)
  // If today is Sunday (0), Friday was 2 days ago
  // Otherwise, Friday is (5 - dayOfWeek) days away
  const daysUntilFriday = dayOfWeek === 0 ? -2 : 5 - dayOfWeek;
  const friday = new Date(today);
  friday.setDate(today.getDate() + daysUntilFriday);
  friday.setHours(0, 0, 0, 0);

  // Calculate this Sunday end (2 days after Friday)
  const sundayEnd = new Date(friday);
  sundayEnd.setDate(friday.getDate() + 2);
  sundayEnd.setHours(23, 59, 59, 999);

  return date >= friday && date <= sundayEnd;
}

function isInDateRange(date: Date, range: DateRange): boolean {
  if (!range.start) return true;

  const eventDate = new Date(date);
  eventDate.setHours(0, 0, 0, 0);

  // Use safeParseDateString to parse yyyy-MM-dd as LOCAL date (not UTC)
  const startDate = safeParseDateString(range.start);
  if (!startDate) return true;
  startDate.setHours(0, 0, 0, 0);

  if (range.end) {
    const endDate = safeParseDateString(range.end);
    if (endDate) {
      endDate.setHours(23, 59, 59, 999);
      return eventDate >= startDate && eventDate <= endDate;
    }
  }

  return eventDate.toDateString() === startDate.toDateString();
}

function isDayOfWeek(date: Date, days: number[]): boolean {
  if (days.length === 0) return true; // No filter = show all
  return days.includes(date.getDay());
}

// Time of day filter helper
// Morning: 5 AM - Noon (hours 5-11)
// Afternoon: Noon - 5 PM (hours 12-16)
// Evening: 5 PM - 3 AM (hours 17-23, 0-2)
function isInTimeOfDay(date: Date, times: TimeOfDay[]): boolean {
  if (times.length === 0) return true; // No filter = show all
  const hour = date.getHours();

  for (const time of times) {
    if (time === "morning" && hour >= 5 && hour < 12) return true;
    if (time === "afternoon" && hour >= 12 && hour < 17) return true;
    if (time === "evening" && (hour >= 17 || hour < 3)) return true; // 5 PM - 3 AM
  }
  return false;
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

export default function EventFeed({ initialEvents }: EventFeedProps) {
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const { showToast } = useToast();

  // Track which events the user has favorited (persisted to localStorage)
  const [favoritedEventIds, setFavoritedEventIds] = useState<string[]>(() =>
    getStorageItem("favoritedEventIds", [])
  );

  // Search (committed value only - FilterBar handles local input state)
  const [search, setSearch] = useState("");

  // Filters
  const [dateFilter, setDateFilter] = useState<DateFilterType>(() =>
    getStorageItem("dateFilter", "all")
  );
  const [customDateRange, setCustomDateRange] = useState<DateRange>(() =>
    getStorageItem("customDateRange", { start: null, end: null })
  );
  const [selectedDays, setSelectedDays] = useState<number[]>(() =>
    getStorageItem("selectedDays", [])
  );
  const [selectedTimes, setSelectedTimes] = useState<TimeOfDay[]>(() =>
    getStorageItem("selectedTimes", [])
  );
  const [priceFilter, setPriceFilter] = useState<PriceFilterType>(() =>
    getStorageItem("priceFilter", "any")
  );
  const [customMaxPrice, setCustomMaxPrice] = useState<number | null>(() =>
    getStorageItem("customMaxPrice", null)
  );
  // Tag filters with include/exclude (with migration from old selectedTags format)
  const [tagFilters, setTagFilters] = useState<TagFilterState>(() => {
    // Try new format first
    const newFormat = getStorageItem<TagFilterState | null>("tagFilters", null);
    if (newFormat && (newFormat.include || newFormat.exclude)) return newFormat;

    // Migrate from old format
    const oldSelectedTags = getStorageItem<string[]>("selectedTags", []);
    return { include: oldSelectedTags, exclude: [] };
  });
  const [selectedLocations, setSelectedLocations] = useState<string[]>(() =>
    getStorageItem("selectedLocations", [])
  );
  const [selectedZips, setSelectedZips] = useState<string[]>(() =>
    getStorageItem("selectedZips", [])
  );
  // Daily events filter - default to showing daily events
  const [showDailyEvents, setShowDailyEvents] = useState<boolean>(() =>
    getStorageItem("showDailyEvents", true)
  );

  // Settings & Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
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
  const [useDefaultFilters, setUseDefaultFilters] = useState<boolean>(() =>
    getStorageItem("useDefaultFilters", true)
  );
  const [showAllPreviousEvents, setShowAllPreviousEvents] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Deferred values for filter computation - allows UI to update immediately
  // while the heavy filtering computation happens in the background
  const deferredTagFilters = useDeferredValue(tagFilters);
  const deferredPriceFilter = useDeferredValue(priceFilter);
  const deferredDateFilter = useDeferredValue(dateFilter);
  const deferredSelectedDays = useDeferredValue(selectedDays);
  const deferredSelectedTimes = useDeferredValue(selectedTimes);
  const deferredCustomDateRange = useDeferredValue(customDateRange);
  const deferredCustomMaxPrice = useDeferredValue(customMaxPrice);
  const deferredSelectedLocations = useDeferredValue(selectedLocations);
  const deferredSelectedZips = useDeferredValue(selectedZips);
  const deferredSearch = useDeferredValue(search);
  const deferredShowDailyEvents = useDeferredValue(showDailyEvents);

  // Detect when filters are pending (deferred value hasn't caught up)
  const isFilterPending =
    deferredTagFilters !== tagFilters ||
    deferredPriceFilter !== priceFilter ||
    deferredDateFilter !== dateFilter ||
    deferredSelectedLocations !== selectedLocations ||
    deferredSelectedZips !== selectedZips ||
    deferredSearch !== search ||
    deferredCustomMaxPrice !== customMaxPrice ||
    deferredSelectedDays !== selectedDays ||
    deferredSelectedTimes !== selectedTimes ||
    deferredCustomDateRange !== customDateRange ||
    deferredShowDailyEvents !== showDailyEvents;

  // Set isLoaded after mount to prevent hydration mismatch
  useEffect(() => {
    setIsLoaded(true);
  }, []);

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
      localStorage.setItem(
        "useDefaultFilters",
        JSON.stringify(useDefaultFilters)
      );
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
    useDefaultFilters,
    showDailyEvents,
    favoritedEventIds,
    isLoaded,
  ]);

  // Read URL params on mount (for shared links)
  useEffect(() => {
    if (!isLoaded) return;

    const params = new URLSearchParams(window.location.search);

    // Check if any filter params exist in URL
    const hasUrlFilters =
      params.has("search") ||
      params.has("dateFilter") ||
      params.has("times") ||
      params.has("priceFilter") ||
      params.has("tagsInclude") ||
      params.has("tagsExclude") ||
      params.has("locations");

    if (!hasUrlFilters) return;

    // Apply URL params to state (overrides localStorage for shared links)
    if (params.has("search")) {
      setSearch(params.get("search") || "");
    }

    if (params.has("dateFilter")) {
      const df = params.get("dateFilter") as DateFilterType;
      if (
        ["all", "today", "tomorrow", "weekend", "dayOfWeek", "custom"].includes(
          df
        )
      ) {
        setDateFilter(df);
      }
    }

    if (params.has("days")) {
      const days =
        params
          .get("days")
          ?.split(",")
          .map(Number)
          .filter((n) => !isNaN(n) && n >= 0 && n <= 6) || [];
      setSelectedDays(days);
    }

    if (params.has("times")) {
      const validTimes = ["morning", "afternoon", "evening"] as const;
      const times = params
        .get("times")
        ?.split(",")
        .filter((t): t is TimeOfDay => validTimes.includes(t as TimeOfDay)) || [];
      setSelectedTimes(times);
    }

    if (params.has("dateStart")) {
      setCustomDateRange({
        start: params.get("dateStart"),
        end: params.get("dateEnd"),
      });
    }

    if (params.has("priceFilter")) {
      const pf = params.get("priceFilter") as PriceFilterType;
      if (["any", "free", "under20", "under100", "custom"].includes(pf)) {
        setPriceFilter(pf);
      }
    }

    if (params.has("maxPrice")) {
      const mp = parseInt(params.get("maxPrice") || "", 10);
      if (!isNaN(mp) && mp >= 0) setCustomMaxPrice(mp);
    }

    if (params.has("tagsInclude") || params.has("tagsExclude")) {
      setTagFilters({
        include:
          params
            .get("tagsInclude")
            ?.split(",")
            .filter(Boolean) || [],
        exclude:
          params
            .get("tagsExclude")
            ?.split(",")
            .filter(Boolean) || [],
      });
    }

    if (params.has("locations")) {
      setSelectedLocations(
        params
          .get("locations")
          ?.split(",")
          .filter(Boolean) || []
      );
    }

    if (params.has("useDefaultFilters")) {
      setUseDefaultFilters(params.get("useDefaultFilters") !== "false");
    }
     
  }, [isLoaded]); // Only run once after hydration

  // Extract available tags from events (sorted by frequency)
  const availableTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    events.forEach((event) => {
      event.tags?.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [events]);

  // Minimum number of events for a location to appear in filter dropdown
  const LOCATION_MIN_EVENTS = 6;

  // Extract available locations from events (for location filter dropdown)
  // Only includes locations with 10+ events to reduce dropdown clutter
  const availableLocations = useMemo(() => {
    const cityCount = new Map<string, number>();
    let onlineCount = 0;

    events.forEach((event) => {
      const city = extractCity(event.location);
      if (city === "Online") {
        onlineCount++;
      } else if (city) {
        cityCount.set(city, (cityCount.get(city) || 0) + 1);
      }
    });

    // Only include cities with enough events (always include Asheville as primary)
    const cities = Array.from(cityCount.entries())
      .filter(
        ([city, count]) => city === "Asheville" || count >= LOCATION_MIN_EVENTS
      )
      .map(([city]) => city)
      .sort((a, b) => {
        if (a === "Asheville") return -1;
        if (b === "Asheville") return 1;
        return a.localeCompare(b);
      });

    // Add Online at the end if it meets threshold
    if (onlineCount >= LOCATION_MIN_EVENTS) {
      cities.push("Online");
    }

    return cities;
  }, [events]);

  // Minimum number of events for a zip to appear in filter dropdown
  const ZIP_MIN_EVENTS = 6;

  // Extract available zip codes from events (for zip filter dropdown)
  const availableZips = useMemo(() => {
    const zipCounts = new Map<string, number>();

    events.forEach((event) => {
      if (event.zip) {
        zipCounts.set(event.zip, (zipCounts.get(event.zip) || 0) + 1);
      }
    });

    // Only include zips with enough events, sorted by count (most events first)
    return Array.from(zipCounts.entries())
      .filter(([, count]) => count >= ZIP_MIN_EVENTS)
      .sort((a, b) => b[1] - a[1])
      .map(([zip, count]) => ({ zip, count }));
  }, [events]);

  // Filter events - uses deferred values for optimistic UI updates
  const filteredEvents = useMemo(() => {
    if (!isLoaded) return events;

    // Simple case-insensitive search (using deferred value)
    const searchLower = deferredSearch?.toLowerCase() || "";

    return events.filter((event) => {
      // 1. Hidden Events (by title+organizer fingerprint)
      // Only filter out if it was hidden in a PREVIOUS session (not this session)
      const eventKey = createFingerprintKey(event.title, event.organizer);
      if (
        matchesHiddenFingerprint(event, hiddenEvents) &&
        !sessionHiddenKeys.has(eventKey)
      ) {
        return false;
      }

      // 2. Blocked Hosts
      if (
        event.organizer &&
        blockedHosts.some((host) =>
          event.organizer!.toLowerCase().includes(host.toLowerCase())
        )
      ) {
        return false;
      }

      // 3. Blocked Keywords (user custom)
      if (
        blockedKeywords.some((kw) =>
          event.title.toLowerCase().includes(kw.toLowerCase())
        )
      ) {
        return false;
      }

      // 4. Default Filters
      if (useDefaultFilters) {
        const textToCheck = `${event.title} ${event.description || ""} ${event.organizer || ""}`;
        if (matchesDefaultFilter(textToCheck)) return false;
      }

      // 4b. Daily Events Filter
      if (!deferredShowDailyEvents && event.recurringType === "daily") {
        return false;
      }

      // 5. Date Filter (using deferred values)
      const eventDate = new Date(event.startDate);
      if (deferredDateFilter === "today" && !isToday(eventDate)) return false;
      if (deferredDateFilter === "tomorrow" && !isTomorrow(eventDate))
        return false;
      if (deferredDateFilter === "weekend" && !isThisWeekend(eventDate))
        return false;
      if (
        deferredDateFilter === "dayOfWeek" &&
        !isDayOfWeek(eventDate, deferredSelectedDays)
      )
        return false;
      if (
        deferredDateFilter === "custom" &&
        !isInDateRange(eventDate, deferredCustomDateRange)
      )
        return false;

      // 5b. Time of Day Filter (using deferred values)
      // Skip time filter for events with unknown time (they show regardless)
      if (deferredSelectedTimes.length > 0 && !event.timeUnknown) {
        if (!isInTimeOfDay(eventDate, deferredSelectedTimes)) return false;
      }

      // 6. Price Filter (using deferred values)
      if (deferredPriceFilter !== "any") {
        const price = parsePrice(event.price);
        const priceStr = event.price?.toLowerCase() || "";
        const isUnknown =
          !event.price || priceStr === "unknown" || priceStr.length === 0;
        const isFree =
          isUnknown ||
          priceStr.includes("free") ||
          priceStr.includes("donation") ||
          (/\d/.test(priceStr) && price === 0);

        if (deferredPriceFilter === "free" && !isFree) return false;
        if (deferredPriceFilter === "under20" && price > 20) return false;
        if (deferredPriceFilter === "under100" && price > 100) return false;
        if (
          deferredPriceFilter === "custom" &&
          deferredCustomMaxPrice !== null &&
          price > deferredCustomMaxPrice
        )
          return false;
      }

      // 7. Tag Filter (include AND exclude) - using deferred values
      const eventTags = event.tags || [];

      // Exclude logic: If event has ANY excluded tag, filter it out
      if (deferredTagFilters.exclude.length > 0) {
        const hasExcludedTag = deferredTagFilters.exclude.some((tag) =>
          eventTags.includes(tag)
        );
        if (hasExcludedTag) return false;
      }

      // Include logic: If includes are set, event must have at least one
      if (deferredTagFilters.include.length > 0) {
        const hasIncludedTag = deferredTagFilters.include.some((tag) =>
          eventTags.includes(tag)
        );
        if (!hasIncludedTag) return false;
      }

      // 8. Location & Zip Filter (multi-select - OR logic) - using deferred values
      const hasLocationFilter = deferredSelectedLocations.length > 0;
      const hasZipFilter = deferredSelectedZips.length > 0;

      if (hasLocationFilter || hasZipFilter) {
        const eventCity = extractCity(event.location);
        const eventZip = event.zip;
        let matchesFilter = false;

        // Check zip filter first (more specific)
        if (hasZipFilter && eventZip) {
          if (deferredSelectedZips.includes(eventZip)) {
            matchesFilter = true;
          }
        }

        // Check location filter if no zip match yet
        if (!matchesFilter && hasLocationFilter) {
          for (const loc of deferredSelectedLocations) {
            if (loc === "asheville") {
              // "Asheville area" includes: Asheville city + known Asheville venues + Asheville zips
              if (isAshevilleArea(event.location) || (eventZip && isAshevilleZip(eventZip))) {
                matchesFilter = true;
                break;
              }
            } else if (loc === "Online") {
              if (eventCity === "Online") {
                matchesFilter = true;
                break;
              }
            } else {
              // Specific city - exact match
              if (eventCity === loc) {
                matchesFilter = true;
                break;
              }
            }
          }
        }

        if (!matchesFilter) {
          return false;
        }
      }

      // 9. Search (searches title, description, organizer, location)
      if (searchLower) {
        const searchText = `${event.title} ${event.description || ""} ${
          event.organizer || ""
        } ${event.location || ""}`.toLowerCase();
        if (!searchText.includes(searchLower)) {
          return false;
        }
      }

      return true;
    });
  }, [
    events,
    deferredSearch,
    deferredDateFilter,
    deferredCustomDateRange,
    deferredSelectedDays,
    deferredSelectedTimes,
    deferredPriceFilter,
    deferredCustomMaxPrice,
    deferredTagFilters,
    deferredSelectedLocations,
    deferredSelectedZips,
    blockedHosts,
    blockedKeywords,
    hiddenEvents,
    sessionHiddenKeys,
    useDefaultFilters,
    deferredShowDailyEvents,
    isLoaded,
  ]);

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
      filters.push({ id: `zip-${zip}`, type: "zip", label: `${zip} (${name})` });
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

  // Hide event (by title + organizer fingerprint)
  const handleHideEvent = useCallback(
    (title: string, organizer: string | null) => {
      const fingerprint: HiddenEventFingerprint = {
        title: title.toLowerCase().trim(),
        organizer: (organizer || "").toLowerCase().trim(),
      };
      const key = createFingerprintKey(title, organizer);

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
    []
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

      // Optimistically update local state
      setFavoritedEventIds((prev) =>
        isFavorited ? prev.filter((id) => id !== eventId) : [...prev, eventId]
      );

      // Optimistically update event's favorite count
      setEvents((prev) =>
        prev.map((event) =>
          event.id === eventId
            ? {
                ...event,
                favoriteCount: Math.max(
                  0,
                  (event.favoriteCount ?? 0) + (isFavorited ? -1 : 1)
                ),
              }
            : event
        )
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

        const data = await response.json();

        // Update with actual count from server
        setEvents((prev) =>
          prev.map((event) =>
            event.id === eventId
              ? { ...event, favoriteCount: data.favoriteCount }
              : event
          )
        );
      } catch (error) {
        // Revert optimistic updates on error
        setFavoritedEventIds((prev) =>
          isFavorited ? [...prev, eventId] : prev.filter((id) => id !== eventId)
        );
        setEvents((prev) =>
          prev.map((event) =>
            event.id === eventId
              ? {
                  ...event,
                  favoriteCount: Math.max(
                    0,
                    (event.favoriteCount ?? 0) + (isFavorited ? 1 : -1)
                  ),
                }
              : event
          )
        );
        console.error("Failed to toggle favorite:", error);
      }
    },
    [favoritedEventIds]
  );

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
    params.set("useDefaultFilters", useDefaultFilters.toString());
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
    useDefaultFilters,
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
    // Include useDefaultFilters so shared view has same spam filtering
    if (!useDefaultFilters) params.set("useDefaultFilters", "false");

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
    useDefaultFilters,
  ]);

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
        totalEvents={events.length}
        filteredCount={filteredEvents.length}
        exportParams={exportParams}
        shareParams={shareParams}
        onOpenChat={() => setIsChatOpen(true)}
        isPending={isFilterPending}
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

            // For today, filter out events that started more than 2.5 hours ago (unless showing all)
            let displayEvents = sortedGroupEvents;
            let hiddenPreviousCount = 0;
            if (isTodayGroup && !showAllPreviousEvents) {
              const recentAndUpcoming = sortedGroupEvents.filter(
                (event) => new Date(event.startDate) >= twoAndHalfHoursAgo
              );
              hiddenPreviousCount =
                sortedGroupEvents.length - recentAndUpcoming.length;
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

            return (
              <div key={dateKey} className="flex flex-col">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 sticky top-0 sm:top-9 bg-white dark:bg-gray-900 sm:border sm:border-b-0 sm:border-gray-200 dark:sm:border-gray-700 sm:rounded-t-lg py-2 px-3 sm:px-4 z-10">
                  {headerText}
                </h2>
                <div className="flex flex-col bg-white dark:bg-gray-900 sm:rounded-b-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700 overflow-hidden">
                  {/* Show previous events toggle for today when events are hidden */}
                  {isTodayGroup &&
                    hiddenPreviousCount > 0 &&
                    !showAllPreviousEvents && (
                      <button
                        onClick={() => setShowAllPreviousEvents(true)}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:text-blue-700 dark:hover:text-blue-400 font-medium px-3 sm:px-5 py-3 sm:py-3 pt-0 text-left border-b border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors cursor-pointer underline sm:no-underline"
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
                      const wouldHideCount = sortedGroupEvents.filter(
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
                          isNewlyHidden={isNewlyHidden}
                          hideBorder={hideCardBorder}
                          isFavorited={favoritedEventIds.includes(event.id)}
                          favoriteCount={event.favoriteCount ?? 0}
                          onToggleFavorite={handleToggleFavorite}
                          isTagFilterActive={tagFilters.include.length > 0}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>

      {filteredEvents.length === 0 && (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">
          No events found matching your criteria.
        </div>
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
        useDefaultFilters={useDefaultFilters}
        onToggleDefaultFilters={setUseDefaultFilters}
        defaultFilterKeywords={DEFAULT_BLOCKED_KEYWORDS}
      />

      <AIChatModal
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        allEvents={events}
        activeFilters={{
          search,
          priceFilter,
          tagsInclude: tagFilters.include,
          tagsExclude: tagFilters.exclude,
          selectedLocations,
        }}
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
            Scroll up
          </span>
        </button>
      </div>
    </div>
  );
}
