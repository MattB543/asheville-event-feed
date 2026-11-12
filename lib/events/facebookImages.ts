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

// Real photos are a few hundred KB; this stops a bad link filling memory
const MAX_BYTES = 10 * 1024 * 1024;

// The link's expiry is the hex Unix time in its `oe` parameter. A link without a well-formed
// one is tried, and an odd value can't make the whole query fail
const linkExpired = sql`COALESCE(to_timestamp(('x' || lpad(substring(${events.imageUrl} from '[?&]oe=([0-9A-Fa-f]{1,8})(&|$)'), 8, '0'))::bit(32)::bigint) < now(), false)`;

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
          // The SQL match is a substring; only Facebook's own servers get fetched
          const link = new URL(imageUrl!);
          if (link.protocol !== 'https:' || !link.hostname.endsWith('.fbcdn.net')) {
            throw new Error('not a Facebook image link');
          }
          // A redirect could lead off Facebook's servers
          const response = await fetch(link, {
            redirect: 'error',
            signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (Number(response.headers.get('content-length')) > MAX_BYTES) {
            throw new Error('image too large');
          }
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > MAX_BYTES) throw new Error('image too large');
          const image = await normalizeImage(bytes);
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
