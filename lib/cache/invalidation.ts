import { revalidateTag } from 'next/cache';

/**
 * Invalidate the events cache after DB mutations.
 * Call this after any cron job that modifies the events table.
 */
export function invalidateEventsCache(): void {
  try {
    // Next.js 16 requires a profile as second argument
    // Using "default" profile for standard cache behavior
    revalidateTag('events', 'default');
    console.log('[Cache] Invalidated events tag');
  } catch (error) {
    console.error('[Cache] Failed to invalidate:', error);
  }
}
