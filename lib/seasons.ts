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
 * season listed wins where two overlap. These are the defaults: admins can change a season's
 * dates and banner at /admin/banners (lib/db/queries/seasonSettings.ts).
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
    color: '#f97316',
    fade: true,
  },
  {
    key: 'thanksgiving',
    start: '11-09',
    end: '11-30',
    href: '/thanksgiving',
    label: 'Thanksgiving',
    short: 'Thanksgiving in Asheville',
    banner: 'Thanksgiving in Asheville: feasts, turkey trots and Friendsgivings through {end}',
    color: '#b45309',
    fade: false,
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
    color: '#1f2937',
    fade: false,
  },
  // Every year, from after the holidays through spring
  {
    key: 'camps',
    start: '01-10',
    end: '03-31',
    href: '/camps',
    label: 'Summer camps',
    // Fits one line on a 360px phone
    short: 'Summer camp registration is opening',
    banner: 'Summer camp registration is opening: dates and reminders',
    color: '#065f46',
    fade: false,
  },
] as const;

export type SeasonKey = (typeof SEASONS)[number]['key'];

export interface Season {
  key: SeasonKey;
  start: string;
  end: string;
  href: string;
  label: string;
  short: string;
  banner: string;
  /** Off, a season shows nothing and its page stays closed */
  enabled: boolean;
  /** The banner's colour as #rrggbb, faded darker toward both ends when `fade` */
  color: string;
  fade: boolean;
  /** An emoji in place of the banner's drawn icon; null keeps the drawn one */
  icon: string | null;
}

/** What an admin can change; the rest belongs to the season's page */
export type SeasonSettings = Pick<
  Season,
  'start' | 'end' | 'short' | 'banner' | 'enabled' | 'color' | 'fade' | 'icon'
>;

export const SHORT_MAX = 60;
export const BANNER_MAX = 140;

/** The seasons with an admin's changes applied over the defaults */
export function withSettings(settings: ReadonlyMap<string, SeasonSettings>): Season[] {
  return SEASONS.map((season) => ({
    ...season,
    enabled: true,
    icon: null,
    ...settings.get(season.key),
  }));
}

export const DEFAULT_SEASONS = withSettings(new Map());

/** A YYYY-MM-DD season date, which holds for that year only */
const isFullDate = (date: string) => date.length === 10;

/** The season running today, if any */
export function currentSeason(
  seasons: readonly Season[],
  today = getTodayStringEastern()
): Season | null {
  return (
    seasons.find((s) => {
      if (!s.enabled) return false;
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

const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real MM-DD (Feb 29 allowed) or YYYY-MM-DD date */
function isSeasonDate(date: string): boolean {
  const full = FULL_DATE.test(date);
  if (!full && !MONTH_DAY.test(date)) return false;
  // A leap year, so an every-year Feb 29 passes
  const iso = full ? date : `2024-${date}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso);
}

function isOneEmoji(text: string): boolean {
  const graphemes = [...new Intl.Segmenter().segment(text)];
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);
}

/** An admin's form, checked: the settings to save, or what to fix */
export function checkSeasonSettings(
  input: Record<string, unknown>
): { ok: true; settings: SeasonSettings } | { ok: false; error: string } {
  const [start, end, short, banner] = (['start', 'end', 'short', 'banner'] as const).map((field) =>
    typeof input[field] === 'string' ? input[field].trim() : ''
  );
  if (!isSeasonDate(start) || !isSeasonDate(end)) {
    return { ok: false, error: 'Dates are MM-DD (every year) or YYYY-MM-DD (that year only)' };
  }
  if (isFullDate(start) !== isFullDate(end)) {
    return { ok: false, error: 'Give both dates with a year, or neither' };
  }
  // Only an every-year season can run across Jan 1
  if (isFullDate(start) && end < start) {
    return { ok: false, error: 'The season ends before it starts' };
  }
  if (!short || short.length > SHORT_MAX) {
    return { ok: false, error: `The phone banner needs 1-${SHORT_MAX} characters` };
  }
  if (!banner || banner.length > BANNER_MAX) {
    return { ok: false, error: `The banner needs 1-${BANNER_MAX} characters` };
  }
  if (typeof input.enabled !== 'boolean') return { ok: false, error: 'On or off is missing' };
  const { color, fade } = input;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    return { ok: false, error: 'The colour is not a #rrggbb colour' };
  }
  if (typeof fade !== 'boolean') return { ok: false, error: 'Fade is missing' };
  const icon = typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim() : null;
  if (icon !== null && !isOneEmoji(icon)) return { ok: false, error: 'The icon is one emoji' };
  return {
    ok: true,
    settings: { start, end, short, banner, enabled: input.enabled, color, fade, icon },
  };
}
