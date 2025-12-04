"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search,
  SlidersHorizontal,
  Tag,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Calendar as CalendarIcon,
  MapPin,
} from "lucide-react";
import { TAG_CATEGORIES } from "@/lib/config/tagCategories";
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
  priceFilter: PriceFilterType;
  onPriceFilterChange: (val: PriceFilterType) => void;
  customMaxPrice: number | null;
  onCustomMaxPriceChange: (val: number | null) => void;
  selectedLocations: string[];
  onLocationsChange: (locations: string[]) => void;
  availableLocations: string[];
  availableTags: string[];
  tagFilters: TagFilterState;
  onTagFiltersChange: (filters: TagFilterState) => void;
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

export default function FilterBar({
  search,
  onSearchChange,
  dateFilter,
  onDateFilterChange,
  customDateRange,
  onCustomDateRangeChange,
  selectedDays,
  onSelectedDaysChange,
  priceFilter,
  onPriceFilterChange,
  customMaxPrice,
  onCustomMaxPriceChange,
  selectedLocations,
  onLocationsChange,
  availableLocations,
  availableTags,
  tagFilters,
  onTagFiltersChange,
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

  // Dropdown alignment state for collision detection
  const [tagsAlign, setTagsAlign] = useState<"left" | "right">("left");
  const [locationAlign, setLocationAlign] = useState<"left" | "right">("left");

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
      const dropdownWidth = 220; // mobile dropdown width
      const wouldOverflow = rect.left + dropdownWidth > window.innerWidth - 16;
      setLocationAlign(wouldOverflow ? "right" : "left");
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

  // Get the current state of a tag filter
  const getTagState = (tag: string): TriState => {
    if (tagFilters.include.includes(tag)) return "include";
    if (tagFilters.exclude.includes(tag)) return "exclude";
    return "off";
  };

  // Cycle through tag states: off -> include -> exclude -> off
  const cycleTagState = (tag: string) => {
    const currentState = getTagState(tag);

    if (currentState === "off") {
      // off -> include
      onTagFiltersChange({
        ...tagFilters,
        include: [...tagFilters.include, tag],
      });
    } else if (currentState === "include") {
      // include -> exclude
      onTagFiltersChange({
        include: tagFilters.include.filter((t) => t !== tag),
        exclude: [...tagFilters.exclude, tag],
      });
    } else {
      // exclude -> off
      onTagFiltersChange({
        ...tagFilters,
        exclude: tagFilters.exclude.filter((t) => t !== tag),
      });
    }
  };

  const toggleLocation = (location: string) => {
    if (selectedLocations.includes(location)) {
      onLocationsChange(selectedLocations.filter((l) => l !== location));
    } else {
      onLocationsChange([...selectedLocations, location]);
    }
  };

  const selectAllLocations = () => {
    // Select "asheville" + all other available locations + "online" if available
    const allLocs = [
      "asheville",
      ...availableLocations.filter((l) => l !== "Asheville"),
    ];
    if (availableLocations.includes("Online")) {
      // Online is already included via availableLocations
    }
    onLocationsChange(allLocs);
  };

  const deselectAllLocations = () => {
    onLocationsChange([]);
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
    onTagFiltersChange({ include: [...availableTags], exclude: [] });
  };

  const deselectAllTags = () => {
    onTagFiltersChange({ include: [], exclude: [] });
  };

  // Count of active tag filters (include + exclude)
  const activeTagCount = tagFilters.include.length + tagFilters.exclude.length;

  // Group available tags by category
  const groupedTags = TAG_CATEGORIES.map((category) => ({
    ...category,
    availableTags: category.tags.filter((tag) => availableTags.includes(tag)),
  })).filter((cat) => cat.availableTags.length > 0);

  // Find uncategorized tags
  const categorizedTags = TAG_CATEGORIES.flatMap((c) => c.tags);
  const uncategorizedTags = availableTags.filter(
    (tag) => !categorizedTags.includes(tag)
  );

  const buttonStyle =
    "flex items-center gap-2 h-10 px-3 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer";

  const getDateLabel = (): string => {
    if (dateFilter === "dayOfWeek" && selectedDays.length > 0) {
      return selectedDays.map((d) => DAY_NAMES[d]).join(", ");
    }
    if (dateFilter === "custom" && customDateRange.start) {
      if (
        customDateRange.end &&
        customDateRange.end !== customDateRange.start
      ) {
        return `${new Date(customDateRange.start).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })} - ${new Date(customDateRange.end).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`;
      }
      return new Date(customDateRange.start).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }
    return dateLabels[dateFilter];
  };

  const getPriceLabel = (): string => {
    if (priceFilter === "custom" && customMaxPrice !== null) {
      return `Under $${customMaxPrice}`;
    }
    return priceLabels[priceFilter];
  };

  const getLocationLabel = (): string => {
    if (selectedLocations.length === 0) return "Location";
    if (selectedLocations.length === 1) {
      const loc = selectedLocations[0];
      if (loc === "asheville") return "Asheville area";
      if (loc === "Online") return "Online";
      return loc;
    }
    return `${selectedLocations.length} locations`;
  };

  return (
    <div className="mb-3 px-3 sm:px-0">
      {/* Desktop (>=1153px): single row, Mobile/Tablet: search on top, filters below */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-2">
        {/* Search Input */}
        <div className="relative w-full xl:flex-1 xl:min-w-0">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={20}
          />
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-10 pl-10 pr-4 text-sm border border-gray-200 bg-white rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2 flex-wrap xl:flex-nowrap xl:flex-shrink-0">
          {/* Date Filter */}
          <div className="relative" ref={dateRef}>
            <button
              onClick={() => setIsDateOpen(!isDateOpen)}
              className={buttonStyle}
              aria-expanded={isDateOpen}
            >
              <CalendarIcon size={16} />
              <span>{getDateLabel()}</span>
              <ChevronDown
                size={16}
                className={`transition-transform ${
                  isDateOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isDateOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[280px]">
                <div className="p-2">
                  {(
                    Object.entries(dateLabels) as [DateFilterType, string][]
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="dateFilter"
                        checked={dateFilter === value}
                        onChange={() => onDateFilterChange(value)}
                        className="w-4 h-4 text-brand-600"
                      />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>

                {dateFilter === "dayOfWeek" && (
                  <div className="border-t border-gray-100 px-3 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500">
                        {selectedDays.length === 0
                          ? "Select days"
                          : `${selectedDays.length} day${
                              selectedDays.length !== 1 ? "s" : ""
                            } selected`}
                      </span>
                      {selectedDays.length > 0 && (
                        <button
                          onClick={() => onSelectedDaysChange([])}
                          className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {DAY_NAMES.map((day, index) => (
                        <button
                          key={day}
                          onClick={() => {
                            if (selectedDays.includes(index)) {
                              onSelectedDaysChange(
                                selectedDays.filter((d) => d !== index)
                              );
                            } else {
                              onSelectedDaysChange(
                                [...selectedDays, index].sort((a, b) => a - b)
                              );
                            }
                          }}
                          className={`flex-1 py-2 text-xs font-medium rounded transition-colors cursor-pointer ${
                            selectedDays.includes(index)
                              ? "bg-brand-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {dateFilter === "custom" && (
                  <div className="border-t border-gray-100">
                    <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {(() => {
                          const startDate = safeParseDateString(
                            customDateRange.start
                          );
                          const endDate = safeParseDateString(
                            customDateRange.end
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
                      {customDateRange.start && (
                        <button
                          onClick={() =>
                            onCustomDateRangeChange({ start: null, end: null })
                          }
                          className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <Calendar
                      mode="range"
                      selected={(() => {
                        const from = safeParseDateString(customDateRange.start);
                        if (!from) return undefined;
                        const to = safeParseDateString(customDateRange.end);
                        return { from, to };
                      })()}
                      onSelect={(range: DayPickerDateRange | undefined) => {
                        if (!range) {
                          onCustomDateRangeChange({ start: null, end: null });
                        } else {
                          onCustomDateRangeChange({
                            start: range.from
                              ? format(range.from, "yyyy-MM-dd")
                              : null,
                            end: range.to
                              ? format(range.to, "yyyy-MM-dd")
                              : null,
                          });
                        }
                      }}
                      numberOfMonths={1}
                      disabled={{ before: new Date() }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Price Filter */}
          <div className="relative" ref={priceRef}>
            <button
              onClick={() => setIsPriceOpen(!isPriceOpen)}
              className={buttonStyle}
              aria-expanded={isPriceOpen}
            >
              <DollarSign size={16} />
              <span>{getPriceLabel()}</span>
              <ChevronDown
                size={16}
                className={`transition-transform ${
                  isPriceOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isPriceOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px]">
                <div className="p-2">
                  {(
                    Object.entries(priceLabels) as [PriceFilterType, string][]
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="priceFilter"
                        checked={priceFilter === value}
                        onChange={() => onPriceFilterChange(value)}
                        className="w-4 h-4 text-brand-600"
                      />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>

                {priceFilter === "custom" && (
                  <div className="px-3 py-3 border-t border-gray-100">
                    <label className="block text-xs text-gray-500 mb-1">
                      Maximum Price
                    </label>
                    <div className="relative">
                      <DollarSign
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                        size={14}
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={customMaxPrice ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          onCustomMaxPriceChange(
                            val ? parseInt(val, 10) : null
                          );
                        }}
                        placeholder="Enter amount"
                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-brand-500 outline-none"
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
              className={buttonStyle}
              aria-expanded={isLocationOpen}
            >
              <MapPin size={16} />
              <span>{getLocationLabel()}</span>
              {selectedLocations.length > 0 && (
                <span className="bg-brand-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {selectedLocations.length}
                </span>
              )}
              <ChevronDown
                size={16}
                className={`transition-transform ${
                  isLocationOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isLocationOpen && (
              <div
                className={`absolute top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[220px] max-h-96 flex flex-col ${
                  locationAlign === "left" ? "left-0" : "right-0"
                }`}
              >
                <div className="px-3 py-2 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllLocations}
                        className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={deselectAllLocations}
                        className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    None selected = show all
                  </p>
                </div>

                <div className="overflow-y-auto p-2">
                  {/* Asheville area */}
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedLocations.includes("asheville")}
                      onChange={() => toggleLocation("asheville")}
                      className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                    />
                    <span className="text-sm text-gray-700">
                      Asheville area
                    </span>
                  </label>

                  {/* Divider and other cities */}
                  {availableLocations.filter(
                    (loc) => loc !== "Asheville" && loc !== "Online"
                  ).length > 0 && (
                    <>
                      <div className="border-t border-gray-100 my-1.5" />
                      {availableLocations
                        .filter(
                          (loc) => loc !== "Asheville" && loc !== "Online"
                        )
                        .map((location) => (
                          <label
                            key={location}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedLocations.includes(location)}
                              onChange={() => toggleLocation(location)}
                              className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                            />
                            <span className="text-sm text-gray-700">
                              {location}
                            </span>
                          </label>
                        ))}
                    </>
                  )}

                  {/* Online option at the end */}
                  {availableLocations.includes("Online") && (
                    <>
                      <div className="border-t border-gray-100 my-1.5" />
                      <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLocations.includes("Online")}
                          onChange={() => toggleLocation("Online")}
                          className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                        />
                        <span className="text-sm text-gray-700">Online</span>
                      </label>
                    </>
                  )}
                </div>

                {selectedLocations.length > 0 && (
                  <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {selectedLocations.length} location
                      {selectedLocations.length !== 1 ? "s" : ""} selected
                    </span>
                    <button
                      onClick={deselectAllLocations}
                      className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
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
              className={buttonStyle}
              aria-expanded={isTagsOpen}
            >
              <Tag size={16} />
              <span>Tags</span>
              {activeTagCount > 0 && (
                <span className="bg-brand-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {activeTagCount}
                </span>
              )}
              <ChevronDown
                size={16}
                className={`transition-transform ${
                  isTagsOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isTagsOpen && (
              <div
                className={`absolute top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-[260px] xl:w-auto xl:min-w-[280px] xl:max-w-[320px] ${
                  tagsAlign === "left" ? "left-0" : "right-0"
                }`}
              >
                <div className="px-3 py-2 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllTags}
                        className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={deselectAllTags}
                        className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    None selected = show all
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    1 click to include, 2 to exclude, 3 to clear
                  </p>
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {groupedTags.length === 0 &&
                  uncategorizedTags.length === 0 ? (
                    <p className="text-sm text-gray-500 px-3 py-2">
                      No tags available
                    </p>
                  ) : (
                    <>
                      {groupedTags.map((category) => (
                        <div
                          key={category.name}
                          className="border-b border-gray-50 last:border-b-0"
                        >
                          <button
                            onClick={() => toggleCategory(category.name)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left"
                          >
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              {category.name}
                            </span>
                            {expandedCategories.has(category.name) ? (
                              <ChevronUp size={14} className="text-gray-400" />
                            ) : (
                              <ChevronDown
                                size={14}
                                className="text-gray-400"
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

                      {uncategorizedTags.length > 0 && (
                        <div className="border-b border-gray-50 last:border-b-0">
                          <button
                            onClick={() => toggleCategory("Uncategorized")}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left"
                          >
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              Other
                            </span>
                            {expandedCategories.has("Uncategorized") ? (
                              <ChevronUp size={14} className="text-gray-400" />
                            ) : (
                              <ChevronDown
                                size={14}
                                className="text-gray-400"
                              />
                            )}
                          </button>
                          {expandedCategories.has("Uncategorized") && (
                            <div className="px-2 pb-2">
                              {uncategorizedTags.map((tag) => (
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
                      )}
                    </>
                  )}
                </div>

                {activeTagCount > 0 && (
                  <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {tagFilters.include.length > 0 && (
                        <span className="text-green-700">
                          {tagFilters.include.length} included
                        </span>
                      )}
                      {tagFilters.include.length > 0 &&
                        tagFilters.exclude.length > 0 &&
                        ", "}
                      {tagFilters.exclude.length > 0 && (
                        <span className="text-red-700">
                          {tagFilters.exclude.length} excluded
                        </span>
                      )}
                    </span>
                    <button
                      onClick={deselectAllTags}
                      className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Keyword Filter Button */}
          <button onClick={onOpenSettings} className={buttonStyle}>
            <SlidersHorizontal size={16} />
            <span>Keyword Filter</span>
          </button>
        </div>
      </div>
    </div>
  );
}
