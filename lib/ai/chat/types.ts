import type { EventFilterParams } from '@/lib/db/queries/events';
import { isRecord } from '@/lib/utils/validation';

export type ChatFilters = Omit<EventFilterParams, 'cursor' | 'limit'>;

export interface ChatSearchState {
  filters: ChatFilters;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validate browser context as carefully as model-generated tool arguments. */
export function parseChatFilters(value: unknown): ChatFilters {
  if (!isRecord(value)) return {};
  const filters: ChatFilters = {};
  for (const key of ['search', 'organizer', 'venue', 'minStartTime', 'maxStartTime'] as const) {
    const entry = value[key];
    if (typeof entry === 'string' && entry.length <= 200) filters[key] = entry.trim();
  }
  for (const key of [
    'keywords',
    'excludeKeywords',
    'tagsInclude',
    'tagsExclude',
    'locations',
    'zips',
    'blockedHosts',
    'blockedKeywords',
  ] as const) {
    const entry = value[key];
    if (Array.isArray(entry) && entry.every((item) => typeof item === 'string')) {
      filters[key] = entry.slice(0, 50).map((item: string) => item.trim().slice(0, 200));
    }
  }
  if (value.keywordMatch === 'all' || value.keywordMatch === 'any') {
    filters.keywordMatch = value.keywordMatch;
  }
  if (
    value.priceFilter === 'any' ||
    value.priceFilter === 'free' ||
    value.priceFilter === 'under20' ||
    value.priceFilter === 'under100' ||
    value.priceFilter === 'custom'
  ) {
    filters.priceFilter = value.priceFilter;
  }
  if (
    typeof value.maxPrice === 'number' &&
    Number.isFinite(value.maxPrice) &&
    value.maxPrice >= 0
  ) {
    filters.maxPrice = value.maxPrice;
  }
  if (
    value.dateFilter === 'all' ||
    value.dateFilter === 'today' ||
    value.dateFilter === 'tomorrow' ||
    value.dateFilter === 'weekend' ||
    value.dateFilter === 'custom' ||
    value.dateFilter === 'dayOfWeek'
  ) {
    filters.dateFilter = value.dateFilter;
  }
  for (const key of ['dateStart', 'dateEnd'] as const) {
    if (isCalendarDate(value[key])) filters[key] = value[key];
  }
  if (Array.isArray(value.days)) {
    filters.days = value.days.filter(
      (day): day is number =>
        typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6
    );
  }
  if (Array.isArray(value.times)) {
    filters.times = value.times.filter(
      (time): time is 'morning' | 'afternoon' | 'evening' =>
        time === 'morning' || time === 'afternoon' || time === 'evening'
    );
  }
  for (const key of [
    'showDailyEvents',
    'useDefaultFilters',
    'strictPrice',
    'includeUnknownTimes',
  ] as const) {
    if (typeof value[key] === 'boolean') filters[key] = value[key];
  }
  if (Array.isArray(value.hiddenFingerprints)) {
    filters.hiddenFingerprints = value.hiddenFingerprints.flatMap((entry: unknown) =>
      isRecord(entry) && typeof entry.title === 'string' && typeof entry.organizer === 'string'
        ? [{ title: entry.title, organizer: entry.organizer }]
        : []
    );
  }
  return filters;
}

export function parseChatSearchState(value: unknown): ChatSearchState | undefined {
  if (!isRecord(value) || !isRecord(value.filters)) return undefined;
  return {
    filters: parseChatFilters(value.filters),
    nextCursor:
      typeof value.nextCursor === 'string' &&
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(
        value.nextCursor
      ) &&
      Number.isFinite(new Date(value.nextCursor.split('_')[0]).getTime())
        ? value.nextCursor
        : null,
    hasMore: value.hasMore === true,
  };
}
