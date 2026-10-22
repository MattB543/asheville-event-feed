import { getTodayStringEastern } from '@/lib/utils/timezone';

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
    banner:
      'Halloween in Asheville: the strangest, spookiest things to do through Saturday, Oct 31',
  },
] as const;

export type Season = (typeof SEASONS)[number];
export type SeasonKey = Season['key'];

/** The season running today, if any */
export function currentSeason(today = getTodayStringEastern()): Season | null {
  const monthDay = today.slice(5);
  return SEASONS.find((s) => monthDay >= s.start && monthDay <= s.end) ?? null;
}
