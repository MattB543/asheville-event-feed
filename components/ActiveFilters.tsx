"use client";

import { Sparkles } from "lucide-react";
import FilterChip from "./ui/FilterChip";
import { useToast } from "./ui/Toast";

// Format large numbers compactly: 1303 → "1.3k"
function formatCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return n.toString();
}

export interface ActiveFilter {
  id: string;
  type:
    | "date"
    | "time"
    | "price"
    | "tag"
    | "tag-include"
    | "tag-exclude"
    | "search"
    | "location";
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
  shareParams?: string;
  onOpenChat?: () => void;
  isPending?: boolean;
}

function ExportLinks({
  exportParams,
  shareParams,
}: {
  exportParams?: string;
  shareParams?: string;
}) {
  const { showToast } = useToast();

  const handleCopyView = async () => {
    const url = `${window.location.origin}${window.location.pathname}${
      shareParams || ""
    }`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard!");
    } catch {
      showToast("Failed to copy link", "error");
    }
  };

  return (
    <span className="text-gray-400 dark:text-gray-500">
      {shareParams && (
        <>
          {" · "}
          <button
            onClick={handleCopyView}
            className="underline hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
          >
            Copy View
          </button>
        </>
      )}
      {" · "}
      <a
        href={`/api/export/xml${exportParams || ""}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-600 dark:hover:text-gray-300"
      >
        XML
      </a>
      {" · "}
      <a
        href={`/api/export/markdown${exportParams || ""}`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-600 dark:hover:text-gray-300"
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
      className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-md cursor-pointer transition-colors shrink-0"
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
  shareParams,
  onOpenChat,
  isPending,
}: ActiveFiltersProps) {
  if (filters.length === 0) {
    return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-end gap-2 sm:gap-3 text-sm text-gray-500 dark:text-gray-400 py-2 pb-3 sm:sticky sm:top-0 sm:z-20 bg-gray-50 dark:bg-gray-950 px-3 sm:px-0">
        {onOpenChat && <AskAIButton onClick={onOpenChat} />}
        <span>
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
              <span>Filtering...</span>
            </span>
          ) : (
            <>Showing {totalEvents} events</>
          )}
          <ExportLinks exportParams={exportParams} shareParams={shareParams} />
        </span>
      </div>
    );
  }

  // Separate tag filters from other filters
  const includeTagFilters = filters.filter((f) => f.type === "tag-include");
  const excludeTagFilters = filters.filter((f) => f.type === "tag-exclude");
  const otherFilters = filters.filter(
    (f) =>
      f.type !== "tag-include" && f.type !== "tag-exclude" && f.type !== "tag"
  );
  const totalTagFilters = includeTagFilters.length + excludeTagFilters.length;

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 py-2 sm:sticky sm:top-0 sm:z-20 bg-gray-50 dark:bg-gray-950 px-3 sm:px-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Active filters:
        </span>
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
        <button
          onClick={onClearAll}
          className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 hover:underline cursor-pointer"
        >
          Clear all
        </button>
      </div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 sm:ml-auto">
        {onOpenChat && <AskAIButton onClick={onOpenChat} />}
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
              <span>Filtering...</span>
            </span>
          ) : (
            <>
              Showing {filteredCount} / {formatCompact(totalEvents)} events
            </>
          )}
          <ExportLinks exportParams={exportParams} shareParams={shareParams} />
        </span>
      </div>
    </div>
  );
}
