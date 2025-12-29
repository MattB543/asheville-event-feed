"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Mail,
  Bell,
  BellOff,
  Calendar,
  Loader2,
  Star,
  Sparkles,
  ListChecks,
  Search,
} from "lucide-react";
import type {
  NewsletterFilters,
  NewsletterFrequency,
  NewsletterScoreTier,
} from "@/lib/newsletter/types";

interface EmailDigestSettingsProps {
  email: string;
}

interface PublicCurator {
  userId: string;
  slug: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  showProfilePicture: boolean;
  curationCount: number;
}

const DEFAULT_FILTERS: NewsletterFilters = {
  search: "",
  dateFilter: "all",
  customDateRange: { start: null, end: null },
  selectedDays: [],
  selectedTimes: [],
  priceFilter: "any",
  customMaxPrice: null,
  tagsInclude: [],
  tagsExclude: [],
  selectedLocations: [],
  selectedZips: [],
  showDailyEvents: true,
  useDefaultFilters: true,
};

export default function EmailDigestSettings({ email }: EmailDigestSettingsProps) {
  const [frequency, setFrequency] = useState<NewsletterFrequency>("none");
  const [weekendEdition, setWeekendEdition] = useState(false);
  const [scoreTier, setScoreTier] = useState<NewsletterScoreTier>("all");
  const [curatorUserIds, setCuratorUserIds] = useState<string[]>([]);
  const [savedFilters, setSavedFilters] =
    useState<NewsletterFilters>(DEFAULT_FILTERS);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [curators, setCurators] = useState<PublicCurator[]>([]);
  const [curatorSearch, setCuratorSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] =
    useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/email-digest/settings");
        if (res.ok) {
          const data = await res.json();
          setFrequency(data.frequency || "none");
          setWeekendEdition(!!data.weekendEdition);
          setScoreTier(data.scoreTier || "all");
          setCuratorUserIds(data.curatorUserIds || []);
          setSavedFilters(data.filters || DEFAULT_FILTERS);
          setUpdatedAt(data.updatedAt || null);
        }
      } catch (error) {
        console.error("Failed to load newsletter settings:", error);
      }
    }

    async function loadCurators() {
      try {
        const res = await fetch("/api/curator/public");
        if (res.ok) {
          const data = await res.json();
          setCurators(data.curators || []);
        }
      } catch (error) {
        console.error("Failed to load curators:", error);
      }
    }

    Promise.all([loadSettings(), loadCurators()]).finally(() =>
      setIsLoading(false)
    );
  }, []);

  const filteredCurators = useMemo(() => {
    if (!curatorSearch.trim()) return curators;
    const term = curatorSearch.toLowerCase();
    return curators.filter((curator) => {
      const name = curator.displayName.toLowerCase();
      const bio = curator.bio?.toLowerCase() || "";
      return name.includes(term) || bio.includes(term);
    });
  }, [curators, curatorSearch]);

  const handleToggleCurator = (userId: string) => {
    setCuratorUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/email-digest/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frequency,
          weekendEdition: frequency === "daily" ? weekendEdition : false,
          scoreTier,
          curatorUserIds,
        }),
      });

      if (res.ok) {
        setMessage({
          type: "success",
          text:
            frequency === "none"
              ? "Newsletter emails disabled"
              : `Newsletter settings saved for ${email}`,
        });
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: "Failed to save settings. Please try again.",
      });
      console.error("Failed to save newsletter settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const filterSummary = useMemo(() => {
    const summary: string[] = [];

    if (savedFilters.search) {
      summary.push(`Search: "${savedFilters.search}"`);
    }

    if (savedFilters.tagsInclude?.length) {
      summary.push(`Include tags: ${savedFilters.tagsInclude.join(", ")}`);
    }

    if (savedFilters.tagsExclude?.length) {
      summary.push(`Exclude tags: ${savedFilters.tagsExclude.join(", ")}`);
    }

    if (savedFilters.priceFilter && savedFilters.priceFilter !== "any") {
      if (savedFilters.priceFilter === "custom" && savedFilters.customMaxPrice) {
        summary.push(`Price: under $${savedFilters.customMaxPrice}`);
      } else {
        summary.push(`Price: ${savedFilters.priceFilter}`);
      }
    }

    if (savedFilters.selectedLocations?.length) {
      summary.push(`Locations: ${savedFilters.selectedLocations.join(", ")}`);
    }

    if (savedFilters.selectedZips?.length) {
      summary.push(`Zips: ${savedFilters.selectedZips.join(", ")}`);
    }

    if (savedFilters.selectedTimes?.length) {
      summary.push(`Times: ${savedFilters.selectedTimes.join(", ")}`);
    }

    if (savedFilters.dateFilter && savedFilters.dateFilter !== "all") {
      summary.push(`Date filter: ${savedFilters.dateFilter}`);
    }

    if (savedFilters.showDailyEvents === false) {
      summary.push("Daily recurring events hidden");
    }

    return summary;
  }, [savedFilters]);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          <span className="text-gray-500 dark:text-gray-400">
            Loading newsletter settings...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg">
            <Mail className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Newsletter
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Personalized event email settings for {email}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            How often should we send your newsletter?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FrequencyOption
              value="none"
              current={frequency}
              onChange={setFrequency}
              icon={<BellOff className="w-5 h-5" />}
              label="None"
              description="No emails"
            />
            <FrequencyOption
              value="daily"
              current={frequency}
              onChange={setFrequency}
              icon={<Bell className="w-5 h-5" />}
              label="Daily"
              description="Each morning"
            />
            <FrequencyOption
              value="weekly"
              current={frequency}
              onChange={setFrequency}
              icon={<Calendar className="w-5 h-5" />}
              label="Weekly"
              description="Mondays"
            />
          </div>
        </div>

        {frequency === "daily" && (
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Weekend Edition
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Send Friday with events for Friday through Sunday.
              </p>
            </div>
            <button
              onClick={() => setWeekendEdition((prev) => !prev)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                weekendEdition ? "bg-brand-600" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  weekendEdition ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Which events should we prioritize?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ScoreTierOption
              value="all"
              current={scoreTier}
              onChange={setScoreTier}
              icon={<ListChecks className="w-5 h-5" />}
              label="All events"
              description="Everything in range"
            />
            <ScoreTierOption
              value="top50"
              current={scoreTier}
              onChange={setScoreTier}
              icon={<Star className="w-5 h-5" />}
              label="Somewhat unique"
              description="Score 6+"
            />
            <ScoreTierOption
              value="top10"
              current={scoreTier}
              onChange={setScoreTier}
              icon={<Sparkles className="w-5 h-5" />}
              label="Very unique"
              description="Score 14+"
            />
          </div>
        </div>

        <div className="p-4 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg">
          <p className="text-sm font-medium text-brand-900 dark:text-brand-200">
            Newsletter filters
          </p>
          {filterSummary.length === 0 ? (
            <p className="text-sm text-brand-700 dark:text-brand-300 mt-2">
              No filters saved yet. Open the events page, customize your feed,
              then click "Save newsletter filters" to lock them in.
            </p>
          ) : (
            <div className="mt-2 space-y-1 text-sm text-brand-700 dark:text-brand-300">
              {filterSummary.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}
          {updatedAt && (
            <p className="text-xs text-brand-700/70 dark:text-brand-300/70 mt-2">
              Last updated {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Curator subscriptions
          </label>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Curated picks will appear at the top of your newsletter.
          </p>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={curatorSearch}
              onChange={(e) => setCuratorSearch(e.target.value)}
              placeholder="Search curators..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {filteredCurators.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                No public curators found.
              </div>
            ) : (
              filteredCurators.map((curator) => {
                const isSelected = curatorUserIds.includes(curator.userId);
                return (
                  <label
                    key={curator.userId}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
                        : "border-gray-200 dark:border-gray-700 hover:border-brand-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleCurator(curator.userId)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {curator.displayName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {curator.curationCount} curated event
                        {curator.curationCount === 1 ? "" : "s"}
                      </div>
                      {curator.bio && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                          {curator.bio}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })
            )}
          </div>
          {curatorUserIds.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {curatorUserIds.length} curator
              {curatorUserIds.length === 1 ? "" : "s"} selected
            </p>
          )}
        </div>

        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === "success"
                ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Newsletter Settings"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FrequencyOptionProps {
  value: NewsletterFrequency;
  current: NewsletterFrequency;
  onChange: (value: NewsletterFrequency) => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}

function FrequencyOption({
  value,
  current,
  onChange,
  icon,
  label,
  description,
}: FrequencyOptionProps) {
  const isSelected = current === value;

  return (
    <button
      onClick={() => onChange(value)}
      className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all cursor-pointer ${
        isSelected
          ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20"
          : "border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
      }`}
    >
      <div
        className={`mb-2 ${
          isSelected
            ? "text-brand-600 dark:text-brand-400"
            : "text-gray-400 dark:text-gray-500"
        }`}
      >
        {icon}
      </div>
      <span
        className={`font-medium ${
          isSelected
            ? "text-brand-600 dark:text-brand-400"
            : "text-gray-700 dark:text-gray-300"
        }`}
      >
        {label}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {description}
      </span>
    </button>
  );
}

interface ScoreTierOptionProps {
  value: NewsletterScoreTier;
  current: NewsletterScoreTier;
  onChange: (value: NewsletterScoreTier) => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}

function ScoreTierOption({
  value,
  current,
  onChange,
  icon,
  label,
  description,
}: ScoreTierOptionProps) {
  const isSelected = current === value;

  return (
    <button
      onClick={() => onChange(value)}
      className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all cursor-pointer ${
        isSelected
          ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20"
          : "border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
      }`}
    >
      <div
        className={`mb-2 ${
          isSelected
            ? "text-brand-600 dark:text-brand-400"
            : "text-gray-400 dark:text-gray-500"
        }`}
      >
        {icon}
      </div>
      <span
        className={`font-medium ${
          isSelected
            ? "text-brand-600 dark:text-brand-400"
            : "text-gray-700 dark:text-gray-300"
        }`}
      >
        {label}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {description}
      </span>
    </button>
  );
}
