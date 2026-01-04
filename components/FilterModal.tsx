'use client';

import { useState, useEffect, useTransition, useRef } from 'react';
import {
  X,
  Calendar as CalendarIcon,
  DollarSign,
  MapPin,
  Tag,
  Ban,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import { TAG_CATEGORIES } from '@/lib/config/tagCategories';
import { getZipName } from '@/lib/config/zipNames';
import { Calendar } from './ui/Calendar';
import { type DateRange as DayPickerDateRange } from 'react-day-picker';
import { format, parse, isValid } from 'date-fns';
import TriStateCheckbox, { type TriState } from './ui/TriStateCheckbox';
import ChipInput from './ui/ChipInput';
import PriceSlider, { filterStateToSliderValue, sliderValueToFilterState } from './ui/PriceSlider';

// Safe date parsing helper
function safeParseDateString(dateStr: string | null): Date | undefined {
  if (!dateStr) return undefined;
  try {
    const parsed = parse(dateStr, 'yyyy-MM-dd', new Date());
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

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

interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

export interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Date filters
  dateFilter: DateFilterType;
  onDateFilterChange: (val: DateFilterType) => void;
  customDateRange: DateRange;
  onCustomDateRangeChange: (range: DateRange) => void;
  selectedDays: number[];
  onSelectedDaysChange: (days: number[]) => void;
  selectedTimes: TimeOfDay[];
  onSelectedTimesChange: (times: TimeOfDay[]) => void;
  // Price filters
  priceFilter: PriceFilterType;
  onPriceFilterChange: (val: PriceFilterType) => void;
  customMaxPrice: number | null;
  onCustomMaxPriceChange: (val: number | null) => void;
  // Location filters
  selectedLocations: string[];
  onLocationsChange: (locations: string[]) => void;
  availableLocations: string[];
  selectedZips: string[];
  onZipsChange: (zips: string[]) => void;
  availableZips: { zip: string; count: number }[];
  // Tag filters
  availableTags: string[];
  tagFilters: TagFilterState;
  onTagFiltersChange: (filters: TagFilterState) => void;
  showDailyEvents: boolean;
  onShowDailyEventsChange: (show: boolean) => void;
  // Keyword filters (from SettingsModal)
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: HiddenEventFingerprint[];
  onUpdateHosts: (hosts: string[]) => void;
  onUpdateKeywords: (keywords: string[]) => void;
  onUpdateHiddenEvents: (events: HiddenEventFingerprint[]) => void;
  defaultFilterKeywords: string[];
}

const dateLabels: Record<DateFilterType, string> = {
  all: 'All Dates',
  today: 'Today',
  tomorrow: 'Tomorrow',
  weekend: 'This Weekend',
  dayOfWeek: 'Day of Week',
  custom: 'Custom Dates',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_OPTIONS: { value: TimeOfDay; label: string; timeRange: string }[] = [
  { value: 'morning', label: 'Morning', timeRange: '5 AM - Noon' },
  { value: 'afternoon', label: 'Afternoon', timeRange: 'Noon - 5 PM' },
  { value: 'evening', label: 'Evening', timeRange: '5 PM - 3 AM' },
];

export default function FilterModal({
  isOpen,
  onClose,
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
  blockedHosts,
  blockedKeywords,
  hiddenEvents,
  onUpdateHosts,
  onUpdateKeywords,
  onUpdateHiddenEvents,
  defaultFilterKeywords,
}: FilterModalProps) {
  const [, startTransition] = useTransition();

  // Local optimistic state
  const [localDateFilter, setLocalDateFilter] = useState(dateFilter);
  const [localCustomDateRange, setLocalCustomDateRange] = useState(customDateRange);
  const [localSelectedDays, setLocalSelectedDays] = useState(selectedDays);
  const [localSelectedTimes, setLocalSelectedTimes] = useState(selectedTimes);
  const [localPriceValue, setLocalPriceValue] = useState(() =>
    filterStateToSliderValue(priceFilter, customMaxPrice)
  );
  const [localSelectedLocations, setLocalSelectedLocations] = useState(selectedLocations);
  const [localSelectedZips, setLocalSelectedZips] = useState(selectedZips);
  const [localTagFilters, setLocalTagFilters] = useState(tagFilters);
  const [localShowDailyEvents, setLocalShowDailyEvents] = useState(showDailyEvents);

  // UI state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(TAG_CATEGORIES.map((c) => c.name))
  );
  const [expandedLocationSections, setExpandedLocationSections] = useState<Set<string>>(new Set());
  const [showDefaultKeywords, setShowDefaultKeywords] = useState(false);
  const [showHiddenEvents, setShowHiddenEvents] = useState(false);

  // Sync local state with props
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
    setLocalPriceValue(filterStateToSliderValue(priceFilter, customMaxPrice));
  }, [priceFilter, customMaxPrice]);

  // Track if user clicked "Deselect All" (to prevent sync from resetting)
  const isNoneSelectedModeRef = useRef(false);

  useEffect(() => {
    // Don't sync if we're in "none selected" mode and parent is empty
    if (isNoneSelectedModeRef.current && selectedLocations.length === 0) {
      return;
    }
    isNoneSelectedModeRef.current = false;
    setLocalSelectedLocations(selectedLocations);
  }, [selectedLocations]);

  useEffect(() => {
    setLocalSelectedZips(selectedZips);
  }, [selectedZips]);

  useEffect(() => {
    setLocalTagFilters(tagFilters);
  }, [tagFilters]);

  useEffect(() => {
    setLocalShowDailyEvents(showDailyEvents);
  }, [showDailyEvents]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Tag helpers
  const getTagState = (tag: string): TriState => {
    if (localTagFilters.include.includes(tag)) return 'include';
    if (localTagFilters.exclude.includes(tag)) return 'exclude';
    return 'off';
  };

  const cycleTagState = (tag: string) => {
    const currentState = getTagState(tag);
    let newFilters: TagFilterState;

    if (currentState === 'off') {
      newFilters = {
        ...localTagFilters,
        include: [...localTagFilters.include, tag],
      };
    } else if (currentState === 'include') {
      newFilters = {
        include: localTagFilters.include.filter((t) => t !== tag),
        exclude: [...localTagFilters.exclude, tag],
      };
    } else {
      newFilters = {
        ...localTagFilters,
        exclude: localTagFilters.exclude.filter((t) => t !== tag),
      };
    }

    setLocalTagFilters(newFilters);
    startTransition(() => {
      onTagFiltersChange(newFilters);
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

  // Location helpers
  // Build the full list of all location keys
  const allLocationKeys = ['asheville', ...availableLocations.filter((l) => l !== 'Asheville')];

  // Special marker for "none selected" state (visually all unchecked, but no filter applied)
  const NONE_SELECTED_MARKER = '__none__';
  const isNoneSelected =
    localSelectedLocations.length === 1 && localSelectedLocations[0] === NONE_SELECTED_MARKER;

  // Empty array means "all selected" (no filter), marker means "none selected" (also no filter)
  const isAllLocationsSelected = localSelectedLocations.length === 0;
  const hasNoLocationFilter = isAllLocationsSelected || isNoneSelected;

  // Check if a location is selected (empty = all selected, marker = none selected)
  const isLocationSelected = (location: string) => {
    if (isNoneSelected) return false;
    if (isAllLocationsSelected) return true;
    return localSelectedLocations.includes(location);
  };

  const toggleLocation = (location: string) => {
    let newLocations: string[];

    // Clear the "none selected" mode when user interacts
    isNoneSelectedModeRef.current = false;

    if (isNoneSelected) {
      // Currently none selected, user is checking one → set to just that one
      newLocations = [location];
    } else if (isAllLocationsSelected) {
      // Currently all selected, user is unchecking one → set to all EXCEPT this one
      newLocations = allLocationKeys.filter((l) => l !== location);
    } else if (localSelectedLocations.includes(location)) {
      // Unchecking - remove from list
      newLocations = localSelectedLocations.filter((l) => l !== location);
      // If none left, set to marker (none selected = no filter)
      if (newLocations.length === 0) {
        newLocations = [NONE_SELECTED_MARKER];
      }
    } else {
      // Checking - add to list
      newLocations = [...localSelectedLocations, location];
      // If all are now selected, set to empty (meaning "all")
      if (
        newLocations.length === allLocationKeys.length &&
        allLocationKeys.every((l) => newLocations.includes(l))
      ) {
        newLocations = [];
      }
    }

    setLocalSelectedLocations(newLocations);
    startTransition(() => {
      // Pass empty array to parent if it's the marker (no filter either way)
      onLocationsChange(newLocations[0] === NONE_SELECTED_MARKER ? [] : newLocations);
    });
  };

  const handleAshevilleToggle = () => {
    toggleLocation('asheville');
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

  const selectAllLocations = () => {
    // Empty array means all selected
    setLocalSelectedLocations([]);
    startTransition(() => {
      onLocationsChange([]);
    });
  };

  const deselectAllLocations = () => {
    // Set to marker meaning "none selected" (visually unchecked, but no filter)
    isNoneSelectedModeRef.current = true;
    setLocalSelectedLocations([NONE_SELECTED_MARKER]);
    setLocalSelectedZips([]);
    startTransition(() => {
      // Pass empty to parent - no filter applied
      onLocationsChange([]);
      onZipsChange([]);
    });
  };

  // Group available tags by category
  const groupedTags = TAG_CATEGORIES.map((category) => ({
    ...category,
    availableTags: category.tags.filter((tag) => availableTags.includes(tag)),
  })).filter((cat) => cat.availableTags.length > 0);

  const activeTagCount = localTagFilters.include.length + localTagFilters.exclude.length;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 w-full h-full md:h-auto md:max-h-[90vh] md:max-w-2xl md:mx-4 md:rounded-xl shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 sticky top-0 z-10">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Filters</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors cursor-pointer"
            aria-label="Close filters"
          >
            <X size={24} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Date Filter Section */}
          <section className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-4">
              <CalendarIcon size={20} className="text-brand-600 dark:text-brand-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Date</h3>
            </div>

            <div>
              {(Object.entries(dateLabels) as [DateFilterType, string][]).map(([value, label]) => (
                <label
                  key={value}
                  className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
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
                  <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
                </label>
              ))}
            </div>

            {/* Day of Week selector */}
            {localDateFilter === 'dayOfWeek' && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {localSelectedDays.length === 0
                      ? 'Select days'
                      : `${localSelectedDays.length} day${localSelectedDays.length !== 1 ? 's' : ''} selected`}
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
                            ? 'bg-brand-600 text-white'
                            : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom date range */}
            {localDateFilter === 'custom' && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {(() => {
                      const startDate = safeParseDateString(localCustomDateRange.start);
                      const endDate = safeParseDateString(localCustomDateRange.end);
                      if (startDate && endDate) {
                        return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d')}`;
                      } else if (startDate) {
                        return format(startDate, 'MMM d, yyyy');
                      }
                      return 'Select dates';
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
                    const from = safeParseDateString(localCustomDateRange.start);
                    if (!from) return undefined;
                    const to = safeParseDateString(localCustomDateRange.end);
                    return { from, to };
                  })()}
                  onSelect={(range: DayPickerDateRange | undefined) => {
                    const newRange = !range
                      ? { start: null, end: null }
                      : {
                          start: range.from ? format(range.from, 'yyyy-MM-dd') : null,
                          end: range.to ? format(range.to, 'yyyy-MM-dd') : null,
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

            {/* Time of Day */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Time of Day
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
              <div className="grid grid-cols-3 gap-1">
                {TIME_OPTIONS.map((option) => {
                  const isSelected = localSelectedTimes.includes(option.value);
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
                      className={`py-2 px-1 text-xs font-medium rounded border transition-colors cursor-pointer flex flex-col items-center ${
                        isSelected
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                      }`}
                    >
                      <span>{option.label}</span>
                      <span
                        className={`text-[10px] ${
                          isSelected ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {option.timeRange}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Tags Filter Section */}
          <section className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-4">
              <Tag size={20} className="text-brand-600 dark:text-brand-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tags</h3>
            </div>

            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-2">
                <button
                  onClick={selectAllTags}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                >
                  Select All
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  onClick={deselectAllTags}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                >
                  Deselect All
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              1 tap to include, 2 to exclude, 3 to clear
            </p>

            {/* Daily Events Toggle */}
            <label className="flex items-center gap-3 p-2 mb-3 bg-gray-50 dark:bg-gray-800 rounded-lg cursor-pointer">
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

            {/* Tag Categories */}
            {groupedTags.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 p-2">No tags available</p>
            ) : (
              <div className="space-y-2">
                {groupedTags.map((category) => (
                  <div
                    key={category.name}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setExpandedCategories((prev) => {
                          const next = new Set(prev);
                          if (next.has(category.name)) {
                            next.delete(category.name);
                          } else {
                            next.add(category.name);
                          }
                          return next;
                        });
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-left cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {category.name}
                      </span>
                      {expandedCategories.has(category.name) ? (
                        <ChevronUp size={16} className="text-gray-400 dark:text-gray-500" />
                      ) : (
                        <ChevronDown size={16} className="text-gray-400 dark:text-gray-500" />
                      )}
                    </button>
                    {expandedCategories.has(category.name) && (
                      <div className="px-2 pb-2 grid grid-cols-2 gap-1">
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
              </div>
            )}

            {activeTagCount > 0 && (
              <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {localTagFilters.include.length > 0 && (
                    <span className="text-green-700 dark:text-green-400">
                      {localTagFilters.include.length} included
                    </span>
                  )}
                  {localTagFilters.include.length > 0 && localTagFilters.exclude.length > 0 && ', '}
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
          </section>

          {/* Price Filter Section */}
          <section className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign size={20} className="text-brand-600 dark:text-brand-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Price</h3>
            </div>

            <PriceSlider
              value={localPriceValue}
              onChange={(value) => {
                setLocalPriceValue(value);
                const { priceFilter: newPriceFilter, customMaxPrice: newCustomMaxPrice } =
                  sliderValueToFilterState(value);
                startTransition(() => {
                  onPriceFilterChange(newPriceFilter);
                  onCustomMaxPriceChange(newCustomMaxPrice);
                });
              }}
            />
          </section>

          {/* Location Filter Section */}
          <section className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={20} className="text-brand-600 dark:text-brand-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Location</h3>
            </div>

            <div className="flex gap-2 mb-3">
              <button
                onClick={selectAllLocations}
                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
              >
                Select All
              </button>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <button
                onClick={deselectAllLocations}
                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
              >
                Deselect All
              </button>
            </div>

            {/* Cities */}
            <div className="mb-2">
              <button
                onClick={() => {
                  setExpandedLocationSections((prev) => {
                    const next = new Set(prev);
                    if (next.has('cities')) {
                      next.delete('cities');
                    } else {
                      next.add('cities');
                    }
                    return next;
                  });
                }}
                className="w-full flex items-center justify-between p-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer"
              >
                <span>Cities</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${
                    expandedLocationSections.has('cities') ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {expandedLocationSections.has('cities') && (
                <div className="ml-2 mt-1 space-y-0.5">
                  <label className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isLocationSelected('asheville')}
                      onChange={handleAshevilleToggle}
                      className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-200">Asheville area</span>
                  </label>

                  {availableLocations
                    .filter((loc) => loc !== 'Asheville' && loc !== 'Online')
                    .map((location) => (
                      <label
                        key={location}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isLocationSelected(location)}
                          onChange={() => toggleLocation(location)}
                          className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-200">{location}</span>
                      </label>
                    ))}

                  {availableLocations.includes('Online') && (
                    <label className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isLocationSelected('Online')}
                        onChange={() => toggleLocation('Online')}
                        className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-200">Online</span>
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Zip Codes */}
            {availableZips.length > 0 && (
              <div>
                <button
                  onClick={() => {
                    setExpandedLocationSections((prev) => {
                      const next = new Set(prev);
                      if (next.has('zips')) {
                        next.delete('zips');
                      } else {
                        next.add('zips');
                      }
                      return next;
                    });
                  }}
                  className="w-full flex items-center justify-between p-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer"
                >
                  <span>Zip Codes</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform ${
                      expandedLocationSections.has('zips') ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {expandedLocationSections.has('zips') && (
                  <div className="ml-2 mt-1 space-y-0.5">
                    {availableZips.map(({ zip }) => (
                      <label
                        key={zip}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={localSelectedZips.includes(zip)}
                          onChange={() => toggleZip(zip)}
                          className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-200">{zip}</span>
                        <span className="text-sm text-gray-400 dark:text-gray-500 ml-auto">
                          {getZipName(zip)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Show filter summary when locations are filtered (some but not all/none selected) or zips are selected */}
            {((!hasNoLocationFilter && localSelectedLocations.length > 0) ||
              localSelectedZips.length > 0) && (
              <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {!hasNoLocationFilter && localSelectedLocations.length > 0
                    ? `${localSelectedLocations.length} of ${allLocationKeys.length} cities`
                    : ''}
                  {!hasNoLocationFilter &&
                  localSelectedLocations.length > 0 &&
                  localSelectedZips.length > 0
                    ? ', '
                    : ''}
                  {localSelectedZips.length > 0
                    ? `${localSelectedZips.length} zip${localSelectedZips.length !== 1 ? 's' : ''}`
                    : ''}
                </span>
                <button
                  onClick={() => {
                    selectAllLocations();
                    setLocalSelectedZips([]);
                    startTransition(() => {
                      onZipsChange([]);
                    });
                  }}
                  className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}
          </section>

          {/* Keyword Filters Section */}
          <section className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Ban size={20} className="text-brand-600 dark:text-brand-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Keyword Filters
              </h3>
            </div>

            {/* Default Filters Info */}
            <div className="p-4 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800 rounded-lg mb-4">
              <h4 className="font-medium text-brand-900 dark:text-brand-200">Spam Filter</h4>
              <p className="text-sm text-brand-700 dark:text-brand-400 mt-1">
                Certification training, self-guided tours, and other low-quality events are
                automatically hidden.
              </p>

              <button
                onClick={() => setShowDefaultKeywords(!showDefaultKeywords)}
                className="flex items-center gap-1 text-sm text-brand-700 dark:text-brand-400 hover:text-brand-900 dark:hover:text-brand-300 mt-3 cursor-pointer"
              >
                {showDefaultKeywords ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showDefaultKeywords ? 'Hide' : 'View'} blocked keywords (
                {defaultFilterKeywords.length})
              </button>

              {showDefaultKeywords && (
                <div className="mt-2 max-h-40 overflow-y-auto p-2 bg-white dark:bg-gray-800 rounded border border-brand-200 dark:border-brand-800 text-xs text-gray-600 dark:text-gray-300">
                  <div className="flex flex-wrap gap-1">
                    {defaultFilterKeywords.map((kw, i) => (
                      <span
                        key={i}
                        className="inline-block bg-brand-100 dark:bg-brand-900/50 text-brand-800 dark:text-brand-300 px-2 py-0.5 rounded"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Blocked Keywords */}
            <div className="mb-4">
              <ChipInput
                label="Blocked Keywords"
                values={blockedKeywords}
                onChange={onUpdateKeywords}
                placeholder="Type keyword and press Enter..."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Events with these words in the title will be hidden
              </p>
            </div>

            {/* Blocked Hosts */}
            <div className="mb-4">
              <ChipInput
                label="Blocked Hosts"
                values={blockedHosts}
                onChange={onUpdateHosts}
                placeholder="Type host name and press Enter..."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                All events from these organizers will be hidden
              </p>
            </div>

            {/* Hidden Events */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  You have hidden <strong>{hiddenEvents.length}</strong> event pattern
                  {hiddenEvents.length !== 1 ? 's' : ''}.
                </span>
                {hiddenEvents.length > 0 && (
                  <button
                    onClick={() => onUpdateHiddenEvents([])}
                    className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-medium cursor-pointer"
                  >
                    <Trash2 size={16} />
                    Clear All
                  </button>
                )}
              </div>

              {hiddenEvents.length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowHiddenEvents(!showHiddenEvents)}
                    className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
                  >
                    {showHiddenEvents ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {showHiddenEvents ? 'Hide' : 'View'} hidden events
                  </button>

                  {showHiddenEvents && (
                    <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                      {hiddenEvents.map((event, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-700 dark:text-gray-200 truncate">
                              {event.title}
                            </div>
                            {event.organizer && (
                              <div className="text-gray-500 dark:text-gray-400 truncate">
                                by {event.organizer}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              onUpdateHiddenEvents(hiddenEvents.filter((_, idx) => idx !== i));
                            }}
                            className="ml-2 p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded cursor-pointer"
                            title="Unhide this event"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Hidden events are matched by title + organizer, so recurring events stay hidden.
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-brand-600 text-white hover:bg-brand-700 rounded-lg transition-colors font-medium cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
