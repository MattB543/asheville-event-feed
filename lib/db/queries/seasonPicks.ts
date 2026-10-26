import { unstable_cache } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { seasonPicks } from '@/lib/db/schema';

export const SEASON_PICKS_TAG = 'season-picks';

export interface SeasonPick {
  eventId: string;
  added: boolean;
  hidden: boolean;
  posterUrl: string | null;
}

/** A season's hand edits, by event id. Cached until an admin changes one. */
export async function getSeasonPicks(season: string): Promise<Map<string, SeasonPick>> {
  const rows = await unstable_cache(
    () =>
      db
        .select({
          eventId: seasonPicks.eventId,
          added: seasonPicks.added,
          hidden: seasonPicks.hidden,
          posterUrl: seasonPicks.posterUrl,
        })
        .from(seasonPicks)
        .where(eq(seasonPicks.season, season)),
    ['season-picks', season],
    // Admin changes refresh it at once; the hour is a backstop for edits made straight in the database
    { tags: [SEASON_PICKS_TAG], revalidate: 3600 }
  )();
  return new Map(rows.map((row) => [row.eventId, row]));
}

/** Change one event's hand edits; fields left out keep their value */
export async function setSeasonPick(
  season: string,
  eventId: string,
  change: Partial<Pick<SeasonPick, 'added' | 'hidden' | 'posterUrl'>>
): Promise<void> {
  await db
    .insert(seasonPicks)
    .values({ season, eventId, ...change })
    .onConflictDoUpdate({
      target: [seasonPicks.season, seasonPicks.eventId],
      set: { ...change, updatedAt: sql`now()` },
    });
}
