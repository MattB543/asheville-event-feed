import { and, arrayOverlaps, isNull, or, sql, type SQL } from 'drizzle-orm';
import { events } from './schema';
import { SUMMER_CAMP_TAG } from '@/lib/config/tagCategories';
import { CAMPS_SOURCE, campsRequested } from '@/lib/utils/eventFilterMatch';

/**
 * Live = shown in the feed: not moderated away (`hidden`, where NULL counts as
 * visible), not removed as a duplicate (`dedupedAt`), not a dead link (`deadAt`).
 * Every query for live events uses this, so a new removal flag goes here once.
 */
export const liveEvent = and(
  sql`${events.hidden} IS NOT TRUE`,
  isNull(events.dedupedAt),
  isNull(events.deadAt)
)!;

/** The same rule for a row already loaded. */
export function isLiveEvent(event: {
  hidden: boolean | null;
  dedupedAt: Date | null;
  deadAt: Date | null;
}): boolean {
  return !event.hidden && !event.dedupedAt && !event.deadAt;
}

/**
 * Not a summer camp (isCampEvent in lib/utils/eventFilterMatch.ts). IS NOT TRUE because an
 * untagged row's `tags && ...` is NULL, and NOT NULL would drop it.
 */
export const notCampEvent = sql`(${or(
  sql`${events.source} = ${CAMPS_SOURCE}`,
  arrayOverlaps(events.tags, [SUMMER_CAMP_TAG])
)}) IS NOT TRUE`;

/**
 * Camps are listed only when the tag filter asks for them (campsRequested): the conditions to
 * add to a listing query filtered by `tagsInclude`. Top 30 uses notCampEvent outright.
 */
export function campOptIn(tagsInclude: readonly string[] | null | undefined): SQL[] {
  return campsRequested(tagsInclude) ? [] : [notCampEvent];
}
