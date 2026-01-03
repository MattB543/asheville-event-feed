'use client';

import FilterChip from './ui/FilterChip';

export interface ActiveFilter {
  id: string;
  type:
    | 'date'
    | 'time'
    | 'price'
    | 'tag'
    | 'tag-include'
    | 'tag-exclude'
    | 'search'
    | 'location'
    | 'zip';
  label: string;
}

interface ActiveFiltersProps {
  filters: ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onClearAllTags?: () => void;
  isPending?: boolean;
}

export default function ActiveFilters({
  filters,
  onRemove,
  onClearAll,
  onClearAllTags,
  isPending,
}: ActiveFiltersProps) {
  if (filters.length === 0) {
    // Show filtering indicator only when pending
    if (isPending) {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2 pb-3 px-3 sm:px-0">
          <span className="inline-flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
            <span>Filtering...</span>
          </span>
        </div>
      );
    }
    return null;
  }

  // Separate tag filters and location filters from other filters
  const includeTagFilters = filters.filter((f) => f.type === 'tag-include');
  const excludeTagFilters = filters.filter((f) => f.type === 'tag-exclude');
  const locationFilters = filters.filter((f) => f.type === 'location' || f.type === 'zip');
  const otherFilters = filters.filter(
    (f) =>
      f.type !== 'tag-include' &&
      f.type !== 'tag-exclude' &&
      f.type !== 'tag' &&
      f.type !== 'location' &&
      f.type !== 'zip'
  );
  const totalTagFilters = includeTagFilters.length + excludeTagFilters.length;
  const totalLocationFilters = locationFilters.length;

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 px-3 sm:px-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">Active filters:</span>
      {otherFilters.map((filter) => (
        <FilterChip
          key={filter.id}
          label={filter.label}
          onRemove={() => onRemove(filter.id)}
          variant="active"
        />
      ))}
      {/* Show individual location chips if 3 or fewer, otherwise summarize */}
      {totalLocationFilters > 0 && totalLocationFilters <= 3 ? (
        locationFilters.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            onRemove={() => onRemove(filter.id)}
            variant="active"
          />
        ))
      ) : totalLocationFilters > 3 ? (
        <FilterChip
          label={`${totalLocationFilters} locations`}
          onRemove={() => locationFilters.forEach((f) => onRemove(f.id))}
          variant="active"
        />
      ) : null}
      {/* Show individual tag chips if 5 or fewer total tags, otherwise summarize */}
      {totalTagFilters > 0 && totalTagFilters <= 5 ? (
        <>
          {includeTagFilters.map((filter) => (
            <FilterChip
              key={filter.id}
              label={filter.label}
              onRemove={() => onRemove(filter.id)}
              variant="include"
            />
          ))}
          {excludeTagFilters.map((filter) => (
            <FilterChip
              key={filter.id}
              label={filter.label}
              onRemove={() => onRemove(filter.id)}
              variant="exclude"
            />
          ))}
        </>
      ) : totalTagFilters > 5 ? (
        <FilterChip label={`${totalTagFilters} tags`} onRemove={onClearAllTags} variant="active" />
      ) : null}
      <button
        onClick={onClearAll}
        className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 hover:underline cursor-pointer"
      >
        Clear all
      </button>
      {isPending && (
        <span className="inline-flex items-center gap-2 ml-auto text-sm text-gray-500 dark:text-gray-400">
          <span className="w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
          <span>Filtering...</span>
        </span>
      )}
    </div>
  );
}
