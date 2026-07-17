export type NewsletterFrequency = 'none' | 'daily' | 'weekly';

export type NewsletterScoreTier = 'all' | 'top50' | 'top10';

export type Top30SubscriptionType = 'none' | 'live' | 'weekly';

export type NewsletterDaySelection = 'everyday' | 'weekend' | 'specific';

// Canonical definitions in lib/types/filters
import type { PriceFilterType, TimeOfDay } from '@/lib/types/filters';
export type { PriceFilterType, TimeOfDay };

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
