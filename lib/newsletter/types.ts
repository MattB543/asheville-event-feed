export type NewsletterFrequency = "none" | "daily" | "weekly";

export type NewsletterScoreTier = "all" | "top50" | "top10";

export type DateFilterType =
  | "all"
  | "today"
  | "tomorrow"
  | "weekend"
  | "dayOfWeek"
  | "custom";

export type PriceFilterType = "any" | "free" | "under20" | "under100" | "custom";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface NewsletterFilters {
  search?: string;
  dateFilter?: DateFilterType;
  customDateRange?: DateRange;
  selectedDays?: number[];
  selectedTimes?: TimeOfDay[];
  priceFilter?: PriceFilterType;
  customMaxPrice?: number | null;
  tagsInclude?: string[];
  tagsExclude?: string[];
  selectedLocations?: string[];
  selectedZips?: string[];
  showDailyEvents?: boolean;
  useDefaultFilters?: boolean;
}

export interface NewsletterSettingsPayload {
  frequency?: NewsletterFrequency;
  weekendEdition?: boolean;
  scoreTier?: NewsletterScoreTier;
  filters?: NewsletterFilters;
  curatorUserIds?: string[];
}
