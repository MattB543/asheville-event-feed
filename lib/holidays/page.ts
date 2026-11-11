import { getSeasonPicks, type SeasonPick } from '@/lib/db/queries/seasonPicks';
import { getSeasons } from '@/lib/db/queries/seasonSettings';
import { currentSeason } from '@/lib/seasons';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/utils/admin';
import {
  getDateStringEastern,
  getDayBoundariesEastern,
  getTodayStringEastern,
} from '@/lib/utils/timezone';
import {
  getHoliday,
  holidayFirstDay,
  holidayLastDay,
  holidayWall,
  type HolidayKey,
} from './config';
import {
  getCachedHolidayEvents,
  getEventsForWall,
  type HolidayAudience,
  type HolidayEvent,
} from './events';

export type DayList = [day: string, events: HolidayEvent[]];

const chronological = (a: HolidayEvent, b: HolidayEvent) =>
  a.startDate.getTime() - b.startDate.getTime() || a.id.localeCompare(b.id);

/** Each day's top `perDay`, in date order, each day by time when `byDate` */
function topPerDay(list: HolidayEvent[], perDay: number, byDate: boolean): DayList[] {
  const days = new Map<string, HolidayEvent[]>();
  for (const e of list) {
    const key = getDateStringEastern(e.startDate);
    const day = days.get(key) ?? [];
    if (day.length < perDay) days.set(key, [...day, e]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, picks]): DayList => [day, byDate ? [...picks].sort(chronological) : picks]);
}

/**
 * Everything a holiday page shows: the poster wall for its big days, a few cards a day before
 * and after them, and the admins' hand edits (hidden events, posters, events added to the wall).
 */
export async function loadHolidayPage(
  key: HolidayKey,
  {
    audience,
    byDate,
    wallSize,
    perDay,
    preview = false,
  }: {
    audience: HolidayAudience;
    byDate: boolean;
    wallSize: number;
    perDay: number;
    /** `?preview=1`: an admin, or anyone on a dev server, sees a closed page as if it were open */
    preview?: boolean;
  }
) {
  const holiday = getHoliday(key);
  const today = getTodayStringEastern();
  const seasons = await getSeasons();
  const lastDay = holidayLastDay(key, seasons, today);
  // From today, or from the first day of a run that hasn't started (a preview)
  const firstDay = holidayFirstDay(key, seasons, today);
  const from = today > firstDay ? today : firstDay;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user?.id);
  const canPreview = admin || process.env.NODE_ENV === 'development';
  const running = currentSeason(seasons, today)?.key === key;
  const previewing = !running && preview && canPreview;
  const open = running || previewing;

  let events: HolidayEvent[] = [];
  let failed = false;
  if (open) {
    try {
      events = await getCachedHolidayEvents(holiday, from, lastDay, audience);
    } catch (error) {
      console.error(`[Holiday:${key}] Failed to load events:`, error);
      failed = true;
    }
  }

  // Hand edits: a missing table or failed read just means none, never a broken page
  const seasonPicks = await getSeasonPicks(key).catch((error: unknown) => {
    console.error(`[Holiday:${key}] Failed to load hand edits:`, error);
    return new Map<string, SeasonPick>();
  });
  // Events added to the wall by hand, which may not match the holiday's words at all.
  // Never in Halloween's Family view: nothing vets a hand-added event as family-friendly.
  // Hidden ones load too, so they stay in the admin's hidden list instead of vanishing
  const addedIds =
    audience === 'family'
      ? []
      : [...seasonPicks.values()].filter((p) => p.added).map((p) => p.eventId);
  const pageStart = getDayBoundariesEastern(from).start;
  const pageEnd = getDayBoundariesEastern(lastDay).end;
  // Kept to the page's dates, so one that has passed or been moved drops off like the rest
  const handAdded = (
    await getEventsForWall(addedIds).catch((error: unknown) => {
      console.error(`[Holiday:${key}] Failed to load hand-added events:`, error);
      return [] as HolidayEvent[];
    })
  ).filter((e) => e.startDate >= pageStart && e.startDate <= pageEnd);
  const withEdits = [...handAdded, ...events.filter((e) => !addedIds.includes(e.id))].map((e) => {
    const posterUrl = seasonPicks.get(e.id)?.posterUrl;
    return posterUrl ? { ...e, imageUrl: posterUrl } : e;
  });
  // Hidden ones come off the page and are only listed for an admin
  const shown = withEdits.filter((e) => !seasonPicks.get(e.id)?.hidden);
  const hiddenHere = withEdits.filter((e) => seasonPicks.get(e.id)?.hidden);

  const wall = holidayWall(key, seasons, today);
  const wallStart = getDayBoundariesEastern(wall.from).start;
  const wallEnd = getDayBoundariesEastern(wall.to).end;
  const onWall = shown.filter((e) => e.startDate >= wallStart && e.startDate <= wallEnd);
  // Hand-added events come first and don't use up the ranked spots
  const ranked = [
    ...onWall.filter((e) => addedIds.includes(e.id)),
    ...onWall.filter((e) => !addedIds.includes(e.id)).slice(0, wallSize),
  ];

  return {
    today,
    lastDay,
    open,
    // A closed page shown anyway, and whether this viewer may ask for that
    previewing,
    canPreview,
    over: today > lastDay,
    failed,
    admin,
    addedIds,
    isHidden: (id: string) => seasonPicks.get(id)?.hidden === true,
    wallStart,
    wallEnd,
    // The wall's last day, as YYYY-MM-DD (Halloween itself, on that page)
    wallLastDay: wall.to,
    picks: byDate ? [...ranked].sort(chronological) : ranked,
    beforeDays: topPerDay(
      shown.filter((e) => e.startDate < wallStart),
      perDay,
      byDate
    ),
    afterDays: topPerDay(
      shown.filter((e) => e.startDate > wallEnd),
      perDay,
      byDate
    ),
    hiddenHere,
  };
}
