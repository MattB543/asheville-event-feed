import type { Season, SeasonKey } from '@/lib/seasons';
import { getDayBoundariesEastern, getTodayStringEastern } from '@/lib/utils/timezone';

/**
 * What each holiday page shows. Its dates and banner are its season's (lib/seasons.ts); the
 * page runs from today through the season's last day. An event is on the page when the AI
 * gave it the holiday's tag (the rule below is part of the tagging prompt, and
 * `scripts/tag-holiday.ts` backfills), or, until the AI has tagged it, when its title has
 * one of the holiday's words (matched at the start of a word).
 */
export interface Holiday {
  key: SeasonKey;
  tag: string;
  titleWords: string;
  /** For the tagging prompt: which events get the tag */
  rule: string;
  /** The big days, shown as a poster wall; the days before (and after) get a few cards each */
  wall: (year: number) => { from: string; to: string };
  /** Leave out events scored below this; Halloween's weird ranking needs none */
  minScore?: number;
  /** Halloween's After dark / Family split, with After dark ranked by how weird it is */
  familyView?: boolean;
}

/** The fourth Thursday of November, as YYYY-MM-DD */
export function thanksgivingDate(year: number): string {
  const firstWeekday = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - firstWeekday + 7) % 7);
  return `${year}-11-${String(firstThursday + 21).padStart(2, '0')}`;
}

/** The Friday to Sunday before Christmas Day, which has the month's most Christmas events */
export function christmasWeekend(year: number): { from: string; to: string } {
  const christmasWeekday = new Date(Date.UTC(year, 11, 25)).getUTCDay();
  const sunday = 25 - (christmasWeekday || 7);
  return { from: `${year}-12-${sunday - 2}`, to: `${year}-12-${sunday}` };
}

export const HOLIDAYS = [
  {
    key: 'halloween',
    tag: 'Halloween',
    titleWords:
      '\\m(hallowe|spook|haunt|zombie|costume|ghost|witch|monster|vampire|horror|nosferatu|goth|dracula|creep|seance|séance|masquerade|day of the dead|muertos|trick.or.treat|boo\\M)',
    rule: 'when the event itself is Halloween-themed (a Halloween or costume party, trick-or-treating, haunted house or trail, ghost tour, a horror show billed for the season, a "spooky" edition of a regular event, Day of the Dead). Not for events that merely fall in late October.',
    wall: (year) => ({ from: `${year}-10-30`, to: `${year}-10-31` }),
    familyView: true,
  },
  {
    key: 'thanksgiving',
    tag: 'Thanksgiving',
    titleWords: '\\m(thanksgiving|turkey|friendsgiving)',
    rule: 'when the event itself is about Thanksgiving (a Thanksgiving dinner or buffet, Friendsgiving, turkey trot, a Thanksgiving show, concert or class, a food drive or giveaway for Thanksgiving). Not for events that merely fall in late November.',
    wall: (year) => {
      const day = thanksgivingDate(year);
      return { from: day, to: day };
    },
    // The feed's Top Events cutoff, which leaves out takeout orders and small classes
    minScore: 15,
  },
  {
    key: 'christmas',
    tag: 'Christmas',
    // "carols" but not "Carolina"
    titleWords:
      '\\m(christmas|xmas|santa|nutcracker|carols?\\M|caroling|jingle|grinch|ugly sweater|gingerbread|yule|mistletoe|reindeer|sleigh|tree lighting|winter lights)',
    rule: "when the event itself is about Christmas or the holiday season around it (Christmas lights, Santa visits, The Nutcracker or A Christmas Carol, carols and Christmas concerts, holiday markets and craft fairs, tree lightings, ugly sweater parties, Christmas Eve services or dinners). Not for events that merely fall in December, or that are only about another holiday (Hanukkah, Kwanzaa, New Year's Eve).",
    wall: christmasWeekend,
    minScore: 15,
  },
  {
    key: 'newyear',
    tag: 'New Year',
    titleWords: '\\m(new year|nye\\M|ball drop|auld lang|countdown to (midnight|202))',
    rule: "when the event itself is about New Year's (a New Year's Eve party, show, dinner or countdown, a ball drop, a New Year's Day hike, plunge or brunch). Not for events that merely fall on Dec 31 or Jan 1.",
    wall: (year) => ({ from: `${year}-12-31`, to: `${year}-12-31` }),
    minScore: 15,
  },
] satisfies Holiday[];

export type HolidayKey = (typeof HOLIDAYS)[number]['key'];

export function getHoliday(key: HolidayKey): Holiday {
  return HOLIDAYS.find((h) => h.key === key)!;
}

/** The year the season's current or next run starts in: last year's for a season that runs
 * across Jan 1 when today is in its January part, next year's once this year's run is over */
function seasonYear(season: Season, today: string): number {
  const year = Number(today.slice(0, 4));
  if (season.start.length === 10) return Number(season.start.slice(0, 4));
  const day = today.slice(5);
  if (season.start > season.end) return day <= season.end ? year - 1 : year;
  return day > season.end ? year + 1 : year;
}

/** The season's first day in its current or next run */
export function holidayFirstDay(
  key: HolidayKey,
  seasons: readonly Season[],
  today = getTodayStringEastern()
): string {
  const season = seasons.find((s) => s.key === key)!;
  if (season.start.length === 10) return season.start;
  return `${seasonYear(season, today)}-${season.start}`;
}

/** The season's last day in its current or next run, from `seasons` as admins set them, so a
 * page can tell when its season is over */
export function holidayLastDay(
  key: HolidayKey,
  seasons: readonly Season[],
  today = getTodayStringEastern()
): string {
  const season = seasons.find((s) => s.key === key)!;
  if (season.end.length === 10) return season.end;
  const year = seasonYear(season, today);
  return `${season.start > season.end ? year + 1 : year}-${season.end}`;
}

/** The wall's days in the season's current or next run */
export function holidayWall(
  key: HolidayKey,
  seasons: readonly Season[],
  today = getTodayStringEastern()
) {
  return getHoliday(key).wall(seasonYear(seasons.find((s) => s.key === key)!, today));
}

/** The wall's days from today on (the page drops anything earlier) */
export function holidayWallRange(
  key: HolidayKey,
  seasons: readonly Season[],
  today = getTodayStringEastern()
) {
  const wall = holidayWall(key, seasons, today);
  return {
    start: getDayBoundariesEastern(today > wall.from ? today : wall.from).start,
    end: getDayBoundariesEastern(wall.to).end,
  };
}
