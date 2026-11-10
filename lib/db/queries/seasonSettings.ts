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

// Every page's header reads these, so a failed read means the defaults, never a broken page
async function orDefaults(read: () => ReturnType<typeof readSettings>): Promise<Season[]> {
  try {
    return withSettings(new Map((await read()).map(({ key, ...settings }) => [key, settings])));
  } catch (error) {
    console.error('[Seasons] Could not read the season settings, using the defaults:', error);
    return DEFAULT_SEASONS;
  }
}

/** The seasons as admins set them, cached until one is changed */
export function getSeasons(): Promise<Season[]> {
  return orDefaults(
    unstable_cache(readSettings, ['season-settings'], { tags: [SEASONS_TAG], revalidate: 3600 })
  );
}

/** The same, read fresh: for the admin page and scripts, which run outside the cache */
export function loadSeasons(): Promise<Season[]> {
  return orDefaults(readSettings);
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
