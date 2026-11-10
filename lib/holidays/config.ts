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
] satisfies Holiday[];

export type HolidayKey = (typeof HOLIDAYS)[number]['key'];

export function getHoliday(key: HolidayKey): Holiday {
  return HOLIDAYS.find((h) => h.key === key)!;
}

/** The season's last day this year, from `seasons` as admins set them; this year's, so a
 * page can tell when its season is over */
export function holidayLastDay(
  key: HolidayKey,
  seasons: readonly Season[],
  today = getTodayStringEastern()
): string {
  const season = seasons.find((s) => s.key === key)!;
  return season.end.length === 10 ? season.end : `${today.slice(0, 4)}-${season.end}`;
}

/** The wall's days this year, from today on (the page drops anything earlier) */
export function holidayWallRange(key: HolidayKey, today = getTodayStringEastern()) {
  const wall = getHoliday(key).wall(Number(today.slice(0, 4)));
  return {
    start: getDayBoundariesEastern(today > wall.from ? today : wall.from).start,
    end: getDayBoundariesEastern(wall.to).end,
  };
}
