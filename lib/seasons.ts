import {
  formatDateEastern,
  getDayBoundariesEastern,
  getTodayStringEastern,
} from '@/lib/utils/timezone';

/**
 * Holidays and other seasons that get a page of their own. While one is on (Eastern dates,
 * inclusive), every page shows its banner, plus a badge beside the logo and an Events menu
 * link when its look in SeasonalLinks has them. MM-DD dates repeat every year; YYYY-MM-DD
 * ones don't. An MM-DD season whose end comes before its start runs across Jan 1. The first
 * season listed wins where two overlap.
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
    short: 'Sign the letter asking AVL leaders for food & water resilience',
    banner: 'Sign the letter asking AVL leaders for food & water resilience',
  },
  // Every year, from when camps start opening registration through spring
  {
    key: 'camps',
    start: '11-05',
    end: '03-31',
    href: '/camps',
    label: 'Summer camps',
    // Fits one line on a 360px phone
    short: 'Summer camp registration is opening',
    banner: 'Summer camp registration is opening: dates and reminders',
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
      // An end before the start runs across Jan 1
      if (s.start > s.end) return day >= s.start || day <= s.end;
      return day >= s.start && day <= s.end;
    }) ?? null
  );
}

/** The running season's last day: an MM-DD end is next year's once today is past it */
function seasonEndDay(season: Season, today: string): string {
  if (isFullDate(season.end)) return season.end;
  const year = Number(today.slice(0, 4));
  // Only a season that runs across Jan 1 is running past its end's month and day
  return `${today.slice(5) > season.end ? year + 1 : year}-${season.end}`;
}

/** The season's banner with its end date filled in */
export function seasonBanner(season: Season, today = getTodayStringEastern()): string {
  const end = getDayBoundariesEastern(seasonEndDay(season, today)).start;
  return season.banner.replace(
    '{end}',
    formatDateEastern(end, { weekday: 'long', month: 'short', day: 'numeric' })
  );
}
