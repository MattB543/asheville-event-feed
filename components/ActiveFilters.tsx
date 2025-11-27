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
  totalEvents: number;
  filteredCount: number;
}

export default function ActiveFilters({
  filters,
  onRemove,
  onClearAll,
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

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <span className="text-sm text-gray-500">Active filters:</span>
      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            onRemove={() => onRemove(filter.id)}
            variant="active"
          />
        ))}
      </div>
      <button
        onClick={onClearAll}
        className="text-sm text-blue-600 hover:text-blue-800 hover:underline ml-2"
      >
        Clear all
      </button>
      <span className="text-sm text-gray-400 ml-auto">
        Showing {filteredCount} of {totalEvents} events
      </span>
    </div>
  );
}
