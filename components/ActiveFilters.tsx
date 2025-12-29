"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Link, FileText, FileCode, Mail } from "lucide-react";
import FilterChip from "./ui/FilterChip";
import { useToast } from "./ui/Toast";

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
    | "location"
    | "zip";
  label: string;
}

interface ActiveFiltersProps {
  filters: ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onClearAllTags?: () => void;
  exportParams?: string;
  shareParams?: string;
  onOpenChat?: () => void;
  onSaveNewsletterFilters?: () => void;
  isSavingNewsletterFilters?: boolean;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [menuOpen]);

  const handleCopyView = async () => {
    const url = `${window.location.origin}${window.location.pathname}${
      shareParams || ""
    }`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard!");
      setMenuOpen(false);
    } catch {
      showToast("Failed to copy link", "error");
    }
  };

  return (
    <span className="relative inline-block" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="underline text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
      >
        Share & Export
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[220px]">
          <button
            onClick={shareParams ? handleCopyView : undefined}
            disabled={!shareParams}
            className={`w-full flex items-start gap-2 px-3 py-2 text-left ${
              shareParams
                ? "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                : "text-gray-400 dark:text-gray-600 cursor-not-allowed"
            }`}
          >
            <Link size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-medium">Copy filtered view</div>
              <div className={`text-[10px] ${shareParams ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-600"}`}>
                {shareParams ? "Share link with your current filters" : "Apply filters to enable sharing"}
              </div>
            </div>
          </button>
          <a
            href={`/api/export/json${exportParams || ""}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
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
            href={`/api/export/markdown${exportParams || ""}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
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
    </span>
  );
}

function AskAIButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-800 dark:hover:text-gray-100 cursor-pointer transition-colors shrink-0"
    >
      <Sparkles size={14} />
      <span>Ask AI</span>
    </button>
  );
}

function SaveNewsletterButton({
  onClick,
  isSaving,
}: {
  onClick: () => void;
  isSaving?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isSaving}
      className="inline-flex items-center gap-1.5 px-3 py-1 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-800 dark:hover:text-gray-100 cursor-pointer transition-colors shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <Mail size={14} />
      <span>{isSaving ? "Saving..." : "Save newsletter filters"}</span>
    </button>
  );
}

export default function ActiveFilters({
  filters,
  onRemove,
  onClearAll,
  onClearAllTags,
  exportParams,
  shareParams,
  onOpenChat,
  onSaveNewsletterFilters,
  isSavingNewsletterFilters,
  isPending,
}: ActiveFiltersProps) {
  if (filters.length === 0) {
    return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-end gap-2 sm:gap-3 text-sm text-gray-500 dark:text-gray-400 py-2 pb-3 sm:sticky sm:top-0 sm:z-20 bg-gray-50 dark:bg-gray-950 px-3 sm:px-0">
        {onOpenChat && <AskAIButton onClick={onOpenChat} />}
        {onSaveNewsletterFilters && (
          <SaveNewsletterButton
            onClick={onSaveNewsletterFilters}
            isSaving={isSavingNewsletterFilters}
          />
        )}
        <span>
          {isPending && (
            <span className="inline-flex items-center gap-2 mr-2">
              <span className="w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
              <span>Filtering...</span>
            </span>
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
        {onSaveNewsletterFilters && (
          <SaveNewsletterButton
            onClick={onSaveNewsletterFilters}
            isSaving={isSavingNewsletterFilters}
          />
        )}
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {isPending && (
            <span className="inline-flex items-center gap-2 mr-2">
              <span className="w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
              <span>Filtering...</span>
            </span>
          )}
          <ExportLinks exportParams={exportParams} shareParams={shareParams} />
        </span>
      </div>
    </div>
  );
}
