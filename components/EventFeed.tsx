"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import EventCard from "./EventCard";
import FilterBar, { DateFilterType, PriceFilterType, DateRange } from "./FilterBar";
import ActiveFilters, { ActiveFilter } from "./ActiveFilters";
import SettingsModal from "./SettingsModal";
import { EventFeedSkeleton } from "./EventCardSkeleton";
import { useDebounce } from "@/lib/hooks/useDebounce";
import {
  DEFAULT_BLOCKED_KEYWORDS,
  matchesDefaultFilter,
} from "@/lib/config/defaultFilters";
import { useToast } from "./ui/Toast";

interface Event {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description?: string | null;
  startDate: Date;
  location?: string | null;
  organizer?: string | null;
  price?: string | null;
  url: string;
  imageUrl?: string | null;
  tags?: string[] | null;
  hidden?: boolean | null;
  createdAt?: Date | null;
}

interface EventFeedProps {
  initialEvents: Event[];
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
  const dayOfWeek = today.getDay();

  // Calculate this Saturday
  const saturday = new Date(today);
  saturday.setDate(today.getDate() + (6 - dayOfWeek));
  saturday.setHours(0, 0, 0, 0);

  // Calculate this Sunday end
  const sundayEnd = new Date(saturday);
  sundayEnd.setDate(saturday.getDate() + 1);
  sundayEnd.setHours(23, 59, 59, 999);

  return date >= saturday && date <= sundayEnd;
}

function isInDateRange(date: Date, range: DateRange): boolean {
  if (!range.start) return true;

  const eventDate = new Date(date);
  eventDate.setHours(0, 0, 0, 0);

  const startDate = new Date(range.start);
  startDate.setHours(0, 0, 0, 0);

  if (range.end) {
    const endDate = new Date(range.end);
    endDate.setHours(23, 59, 59, 999);
    return eventDate >= startDate && eventDate <= endDate;
  }

  return eventDate.toDateString() === startDate.toDateString();
}

