import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { liveEvent } from '@/lib/db/liveEvent';
import { normalizeImage } from '@/lib/posters/processUpload';
import { uploadEventImage } from '@/lib/supabase/storage';
import { FACEBOOK_CDN_LIKE, FACEBOOK_COPY_FOLDER } from '@/lib/utils/eventImages';
import { DEFAULT_FETCH_TIMEOUT_MS } from '@/lib/utils/retry';

const BATCH = 5;
// The scrape already runs up to 8 of its 13 minutes; whatever's left waits for the next run
const BUDGET_MS = 2 * 60_000;

function timeLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

// The link's expiry is the hex Unix time in its `oe` parameter; a link without one is tried
const linkExpired = sql`COALESCE(to_timestamp(('x' || lpad(substring(${events.imageUrl} from 'oe=([0-9A-Fa-f]+)'), 16, '0'))::bit(64)::bigint) < now(), false)`;

/**
 * Copies the Facebook images of upcoming live events into our own storage and points the
 * events at the copies, soonest first. An expired link can't be fetched, so it waits for
 * the next Facebook scrape to bring a fresh one.
 */
export async function copyFacebookImages(limit = 100) {
  const rows = await db
    .select({ id: events.id, imageUrl: events.imageUrl })
    .from(events)
    .where(
      and(
        liveEvent,
        gte(events.startDate, sql`now()`),
        sql`${events.imageUrl} LIKE ${FACEBOOK_CDN_LIKE}`,
        sql`NOT ${linkExpired}`,
        // An admin's chosen image stays
        sql`${events.editedFields} -> 'imageUrl' IS NULL`
      )
    )
    .orderBy(asc(events.startDate))
    .limit(limit);

  const stats = { candidates: rows.length, copied: 0, failed: 0 };
  const started = Date.now();
  for (let i = 0; i < rows.length && Date.now() - started < BUDGET_MS; i += BATCH) {
    await Promise.all(
      rows.slice(i, i + BATCH).map(async ({ id, imageUrl }) => {
        try {
          const response = await fetch(imageUrl!, {
            signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const image = await normalizeImage(Buffer.from(await response.arrayBuffer()));
          if (!image.ok) throw new Error(image.message);
          const url = await timeLimit(
            uploadEventImage(image.buffer, id, 'image/jpeg', FACEBOOK_COPY_FOLDER),
            DEFAULT_FETCH_TIMEOUT_MS
          );
          // A new event on the URL reuses the path, so the query string keeps caches honest;
          // a row whose image changed meanwhile keeps the newer one
          const updated = await db
            .update(events)
            .set({ imageUrl: `${url}?v=${Date.now()}` })
            .where(and(eq(events.id, id), eq(events.imageUrl, imageUrl!)))
            .returning({ id: events.id });
          if (updated.length > 0) stats.copied++;
        } catch (error) {
          stats.failed++;
          console.warn(
            `[FacebookImages] ${id.slice(0, 8)} not copied: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );
  }
  return stats;
}
