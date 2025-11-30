"use client";

import FilterChip from "./ui/FilterChip";

export interface ActiveFilter {
  id: string;
  type: "date" | "price" | "tag" | "search" | "location";
  label: string;
}

interface ActiveFiltersProps {
  filters: ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onClearAllTags?: () => void;
  totalEvents: number;
  filteredCount: number;
  exportParams?: string;
}

function ExportLinks({ exportParams }: { exportParams?: string }) {
  return (
    <span className="text-gray-400">
      {" · "}
      <a
        href={`/api/export/xml${exportParams || ""}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-600"
      >
        XML
      </a>
      {" · "}
      <a
        href={`/api/export/markdown${exportParams || ""}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-600"
      >
        Markdown
      </a>
    </span>
  );
}

export default function ActiveFilters({
  filters,
  onRemove,
  onClearAll,
  onClearAllTags,
  totalEvents,
  filteredCount,
  exportParams,
}: ActiveFiltersProps) {
  if (filters.length === 0) {
    return (
      <div className="flex items-center justify-start sm:justify-end text-sm text-gray-500 py-2 pb-3 sm:sticky sm:top-0 sm:z-20 bg-gray-50 px-3 sm:px-0">
        <span>
          Showing {totalEvents} events
          <ExportLinks exportParams={exportParams} />
        </span>
      </div>
    );
  }

  // Separate tag filters from other filters
  const tagFilters = filters.filter((f) => f.type === "tag");
  const otherFilters = filters.filter((f) => f.type !== "tag");

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 sm:sticky sm:top-0 sm:z-20 bg-gray-50 px-3 sm:px-0">
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
        className="text-sm text-brand-600 hover:text-brand-800 hover:underline ml-2 cursor-pointer"
      >
        Clear all
      </button>
      <span className="text-sm text-gray-500 sm:ml-auto">
        Showing {filteredCount} of {totalEvents} events
        <ExportLinks exportParams={exportParams} />
      </span>
    </div>
  );
}