const dateLabels: Record<DateFilterType, string> = {
  all: "All Dates",
  today: "Today",
  tomorrow: "Tomorrow",
  weekend: "This Weekend",
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
  const [events] = useState<Event[]>(initialEvents);
  const { showToast } = useToast();

  // Search
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, 300);

  // Filters
  const [dateFilter, setDateFilter] = useState<DateFilterType>(() =>
    getStorageItem("dateFilter", "all")
  );
  const [customDateRange, setCustomDateRange] = useState<DateRange>(() =>
    getStorageItem("customDateRange", { start: null, end: null })
  );
  const [priceFilter, setPriceFilter] = useState<PriceFilterType>(() =>
    getStorageItem("priceFilter", "any")
  );
  const [customMaxPrice, setCustomMaxPrice] = useState<number | null>(() =>
    getStorageItem("customMaxPrice", null)
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    getStorageItem("selectedTags", [])
  );

  // Settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [blockedHosts, setBlockedHosts] = useState<string[]>(() =>
    getStorageItem("blockedHosts", [])
  );
  const [blockedKeywords, setBlockedKeywords] = useState<string[]>(() =>
    getStorageItem("blockedKeywords", [])
  );
  const [hiddenIds, setHiddenIds] = useState<string[]>(() =>
    getStorageItem("hiddenIds", [])
  );
  const [useDefaultFilters, setUseDefaultFilters] = useState<boolean>(() =>
    getStorageItem("useDefaultFilters", true)
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Mark as loaded on mount
  useEffect(() => {
    setIsLoaded(true);
  }, []);

  // Save filter settings to localStorage
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("dateFilter", JSON.stringify(dateFilter));
      localStorage.setItem("customDateRange", JSON.stringify(customDateRange));
      localStorage.setItem("priceFilter", JSON.stringify(priceFilter));
      localStorage.setItem("customMaxPrice", JSON.stringify(customMaxPrice));
      localStorage.setItem("selectedTags", JSON.stringify(selectedTags));
      localStorage.setItem("blockedHosts", JSON.stringify(blockedHosts));
      localStorage.setItem("blockedKeywords", JSON.stringify(blockedKeywords));
      localStorage.setItem("hiddenIds", JSON.stringify(hiddenIds));
      localStorage.setItem("useDefaultFilters", JSON.stringify(useDefaultFilters));
    }
  }, [
    dateFilter,
    customDateRange,
    priceFilter,
    customMaxPrice,
    selectedTags,
    blockedHosts,
    blockedKeywords,
    hiddenIds,
    useDefaultFilters,
    isLoaded,
  ]);

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

  // Filter events
  const filteredEvents = useMemo(() => {
    if (!isLoaded) return events;

    return events.filter((event) => {
      // 1. Hidden IDs
      if (hiddenIds.includes(event.id)) return false;

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
        const textToCheck = `${event.title} ${event.description || ""}`;
        if (matchesDefaultFilter(textToCheck)) return false;
      }

      // 5. Date Filter
      const eventDate = new Date(event.startDate);
      if (dateFilter === "today" && !isToday(eventDate)) return false;
      if (dateFilter === "tomorrow" && !isTomorrow(eventDate)) return false;
      if (dateFilter === "weekend" && !isThisWeekend(eventDate)) return false;
      if (dateFilter === "custom" && !isInDateRange(eventDate, customDateRange))
        return false;

      // 6. Price Filter
      if (priceFilter !== "any") {
        const price = parsePrice(event.price);
        const priceStr = event.price?.toLowerCase() || "";
        const isFree =
          priceStr.includes("free") ||
          priceStr.includes("donation") ||
          (priceStr.length > 0 && /\d/.test(priceStr) && price === 0);

        if (priceFilter === "free" && !isFree) return false;
        if (priceFilter === "under20" && price > 20) return false;
        if (priceFilter === "under100" && price > 100) return false;
        if (priceFilter === "custom" && customMaxPrice !== null && price > customMaxPrice)
          return false;
      }

      // 7. Tag Filter (OR logic - match any selected tag)
      if (selectedTags.length > 0) {
        const eventTags = event.tags || [];
        const hasMatchingTag = selectedTags.some((tag) =>
          eventTags.includes(tag)
        );
        if (!hasMatchingTag) return false;
      }

      // 8. Search
      if (search) {
        const q = search.toLowerCase();
        const matchTitle = event.title.toLowerCase().includes(q);
        const matchVenue = event.organizer?.toLowerCase().includes(q);
        const matchLocation = event.location?.toLowerCase().includes(q);
        if (!matchTitle && !matchVenue && !matchLocation) return false;
      }

      return true;
    });
  }, [
    events,
    search,
    dateFilter,
    customDateRange,
    priceFilter,
    customMaxPrice,
    selectedTags,
    blockedHosts,
    blockedKeywords,
    hiddenIds,
    useDefaultFilters,
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
      if (dateFilter === "custom" && customDateRange.start) {
        if (customDateRange.end && customDateRange.end !== customDateRange.start) {
          label = `${new Date(customDateRange.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(customDateRange.end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
        } else {
          label = new Date(customDateRange.start).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
        }
      }
      filters.push({ id: "date", type: "date", label });
    }
    if (priceFilter !== "any") {
      let label = priceLabels[priceFilter];
      if (priceFilter === "custom" && customMaxPrice !== null) {
        label = `Under $${customMaxPrice}`;
      }
      filters.push({ id: "price", type: "price", label });
    }
    selectedTags.forEach((tag) => {
      filters.push({ id: `tag-${tag}`, type: "tag", label: tag });
    });

    return filters;
  }, [search, dateFilter, customDateRange, priceFilter, customMaxPrice, selectedTags]);

  // Handle removing filters
  const handleRemoveFilter = useCallback(
    (id: string) => {
      if (id === "search") {
        setSearchInput("");
      } else if (id === "date") {
        setDateFilter("all");
        setCustomDateRange({ start: null, end: null });
      } else if (id === "price") {
        setPriceFilter("any");
        setCustomMaxPrice(null);
      } else if (id.startsWith("tag-")) {
        const tag = id.replace("tag-", "");
        setSelectedTags((prev) => prev.filter((t) => t !== tag));
      }
    },
    []
  );

  // Clear all filters
  const handleClearAllFilters = useCallback(() => {
    setSearchInput("");
    setDateFilter("all");
    setCustomDateRange({ start: null, end: null });
    setPriceFilter("any");
    setCustomMaxPrice(null);
    setSelectedTags([]);
  }, []);

  // Hide event
  const handleHideEvent = useCallback(
    (id: string) => {
      setHiddenIds((prev) => [...prev, id]);
      showToast("Event hidden");
    },
    [showToast]
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

  if (!isLoaded) return <EventFeedSkeleton />;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <FilterBar
        search={searchInput}
        onSearchChange={setSearchInput}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        customDateRange={customDateRange}
        onCustomDateRangeChange={setCustomDateRange}
        priceFilter={priceFilter}
        onPriceFilterChange={setPriceFilter}
        customMaxPrice={customMaxPrice}
        onCustomMaxPriceChange={setCustomMaxPrice}
        availableTags={availableTags}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <ActiveFilters
        filters={activeFilters}
        onRemove={handleRemoveFilter}
        onClearAll={handleClearAllFilters}
        onClearAllTags={() => setSelectedTags([])}
        totalEvents={events.length}
        filteredCount={filteredEvents.length}
      />

      <div className="flex flex-col gap-6 mt-4">
        {Object.entries(
          filteredEvents.reduce(
            (groups, event) => {
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
            if (date.toDateString() === today.toDateString()) {
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

            return (
              <div key={dateKey} className="flex flex-col gap-2">
                <h2 className="text-xl font-bold text-gray-800 sticky top-0 bg-gray-100 py-2 px-1 z-10">
                  {headerText}
                </h2>
                <div className="flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  {groupEvents.map((event) => (
                    <EventCard
                      key={event.id}
                      event={{
                        ...event,
                        sourceId: event.sourceId,
                        location: event.location ?? null,
                        organizer: event.organizer ?? null,
                        price: event.price ?? null,
                        imageUrl: event.imageUrl ?? null,
                      }}
                      onHide={handleHideEvent}
                      onBlockHost={handleBlockHost}
                    />
                  ))}
                </div>
              </div>
            );
          })}
      </div>

      {filteredEvents.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          No events found matching your criteria.
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        blockedHosts={blockedHosts}
        blockedKeywords={blockedKeywords}
        hiddenIdsCount={hiddenIds.length}
        onUpdateHosts={setBlockedHosts}
        onUpdateKeywords={setBlockedKeywords}
        onClearHidden={() => setHiddenIds([])}
        useDefaultFilters={useDefaultFilters}
        onToggleDefaultFilters={setUseDefaultFilters}
        defaultFilterKeywords={DEFAULT_BLOCKED_KEYWORDS}
      />
    </div>
  );
}
