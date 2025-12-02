"use client";

import { Sparkles } from "lucide-react";
import FilterChip from "./ui/FilterChip";

export interface ActiveFilter {
  id: string;
  type: "date" | "price" | "tag" | "tag-include" | "tag-exclude" | "search" | "location";
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
  onOpenChat?: () => void;
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

function AskAIButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-md cursor-pointer transition-colors"
    >
      <Sparkles size={14} />
      <span>Ask AI</span>
    </button>
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
  onOpenChat,
}: ActiveFiltersProps) {
  if (filters.length === 0) {
    return (
      <div className="flex items-center justify-start sm:justify-end gap-3 text-sm text-gray-500 py-2 pb-3 sm:sticky sm:top-0 sm:z-20 bg-gray-50 px-3 sm:px-0">
        {onOpenChat && <AskAIButton onClick={onOpenChat} />}
        <span>
          Showing {totalEvents} events
          <ExportLinks exportParams={exportParams} />
        </span>
      </div>
    );
  }

  // Separate tag filters from other filters
  const includeTagFilters = filters.filter((f) => f.type === "tag-include");
  const excludeTagFilters = filters.filter((f) => f.type === "tag-exclude");
  const otherFilters = filters.filter((f) => f.type !== "tag-include" && f.type !== "tag-exclude" && f.type !== "tag");
  const totalTagFilters = includeTagFilters.length + excludeTagFilters.length;

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
          <FilterChip
            label={`${totalTagFilters} tags`}
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
      <div className="flex items-center gap-3 sm:ml-auto">
        {onOpenChat && <AskAIButton onClick={onOpenChat} />}
        <span className="text-sm text-gray-500">
          Showing {filteredCount} of {totalEvents} events
          <ExportLinks exportParams={exportParams} />
        </span>
      </div>
    </div>
  );
}
