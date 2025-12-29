export type NewsletterFrequency = "none" | "daily" | "weekly";

export type NewsletterScoreTier = "all" | "top50" | "top10";

export type NewsletterDaySelection = "everyday" | "weekend" | "specific";

export type PriceFilterType = "any" | "free" | "under20" | "under100" | "custom";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface NewsletterFilters {
  search?: string;
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
  daySelection?: NewsletterDaySelection;
  selectedDays?: number[];
  weekendEdition?: boolean;
  scoreTier?: NewsletterScoreTier;
  filters?: NewsletterFilters;
  curatorUserIds?: string[];
}
