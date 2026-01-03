'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Search,
  SlidersHorizontal,
  ArrowRight,
  X,
  Share,
  Sparkles,
  Link,
  FileText,
  FileCode,
} from 'lucide-react';
import { useToast } from './ui/Toast';

// Re-export types for backwards compatibility
export type DateFilterType = 'all' | 'today' | 'tomorrow' | 'weekend' | 'dayOfWeek' | 'custom';
export type PriceFilterType = 'any' | 'free' | 'under20' | 'under100' | 'custom';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface FilterBarProps {
  search: string;
  onSearchChange: (val: string) => void;
  dateFilter: DateFilterType;
  customDateRange: DateRange;
  selectedDays: number[];
  selectedTimes: TimeOfDay[];
  priceFilter: PriceFilterType;
  customMaxPrice: number | null;
  selectedLocations: string[];
  selectedZips: string[];
  tagFilters: { include: string[]; exclude: string[] };
  showDailyEvents: boolean;
  onOpenFilters: () => void;
  // Share & AI props
  exportParams?: string;
  shareParams?: string;
  onOpenChat?: () => void;
  /** When true, simplifies the display (for Top 30 tab) */
  simplified?: boolean;
}

export default function FilterBar({
  search,
  onSearchChange,
  dateFilter,
  customDateRange,
  selectedDays,
  selectedTimes,
  priceFilter,
  customMaxPrice,
  selectedLocations,
  selectedZips,
  tagFilters,
  showDailyEvents,
  onOpenFilters,
  exportParams,
  shareParams,
  onOpenChat,
}: FilterBarProps) {
  const { showToast } = useToast();
  const [localSearchInput, setLocalSearchInput] = useState(search);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  // Sync local state with props when they change externally
  useEffect(() => {
    setLocalSearchInput(search);
  }, [search]);

  // Close share menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(event.target as Node)) {
        setShareMenuOpen(false);
      }
    }

    if (shareMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [shareMenuOpen]);

  // Search submit handler
  const handleSearchSubmit = () => {
    if (localSearchInput !== search) {
      onSearchChange(localSearchInput);
    }
  };

  // Handle Enter key to submit search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchSubmit();
    }
  };

  // Clear search
  const handleClearSearch = () => {
    setLocalSearchInput('');
    onSearchChange('');
  };

  // Copy share link
  const handleCopyView = async () => {
    const url = `${window.location.origin}${window.location.pathname}${shareParams || ''}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard!');
      setShareMenuOpen(false);
    } catch {
      showToast('Failed to copy link', 'error');
    }
  };

  // Whether there are uncommitted search changes
  const hasUncommittedSearch = localSearchInput !== search && localSearchInput.length > 0;
  // Whether search is currently active (has committed value)
  const hasActiveSearch = search.length > 0;

  // Calculate active filter count for badge
  const activeFilterCount = calculateActiveFilters({
    dateFilter,
    customDateRange,
    selectedDays,
    selectedTimes,
    priceFilter,
    customMaxPrice,
    selectedLocations,
    selectedZips,
    tagFilters,
    showDailyEvents,
  });

  const buttonBaseStyle =
    'flex items-center justify-center h-9 sm:h-10 rounded-lg transition-colors cursor-pointer bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700';

  return (
    <div className="mb-6 px-3 sm:px-0">
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
          <input
            type="text"
            placeholder="Search events..."
            value={localSearchInput}
            onChange={(e) => setLocalSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full h-9 sm:h-10 pl-9 sm:pl-10 pr-9 sm:pr-10 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
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

        {/* Filter Button */}
        <button
          onClick={onOpenFilters}
          className={`${buttonBaseStyle} px-2.5 sm:px-3 ${
            activeFilterCount > 0 ? '!border-brand-500 dark:!border-brand-400' : ''
          }`}
          aria-label="Open filters"
        >
          <SlidersHorizontal size={18} />
          {activeFilterCount > 0 && (
            <span className="ml-1.5 text-sm font-medium text-brand-600 dark:text-brand-400">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Share Button */}
        <div className="relative" ref={shareMenuRef}>
          <button
            onClick={() => setShareMenuOpen(!shareMenuOpen)}
            className={`${buttonBaseStyle} px-2.5 sm:px-3`}
            aria-label="Share & Export"
          >
            <Share size={16} />
          </button>

          {shareMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[220px]">
              <button
                onClick={shareParams ? () => void handleCopyView() : undefined}
                disabled={!shareParams}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left ${
                  shareParams
                    ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
                    : 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                }`}
              >
                <Link size={14} className="mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-medium">Copy filtered view</div>
                  <div
                    className={`text-[10px] ${
                      shareParams
                        ? 'text-gray-500 dark:text-gray-400'
                        : 'text-gray-400 dark:text-gray-600'
                    }`}
                  >
                    {shareParams
                      ? 'Share link with your current filters'
                      : 'Apply filters to enable sharing'}
                  </div>
                </div>
              </button>
              <a
                href={`/api/export/json${exportParams || ''}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShareMenuOpen(false)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                <FileCode size={14} className="mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-medium">View as JSON</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    Open filtered view in JSON
                  </div>
                </div>
              </a>
              <a
                href={`/api/export/markdown${exportParams || ''}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShareMenuOpen(false)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                <FileText size={14} className="mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-medium">View as Markdown</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    Open filtered view in Markdown
                  </div>
                </div>
              </a>
            </div>
          )}
        </div>

        {/* Ask AI Button */}
        {onOpenChat && (
          <button
            onClick={onOpenChat}
            className={`${buttonBaseStyle} px-2.5 gap-1`}
            aria-label="Ask AI"
          >
            <Sparkles size={15} />
            <span className="hidden sm:inline text-sm">Ask AI</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Helper to count active filters
function calculateActiveFilters({
  dateFilter,
  customDateRange,
  selectedDays,
  selectedTimes,
  priceFilter,
  customMaxPrice,
  selectedLocations,
  selectedZips,
  tagFilters,
  showDailyEvents,
}: {
  dateFilter: DateFilterType;
  customDateRange: DateRange;
  selectedDays: number[];
  selectedTimes: TimeOfDay[];
  priceFilter: PriceFilterType;
  customMaxPrice: number | null;
  selectedLocations: string[];
  selectedZips: string[];
  tagFilters: { include: string[]; exclude: string[] };
  showDailyEvents: boolean;
}): number {
  let count = 0;

  // Date filter
  if (dateFilter !== 'all') count++;
  if (dateFilter === 'dayOfWeek' && selectedDays.length > 0) count++;
  if (dateFilter === 'custom' && (customDateRange.start || customDateRange.end)) count++;

  // Time filter
  if (selectedTimes.length > 0) count++;

  // Price filter
  if (priceFilter !== 'any') count++;
  if (priceFilter === 'custom' && customMaxPrice !== null) count++;

  // Location filter
  if (selectedLocations.length > 0 || selectedZips.length > 0) count++;

  // Tag filter
  if (tagFilters.include.length > 0 || tagFilters.exclude.length > 0) count++;

  // Daily events (hidden = counts as filter)
  if (!showDailyEvents) count++;

  return count;
}
