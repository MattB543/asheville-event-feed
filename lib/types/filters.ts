/**
 * Canonical filter types shared by the filter UI (FilterBar, FilterModal,
 * EventFeed), the query-param builder (useEventQuery), and server-side
 * consumers (newsletter, exports).
 *
 * These unions must match what the API routes and lib/db/queries/events.ts
 * accept — keep this the single source of truth instead of re-declaring.
 */

export type DateFilterType = 'all' | 'today' | 'tomorrow' | 'weekend' | 'dayOfWeek' | 'custom';
export type PriceFilterType = 'any' | 'free' | 'under20' | 'under100' | 'custom';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface TagFilterState {
  include: string[];
  exclude: string[];
}
