import {
  formatDateEastern,
  getDayBoundariesEastern,
  getTodayStringEastern,
} from '@/lib/utils/timezone';

/**
 * Holidays that get a page of their own. While one is on (Eastern dates, inclusive),
 * every page shows its banner, a badge beside the logo and an Events menu link.
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
] as const;

export type Season = (typeof SEASONS)[number];
export type SeasonKey = Season['key'];

/** The season running today, if any */
export function currentSeason(today = getTodayStringEastern()): Season | null {
  const monthDay = today.slice(5);
  return SEASONS.find((s) => monthDay >= s.start && monthDay <= s.end) ?? null;
}

/** The season's banner with this year's end date filled in */
export function seasonBanner(season: Season, today = getTodayStringEastern()): string {
  const end = getDayBoundariesEastern(`${today.slice(0, 4)}-${season.end}`).start;
  return season.banner.replace(
    '{end}',
    formatDateEastern(end, { weekday: 'long', month: 'short', day: 'numeric' })
  );
}
