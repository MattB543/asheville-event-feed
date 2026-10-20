import { and, isNull, sql } from 'drizzle-orm';
import { events } from './schema';

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
