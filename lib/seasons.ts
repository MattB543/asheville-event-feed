import {
  formatDateEastern,
  getDayBoundariesEastern,
  getTodayStringEastern,
} from '@/lib/utils/timezone';

/**
 * Holidays that get a page of their own. While one is on (Eastern dates, inclusive),
 * every page shows its banner, plus a badge beside the logo and an Events menu link when
 * its look in SeasonalLinks has them. MM-DD dates repeat every year; YYYY-MM-DD ones don't.
 */
export const SEASONS = [
  {
    key: 'halloween',
    start: '10-01',
    end: '10-31',
    href: '/halloween',
    label: 'Halloween',
    short: 'Halloween in Asheville',
    // {end} becomes the season's last day, weekday included ("Saturday, Oct 31")
    banner: 'Halloween in Asheville: the strangest, spookiest things to do through {end}',
  },
  // 2026 only: the open letter, the two days before Election Day (Tue Nov 3)
  {
    key: 'plan',
    start: '2026-11-01',
    end: '2026-11-02',
    href: '/plan',
    label: 'Disaster Plan',
    short: 'Before you vote: where candidates stand',
    banner:
      'Before you vote Tuesday: where the candidates stand on water and food plans for long outages',
  },
] as const;

export type Season = (typeof SEASONS)[number];
export type SeasonKey = Season['key'];

/** A YYYY-MM-DD season date, which holds for that year only */
const isFullDate = (date: string) => date.length === 10;

/** The season running today, if any */
export function currentSeason(today = getTodayStringEastern()): Season | null {
  return (
    SEASONS.find((s) => {
      const day = isFullDate(s.start) ? today : today.slice(5);
      return day >= s.start && day <= s.end;
    }) ?? null
  );
}

/** The season's banner with this year's end date filled in */
export function seasonBanner(season: Season, today = getTodayStringEastern()): string {
  const endDay = isFullDate(season.end) ? season.end : `${today.slice(0, 4)}-${season.end}`;
  const end = getDayBoundariesEastern(endDay).start;
  return season.banner.replace(
    '{end}',
    formatDateEastern(end, { weekday: 'long', month: 'short', day: 'numeric' })
  );
}
