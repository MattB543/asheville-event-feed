import { revalidateTag } from 'next/cache';

/**
 * Invalidate the events cache after DB mutations.
 * Call this after any cron job that modifies the events table.
 * `immediately` drops the cached lists outright, for an admin hiding or fixing an event: the
 * default profile would serve the old list to the next visitor while it refreshes.
 */
export function invalidateEventsCache({ immediately = false } = {}): void {
  try {
    // Next.js 16 requires a profile as second argument
    // Using "default" profile for standard cache behavior
    revalidateTag('events', immediately ? { expire: 0 } : 'default');
    console.log('[Cache] Invalidated events tag');
  } catch (error) {
    console.error('[Cache] Failed to invalidate:', error);
  }
}
