import { and, asc, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { publicEventColumns } from '@/lib/db/queries/publicEventColumns';
import { liveEvent } from '@/lib/db/liveEvent';

const MAX_IDS = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The valid, de-duplicated event ids from a list of favorites or a share link.
 * Malformed ids (a link cut off mid-id) are dropped rather than failing the query.
 */
export function cleanEventIds(ids: string[]): string[] {
  const valid = ids.map((id) => id.trim()).filter((id) => UUID_REGEX.test(id));
  return [...new Set(valid)].slice(0, MAX_IDS);
}

/** Live events for a list of ids, soonest first: favorites and shared Your List links */
export async function getEventsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select(publicEventColumns)
    .from(events)
    .where(and(inArray(events.id, ids), liveEvent))
    .orderBy(asc(events.startDate));
}
