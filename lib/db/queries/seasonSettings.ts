import { unstable_cache } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { seasonSettings } from '@/lib/db/schema';
import {
  DEFAULT_SEASONS,
  withSettings,
  type Season,
  type SeasonKey,
  type SeasonSettings,
} from '@/lib/seasons';

export const SEASONS_TAG = 'seasons';

const readSettings = () =>
  db
    .select({
      key: seasonSettings.key,
      start: seasonSettings.startDay,
      end: seasonSettings.endDay,
      short: seasonSettings.short,
      banner: seasonSettings.banner,
      enabled: seasonSettings.enabled,
      color: seasonSettings.color,
      fade: seasonSettings.fade,
      icon: seasonSettings.icon,
    })
    .from(seasonSettings);

type SettingsRow = Awaited<ReturnType<typeof readSettings>>[number];

// A read that never answers counts as failed: the root layout waits on this for every page,
// and one stuck read timed out page after page in a Vercel build (60s each)
const READ_TIMEOUT_MS = 3000;
// After a failed read, pages get the defaults for a minute without asking again
const RETRY_AFTER_MS = 60_000;
let failedAt = -Infinity;
let reading: Promise<SettingsRow[]> | null = null;

class FailedJustNow extends Error {}

// One read at a time, however many pages ask at once (a stuck read keeps its connection, and
// there are five), and none waited on for more than 3 seconds
function readInTime(): Promise<SettingsRow[]> {
  reading ??= new Promise<SettingsRow[]>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No answer in ${READ_TIMEOUT_MS}ms`)),
      READ_TIMEOUT_MS
    );
    readSettings()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  }).finally(() => {
    reading = null;
  });
  return reading;
}

// What the cache runs. The time limit and the minute's pause are in here, not around the cache:
// Next waits for this to settle before it finishes a page, and the cache call itself is what
// gives each page its hourly refresh and its `seasons` tag, so it must always be made
async function readForCache(): Promise<SettingsRow[]> {
  if (Date.now() - failedAt < RETRY_AFTER_MS) throw new FailedJustNow();
  try {
    return await readInTime();
  } catch (error) {
    failedAt = Date.now();
    throw error;
  }
}

// Every page's header reads these, so a failed read means the defaults, never a broken page
async function orDefaults(read: () => Promise<SettingsRow[]>): Promise<Season[]> {
  try {
    return withSettings(new Map((await read()).map(({ key, ...settings }) => [key, settings])));
  } catch (error) {
    if (!(error instanceof FailedJustNow)) {
      console.error('[Seasons] Could not read the season settings, using the defaults:', error);
    }
    return DEFAULT_SEASONS;
  }
}

/** The seasons as admins set them, cached until one is changed */
export function getSeasons(): Promise<Season[]> {
  return orDefaults(
    unstable_cache(readForCache, ['season-settings'], { tags: [SEASONS_TAG], revalidate: 3600 })
  );
}

/** The same, read fresh: for the admin page and scripts, which run outside the cache */
export function loadSeasons(): Promise<Season[]> {
  return orDefaults(readInTime);
}

/** Save a season's settings, or put it back to its defaults with null */
export async function saveSeasonSettings(
  key: SeasonKey,
  settings: SeasonSettings | null
): Promise<void> {
  if (!settings) {
    await db.delete(seasonSettings).where(eq(seasonSettings.key, key));
    return;
  }
  const row = {
    startDay: settings.start,
    endDay: settings.end,
    short: settings.short,
    banner: settings.banner,
    enabled: settings.enabled,
    color: settings.color,
    fade: settings.fade,
    icon: settings.icon,
  };
  await db
    .insert(seasonSettings)
    .values({ key, ...row })
    .onConflictDoUpdate({ target: seasonSettings.key, set: { ...row, updatedAt: sql`now()` } });
}
