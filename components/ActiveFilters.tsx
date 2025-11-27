"use client";

import FilterChip from "./ui/FilterChip";

export interface ActiveFilter {
  id: string;
  type: "date" | "price" | "tag" | "search";
  label: string;
}

interface ActiveFiltersProps {
  filters: ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onClearAllTags?: () => void;
  totalEvents: number;
  filteredCount: number;
}

export default function ActiveFilters({
  filters,
  onRemove,
  onClearAll,
  onClearAllTags,
  totalEvents,
  filteredCount,
}: ActiveFiltersProps) {
  if (filters.length === 0) {
    return (
      <div className="flex items-center justify-between text-sm text-gray-500 py-2">
        <span>Showing {totalEvents} events</span>
      </div>
    );
  }

  // Separate tag filters from other filters
  const tagFilters = filters.filter((f) => f.type === "tag");
  const otherFilters = filters.filter((f) => f.type !== "tag");

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <span className="text-sm text-gray-500">Active filters:</span>
      <div className="flex flex-wrap gap-2">
        {otherFilters.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            onRemove={() => onRemove(filter.id)}
            variant="active"
          />
        ))}
        {tagFilters.length > 0 && tagFilters.length <= 5 ? (
          tagFilters.map((filter) => (
            <FilterChip
              key={filter.id}
              label={filter.label}
              onRemove={() => onRemove(filter.id)}
              variant="active"
            />
          ))
        ) : tagFilters.length > 5 ? (
          <FilterChip
            label={`${tagFilters.length} tags`}
            onRemove={onClearAllTags}
            variant="active"
          />
        ) : null}
      </div>
      <button
        onClick={onClearAll}
        className="text-sm text-blue-600 hover:text-blue-800 hover:underline ml-2 cursor-pointer"
      >
        Clear all
      </button>
      <span className="text-sm text-gray-400 ml-auto">
        Showing {filteredCount} of {totalEvents} events
      </span>
    </div>
  );
}
