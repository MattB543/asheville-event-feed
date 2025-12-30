"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import {
  Search,
  SlidersHorizontal,
  Tag,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Calendar as CalendarIcon,
  MapPin,
  ArrowRight,
  X,
} from "lucide-react";
import { TAG_CATEGORIES } from "@/lib/config/tagCategories";
import { getZipName } from "@/lib/config/zipNames";
import { Calendar } from "./ui/Calendar";
import { DateRange as DayPickerDateRange } from "react-day-picker";
import { format, parse, isValid } from "date-fns";
import TriStateCheckbox, { TriState } from "./ui/TriStateCheckbox";
import { TagFilterState } from "./EventFeed";

// Safe date parsing helper that returns undefined on invalid dates
function safeParseDateString(dateStr: string | null): Date | undefined {
  if (!dateStr) return undefined;
  try {
    const parsed = parse(dateStr, "yyyy-MM-dd", new Date());
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export type DateFilterType =
  | "all"
  | "today"
  | "tomorrow"
  | "weekend"
  | "dayOfWeek"
  | "custom";
export type PriceFilterType =
  | "any"
  | "free"
  | "under20"
  | "under100"
  | "custom";
export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface FilterBarProps {
  search: string;
  onSearchChange: (val: string) => void;
  dateFilter: DateFilterType;
  onDateFilterChange: (val: DateFilterType) => void;
  customDateRange: DateRange;
  onCustomDateRangeChange: (range: DateRange) => void;
  selectedDays: number[];
  onSelectedDaysChange: (days: number[]) => void;
  selectedTimes: TimeOfDay[];
  onSelectedTimesChange: (times: TimeOfDay[]) => void;
  priceFilter: PriceFilterType;
  onPriceFilterChange: (val: PriceFilterType) => void;
  customMaxPrice: number | null;
  onCustomMaxPriceChange: (val: number | null) => void;
  selectedLocations: string[];
  onLocationsChange: (locations: string[]) => void;
  availableLocations: string[];
  selectedZips: string[];
  onZipsChange: (zips: string[]) => void;
  availableZips: { zip: string; count: number }[];
  availableTags: string[];
  tagFilters: TagFilterState;
  onTagFiltersChange: (filters: TagFilterState) => void;
  showDailyEvents: boolean;
  onShowDailyEventsChange: (show: boolean) => void;
  onOpenSettings: () => void;
}

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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIME_OPTIONS: { value: TimeOfDay; label: string; timeRange: string }[] = [
  { value: "morning", label: "Morning", timeRange: "5 AM - Noon" },
  { value: "afternoon", label: "Afternoon", timeRange: "Noon - 5 PM" },
  { value: "evening", label: "Evening", timeRange: "5 PM - 3 AM" },
];

export default function FilterBar({
  search,
  onSearchChange,
  dateFilter,
  onDateFilterChange,
  customDateRange,
  onCustomDateRangeChange,
  selectedDays,
  onSelectedDaysChange,
  selectedTimes,
  onSelectedTimesChange,
  priceFilter,
  onPriceFilterChange,
  customMaxPrice,
  onCustomMaxPriceChange,
  selectedLocations,
  onLocationsChange,
  availableLocations,
  selectedZips,
  onZipsChange,
  availableZips,
  availableTags,
  tagFilters,
  onTagFiltersChange,
  showDailyEvents,
  onShowDailyEventsChange,
  onOpenSettings,
}: FilterBarProps) {
  const [isTagsOpen, setIsTagsOpen] = useState(false);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [isPriceOpen, setIsPriceOpen] = useState(false);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(TAG_CATEGORIES.map((c) => c.name))
  );
  const tagsRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);
  const locationRef = useRef<HTMLDivElement>(null);

  // Local optimistic state for instant visual feedback on filter clicks
  const [localTagFilters, setLocalTagFilters] = useState(tagFilters);
  const [localDateFilter, setLocalDateFilter] = useState(dateFilter);
  const [localCustomDateRange, setLocalCustomDateRange] =
    useState(customDateRange);
  const [localSelectedDays, setLocalSelectedDays] = useState(selectedDays);
  const [localSelectedTimes, setLocalSelectedTimes] = useState(selectedTimes);
  const [localPriceFilter, setLocalPriceFilter] = useState(priceFilter);
  const [localCustomMaxPrice, setLocalCustomMaxPrice] =
    useState(customMaxPrice);
  const [localSelectedLocations, setLocalSelectedLocations] =
    useState(selectedLocations);
  const [localSelectedZips, setLocalSelectedZips] = useState(selectedZips);
  const [expandedLocationSections, setExpandedLocationSections] = useState<
    Set<string>
  >(
    new Set() // Both collapsed by default, will expand based on selections when opened
  );
  const [localSearchInput, setLocalSearchInput] = useState(search);
  const [localShowDailyEvents, setLocalShowDailyEvents] =
    useState(showDailyEvents);
  const [, startTransition] = useTransition();

  // Sync local state with props when they change (e.g., from "Clear all" button)
  useEffect(() => {
    setLocalTagFilters(tagFilters);
  }, [tagFilters]);

  useEffect(() => {
    setLocalDateFilter(dateFilter);
  }, [dateFilter]);

  useEffect(() => {
    setLocalCustomDateRange(customDateRange);
  }, [customDateRange]);

  useEffect(() => {
    setLocalSelectedDays(selectedDays);
  }, [selectedDays]);

  useEffect(() => {
    setLocalSelectedTimes(selectedTimes);
  }, [selectedTimes]);

  useEffect(() => {
    setLocalPriceFilter(priceFilter);
  }, [priceFilter]);

  useEffect(() => {
    setLocalCustomMaxPrice(customMaxPrice);
  }, [customMaxPrice]);

  useEffect(() => {
    setLocalSelectedLocations(selectedLocations);
  }, [selectedLocations]);

  useEffect(() => {
    setLocalSelectedZips(selectedZips);
  }, [selectedZips]);

  useEffect(() => {
    setLocalSearchInput(search);
  }, [search]);

  useEffect(() => {
    setLocalShowDailyEvents(showDailyEvents);
  }, [showDailyEvents]);

  // Search submit handler - only updates parent when user explicitly submits
  const handleSearchSubmit = () => {
    if (localSearchInput !== search) {
      onSearchChange(localSearchInput);
    }
  };

  // Handle Enter key to submit search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchSubmit();
    }
  };

  // Clear search
  const handleClearSearch = () => {
    setLocalSearchInput("");
    onSearchChange("");
  };

  // Whether there are uncommitted search changes
  const hasUncommittedSearch =
    localSearchInput !== search && localSearchInput.length > 0;
  // Whether search is currently active (has committed value)
  const hasActiveSearch = search.length > 0;

  // Dropdown alignment state for collision detection
  const [tagsAlign, setTagsAlign] = useState<"left" | "right">("left");
  const [locationAlign, setLocationAlign] = useState<"left" | "right" | "center">("left");

  // Handle opening dropdowns with collision detection
  const handleTagsOpen = () => {
    if (!isTagsOpen && tagsRef.current) {
      const rect = tagsRef.current.getBoundingClientRect();
      const dropdownWidth = 270; // mobile dropdown width
      const wouldOverflow = rect.left + dropdownWidth > window.innerWidth - 16; // 16px margin
      setTagsAlign(wouldOverflow ? "right" : "left");
    }
    setIsTagsOpen(!isTagsOpen);
  };

  const handleLocationOpen = () => {
    if (!isLocationOpen && locationRef.current) {
      const rect = locationRef.current.getBoundingClientRect();
      const dropdownWidth = 240;
      const margin = 16;
      const isMobile = window.innerWidth < 640; // sm breakpoint

      if (isMobile) {
        // On mobile, prefer centering the dropdown on the button
        const buttonCenter = rect.left + rect.width / 2;
        const halfDropdown = dropdownWidth / 2;

        const canCenter =
          buttonCenter - halfDropdown >= margin &&
          buttonCenter + halfDropdown <= window.innerWidth - margin;
        const canLeft = rect.left + dropdownWidth <= window.innerWidth - margin;

        if (canCenter) {
          setLocationAlign("center");
        } else if (canLeft) {
          setLocationAlign("left");
        } else {
          setLocationAlign("right");
        }
      } else {
        // On tablet+, just left-align like other dropdowns
        setLocationAlign("left");
      }

      // Auto-expand sections based on what's selected
      const sectionsToExpand = new Set<string>();
      if (localSelectedLocations.length > 0) {
        sectionsToExpand.add("cities");
      }
      if (localSelectedZips.length > 0) {
        sectionsToExpand.add("zips");
      }
      setExpandedLocationSections(sectionsToExpand);
    }
    setIsLocationOpen(!isLocationOpen);
  };

  // Close popovers on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tagsRef.current && !tagsRef.current.contains(event.target as Node)) {
        setIsTagsOpen(false);
      }
      if (dateRef.current && !dateRef.current.contains(event.target as Node)) {
        setIsDateOpen(false);
      }
      if (
        priceRef.current &&
        !priceRef.current.contains(event.target as Node)
      ) {
        setIsPriceOpen(false);
      }
      if (
        locationRef.current &&
        !locationRef.current.contains(event.target as Node)
      ) {
        setIsLocationOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Get the current state of a tag filter (uses local state for instant feedback)
  const getTagState = (tag: string): TriState => {
    if (localTagFilters.include.includes(tag)) return "include";
    if (localTagFilters.exclude.includes(tag)) return "exclude";
    return "off";
  };

  // Cycle through tag states: off -> include -> exclude -> off
  // Uses optimistic update pattern: local state updates instantly, parent update is deferred
  const cycleTagState = (tag: string) => {
    const currentState = getTagState(tag);
    let newFilters: TagFilterState;

    if (currentState === "off") {
      // off -> include
      newFilters = {
        ...localTagFilters,
        include: [...localTagFilters.include, tag],
      };
    } else if (currentState === "include") {
      // include -> exclude
      newFilters = {
        include: localTagFilters.include.filter((t) => t !== tag),
        exclude: [...localTagFilters.exclude, tag],
      };
    } else {
      // exclude -> off
      newFilters = {
        ...localTagFilters,
        exclude: localTagFilters.exclude.filter((t) => t !== tag),
      };
    }

    // Update local state immediately for instant visual feedback
    setLocalTagFilters(newFilters);

    // Defer the parent update to keep UI responsive
    startTransition(() => {
      onTagFiltersChange(newFilters);
    });
  };

  const toggleLocation = (location: string) => {
    const newLocations = localSelectedLocations.includes(location)
      ? localSelectedLocations.filter((l) => l !== location)
      : [...localSelectedLocations, location];

    setLocalSelectedLocations(newLocations);
    startTransition(() => {
      onLocationsChange(newLocations);
    });
  };

  const selectAllLocations = () => {
    // Select "asheville" + all other available locations + "online" if available
    const allLocs = [
      "asheville",
      ...availableLocations.filter((l) => l !== "Asheville"),
    ];
    setLocalSelectedLocations(allLocs);
    startTransition(() => {
      onLocationsChange(allLocs);
    });
  };

  const deselectAllLocations = () => {
    setLocalSelectedLocations([]);
    setLocalSelectedZips([]);
    startTransition(() => {
      onLocationsChange([]);
      onZipsChange([]);
    });
  };

  const toggleZip = (zip: string) => {
    const newZips = localSelectedZips.includes(zip)
      ? localSelectedZips.filter((z) => z !== zip)
      : [...localSelectedZips, zip];

    setLocalSelectedZips(newZips);
    startTransition(() => {
      onZipsChange(newZips);
    });
  };

  const toggleLocationSection = (section: string) => {
    setExpandedLocationSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Toggle "Asheville area" location (filtering logic handles Asheville zips automatically)
  const handleAshevilleToggle = () => {
    const isCurrentlySelected = localSelectedLocations.includes("asheville");

    if (isCurrentlySelected) {
      const newLocations = localSelectedLocations.filter(
        (l) => l !== "asheville"
      );
      setLocalSelectedLocations(newLocations);
      startTransition(() => {
        onLocationsChange(newLocations);
      });
    } else {
      const newLocations = [...localSelectedLocations, "asheville"];
      setLocalSelectedLocations(newLocations);
      startTransition(() => {
        onLocationsChange(newLocations);
      });
    }
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  const selectAllTags = () => {
    const newFilters = { include: [...availableTags], exclude: [] };
    setLocalTagFilters(newFilters);
    startTransition(() => {
      onTagFiltersChange(newFilters);
    });
  };

  const deselectAllTags = () => {
    const newFilters = { include: [], exclude: [] };
    setLocalTagFilters(newFilters);
    startTransition(() => {
      onTagFiltersChange(newFilters);
    });
  };

  // Count of active tag filters (include + exclude) - uses local state for instant feedback
  const activeTagCount =
    localTagFilters.include.length + localTagFilters.exclude.length;

  // Group available tags by category
  const groupedTags = TAG_CATEGORIES.map((category) => ({
    ...category,
    availableTags: category.tags.filter((tag) => availableTags.includes(tag)),
  })).filter((cat) => cat.availableTags.length > 0);

  // Note: We no longer show uncategorized tags in the dropdown

  const buttonBaseStyle =
    "flex items-center gap-1 h-8 sm:h-10 px-2 sm:px-2.5 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer";
  const buttonInactiveStyle = `${buttonBaseStyle} border border-gray-200 dark:border-gray-700`;
  const buttonActiveStyle = `${buttonBaseStyle} border-2 border-brand-500 dark:border-brand-400`;

  // Check if filters are active
  const isDateFilterActive =
    localDateFilter !== "all" || localSelectedTimes.length > 0;
  const isPriceFilterActive = localPriceFilter !== "any";
  const isLocationFilterActive =
    localSelectedLocations.length > 0 || localSelectedZips.length > 0;
  const isTagsFilterActive = activeTagCount > 0 || !localShowDailyEvents;

  return (
    <div className="mb-3 px-3 sm:px-0">
      {/* Desktop (>=1153px): single row, Mobile/Tablet: search on top, filters below */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-2">
        {/* Search Input */}
        <div className="relative w-full xl:flex-1 xl:min-w-0">
          <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4 sm:w-5 sm:h-5" />
          <input
            type="text"
            placeholder="Search events..."
            value={localSearchInput}
            onChange={(e) => setLocalSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full h-8 sm:h-10 pl-9 sm:pl-10 pr-9 sm:pr-10 text-xs sm:text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
          />
          {/* Submit button - shows when there's uncommitted text */}
          {hasUncommittedSearch && (
            <button
              onClick={handleSearchSubmit}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-md transition-colors cursor-pointer"
              aria-label="Submit search"
            >
              <ArrowRight size={16} />
            </button>
          )}
          {/* Clear button - shows when search is active and no uncommitted changes */}
          {hasActiveSearch && !hasUncommittedSearch && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors cursor-pointer"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2 flex-wrap xl:flex-nowrap xl:flex-shrink-0">
          {/* Date Filter */}
          <div className="relative" ref={dateRef}>
            <button
              onClick={() => setIsDateOpen(!isDateOpen)}
              className={
                isDateFilterActive ? buttonActiveStyle : buttonInactiveStyle
              }
              aria-expanded={isDateOpen}
              aria-label="Date filter"
            >
              <CalendarIcon size={18} />
              <ChevronDown
                size={14}
                className={`transition-transform ${
                  isDateOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isDateOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[280px]">
                <div className="p-2">
                  {(
                    Object.entries(dateLabels) as [DateFilterType, string][]
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="dateFilter"
                        checked={localDateFilter === value}
                        onChange={() => {
                          setLocalDateFilter(value);
                          startTransition(() => {
                            onDateFilterChange(value);
                          });
                        }}
                        className="w-4 h-4 text-brand-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-200">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>

                {localDateFilter === "dayOfWeek" && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {localSelectedDays.length === 0
                          ? "Select days"
                          : `${localSelectedDays.length} day${
                              localSelectedDays.length !== 1 ? "s" : ""
                            } selected`}
                      </span>
                      {localSelectedDays.length > 0 && (
                        <button
                          onClick={() => {
                            setLocalSelectedDays([]);
                            startTransition(() => {
                              onSelectedDaysChange([]);
                            });
                          }}
                          className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {DAY_NAMES.map((day, index) => {
                        const newDays = localSelectedDays.includes(index)
                          ? localSelectedDays.filter((d) => d !== index)
                          : [...localSelectedDays, index].sort((a, b) => a - b);
                        return (
                          <button
                            key={day}
                            onClick={() => {
                              setLocalSelectedDays(newDays);
                              startTransition(() => {
                                onSelectedDaysChange(newDays);
                              });
                            }}
                            className={`flex-1 py-2 text-xs font-medium rounded transition-colors cursor-pointer ${
                              localSelectedDays.includes(index)
                                ? "bg-brand-600 text-white"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                            }`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {localDateFilter === "custom" && (
                  <div className="border-t border-gray-100 dark:border-gray-700">
                    <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {(() => {
                          const startDate = safeParseDateString(
                            localCustomDateRange.start
                          );
                          const endDate = safeParseDateString(
                            localCustomDateRange.end
                          );
                          if (startDate && endDate) {
                            return `${format(startDate, "MMM d")} - ${format(
                              endDate,
                              "MMM d"
                            )}`;
                          } else if (startDate) {
                            return format(startDate, "MMM d, yyyy");
                          }
                          return "Select dates";
                        })()}
                      </span>
                      {localCustomDateRange.start && (
                        <button
                          onClick={() => {
                            const newRange = { start: null, end: null };
                            setLocalCustomDateRange(newRange);
                            startTransition(() => {
                              onCustomDateRangeChange(newRange);
                            });
                          }}
                          className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <Calendar
                      mode="range"
                      selected={(() => {
                        const from = safeParseDateString(
                          localCustomDateRange.start
                        );
                        if (!from) return undefined;
                        const to = safeParseDateString(
                          localCustomDateRange.end
                        );
                        return { from, to };
                      })()}
                      onSelect={(range: DayPickerDateRange | undefined) => {
                        const newRange = !range
                          ? { start: null, end: null }
                          : {
                              start: range.from
                                ? format(range.from, "yyyy-MM-dd")
                                : null,
                              end: range.to
                                ? format(range.to, "yyyy-MM-dd")
                                : null,
                            };
                        setLocalCustomDateRange(newRange);
                        startTransition(() => {
                          onCustomDateRangeChange(newRange);
                        });
                      }}
                      numberOfMonths={1}
                      disabled={{ before: new Date() }}
                    />
                  </div>
                )}

                {/* Time of Day Filter - always visible */}
                <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {localSelectedTimes.length === 0
                        ? "Time of day"
                        : `${localSelectedTimes.length} time${
                            localSelectedTimes.length !== 1 ? "s" : ""
                          } selected`}
                    </span>
                    {localSelectedTimes.length > 0 && (
                      <button
                        onClick={() => {
                          setLocalSelectedTimes([]);
                          startTransition(() => {
                            onSelectedTimesChange([]);
                          });
                        }}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {TIME_OPTIONS.map((option) => {
                      const isSelected = localSelectedTimes.includes(
                        option.value
                      );
                      const newTimes = isSelected
                        ? localSelectedTimes.filter((t) => t !== option.value)
                        : [...localSelectedTimes, option.value];
                      return (
                        <button
                          key={option.value}
                          onClick={() => {
                            setLocalSelectedTimes(newTimes);
                            startTransition(() => {
                              onSelectedTimesChange(newTimes);
                            });
                          }}
                          className={`w-full py-2 px-3 text-xs font-medium rounded transition-colors cursor-pointer flex items-center justify-between ${
                            isSelected
                              ? "bg-brand-600 text-white"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                          }`}
                        >
                          <span>{option.label}</span>
                          <span
                            className={
                              isSelected
                                ? "text-white/70"
                                : "text-gray-400 dark:text-gray-500"
                            }
                          >
                            {option.timeRange}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Price Filter */}
          <div className="relative" ref={priceRef}>
            <button
              onClick={() => setIsPriceOpen(!isPriceOpen)}
              className={
                isPriceFilterActive ? buttonActiveStyle : buttonInactiveStyle
              }
              aria-expanded={isPriceOpen}
              aria-label="Price filter"
            >
              <DollarSign size={18} />
              <ChevronDown
                size={14}
                className={`transition-transform ${
                  isPriceOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isPriceOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[200px]">
                <div className="p-2">
                  {(
                    Object.entries(priceLabels) as [PriceFilterType, string][]
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="priceFilter"
                        checked={localPriceFilter === value}
                        onChange={() => {
                          setLocalPriceFilter(value);
                          startTransition(() => {
                            onPriceFilterChange(value);
                          });
                        }}
                        className="w-4 h-4 text-brand-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-200">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>

                {localPriceFilter === "custom" && (
                  <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-700">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Maximum Price
                    </label>
                    <div className="relative">
                      <DollarSign
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                        size={14}
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={localCustomMaxPrice ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          const newPrice = val ? parseInt(val, 10) : null;
                          setLocalCustomMaxPrice(newPrice);
                          startTransition(() => {
                            onCustomMaxPriceChange(newPrice);
                          });
                        }}
                        placeholder="Enter amount"
                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded focus:ring-2 focus:ring-brand-500 outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Location Filter */}
          <div className="relative" ref={locationRef}>
            <button
              onClick={handleLocationOpen}
              className={
                isLocationFilterActive ? buttonActiveStyle : buttonInactiveStyle
              }
              aria-expanded={isLocationOpen}
              aria-label="Location filter"
            >
              <MapPin size={18} />
              <ChevronDown
                size={14}
                className={`transition-transform ${
                  isLocationOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isLocationOpen && (
              <div
                className={`absolute top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[240px] max-h-96 flex flex-col ${
                  locationAlign === "center"
                    ? "left-1/2 -translate-x-1/2"
                    : locationAlign === "left"
                      ? "left-0"
                      : "right-0"
                }`}
              >
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllLocations}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-gray-300 dark:text-gray-600">
                        |
                      </span>
                      <button
                        onClick={deselectAllLocations}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    None selected = show all
                  </p>
                </div>

                <div className="overflow-y-auto p-2">
                  {/* Cities Section - Collapsible */}
                  <div className="mb-1">
                    <button
                      onClick={() => toggleLocationSection("cities")}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                    >
                      <span>Cities</span>
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${
                          expandedLocationSections.has("cities")
                            ? "rotate-180"
                            : ""
                        }`}
                      />
                    </button>
                    {expandedLocationSections.has("cities") && (
                      <div className="ml-2 mt-1">
                        {/* Asheville area */}
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={localSelectedLocations.includes(
                              "asheville"
                            )}
                            onChange={handleAshevilleToggle}
                            className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-200">
                            Asheville area
                          </span>
                        </label>

                        {/* Other cities */}
                        {availableLocations
                          .filter(
                            (loc) => loc !== "Asheville" && loc !== "Online"
                          )
                          .map((location) => (
                            <label
                              key={location}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={localSelectedLocations.includes(
                                  location
                                )}
                                onChange={() => toggleLocation(location)}
                                className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-200">
                                {location}
                              </span>
                            </label>
                          ))}

                        {/* Online */}
                        {availableLocations.includes("Online") && (
                          <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={localSelectedLocations.includes(
                                "Online"
                              )}
                              onChange={() => toggleLocation("Online")}
                              className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-200">
                              Online
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Zip Codes Section - Collapsible */}
                  {availableZips.length > 0 && (
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
                      <button
                        onClick={() => toggleLocationSection("zips")}
                        className="w-full flex items-center justify-between px-2 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                      >
                        <span>Zip Codes</span>
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${
                            expandedLocationSections.has("zips")
                              ? "rotate-180"
                              : ""
                          }`}
                        />
                      </button>
                      {expandedLocationSections.has("zips") && (
                        <div className="ml-2 mt-1">
                          {availableZips.map(({ zip }) => (
                            <label
                              key={zip}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={localSelectedZips.includes(zip)}
                                onChange={() => toggleZip(zip)}
                                className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-200">
                                {zip}
                              </span>
                              <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
                                {getZipName(zip)}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {(localSelectedLocations.length > 0 ||
                  localSelectedZips.length > 0) && (
                  <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {localSelectedLocations.length + localSelectedZips.length}{" "}
                      selected
                    </span>
                    <button
                      onClick={deselectAllLocations}
                      className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tags Filter */}
          <div className="relative" ref={tagsRef}>
            <button
              onClick={handleTagsOpen}
              className={
                isTagsFilterActive ? buttonActiveStyle : buttonInactiveStyle
              }
              aria-expanded={isTagsOpen}
              aria-label="Tags filter"
            >
              <Tag size={18} />
              <ChevronDown
                size={14}
                className={`transition-transform ${
                  isTagsOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isTagsOpen && (
              <div
                className={`absolute top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg w-[238px] xl:w-auto xl:min-w-[257px] xl:max-w-[290px] ${
                  tagsAlign === "left" ? "left-0" : "right-0"
                }`}
              >
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllTags}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-gray-300 dark:text-gray-600">
                        |
                      </span>
                      <button
                        onClick={deselectAllTags}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    None selected = show all
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    1 tap to include, 2 to exclude, 3 to clear
                  </p>
                </div>

                {/* Daily Events Toggle */}
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localShowDailyEvents}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        setLocalShowDailyEvents(newValue);
                        startTransition(() => {
                          onShowDailyEventsChange(newValue);
                        });
                      }}
                      className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-200">
                      Show daily recurring events
                    </span>
                  </label>
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {groupedTags.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
                      No tags available
                    </p>
                  ) : (
                    <>
                      {groupedTags.map((category) => (
                        <div
                          key={category.name}
                          className="border-b border-gray-50 dark:border-gray-700 last:border-b-0"
                        >
                          <button
                            onClick={() => toggleCategory(category.name)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                          >
                            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                              {category.name}
                            </span>
                            {expandedCategories.has(category.name) ? (
                              <ChevronUp
                                size={14}
                                className="text-gray-400 dark:text-gray-500"
                              />
                            ) : (
                              <ChevronDown
                                size={14}
                                className="text-gray-400 dark:text-gray-500"
                              />
                            )}
                          </button>
                          {expandedCategories.has(category.name) && (
                            <div className="px-2 pb-2">
                              {category.availableTags.map((tag) => (
                                <TriStateCheckbox
                                  key={tag}
                                  state={getTagState(tag)}
                                  onChange={() => cycleTagState(tag)}
                                  label={tag}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {activeTagCount > 0 && (
                  <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {localTagFilters.include.length > 0 && (
                        <span className="text-green-700 dark:text-green-400">
                          {localTagFilters.include.length} included
                        </span>
                      )}
                      {localTagFilters.include.length > 0 &&
                        localTagFilters.exclude.length > 0 &&
                        ", "}
                      {localTagFilters.exclude.length > 0 && (
                        <span className="text-red-700 dark:text-red-400">
                          {localTagFilters.exclude.length} excluded
                        </span>
                      )}
                    </span>
                    <button
                      onClick={deselectAllTags}
                      className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Keyword Filter Button */}
          <button
            onClick={onOpenSettings}
            className={buttonInactiveStyle}
            aria-label="Keyword settings"
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
