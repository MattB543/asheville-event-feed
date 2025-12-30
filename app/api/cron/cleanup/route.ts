import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { inArray, sql, eq } from 'drizzle-orm';
import { isNonNCEvent } from '@/lib/utils/geo';
import { findDuplicates, getIdsToRemove, getDescriptionUpdates } from '@/lib/utils/deduplication';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';

export const maxDuration = 300; // 5 minutes max

/**
 * Determine which date window to check based on time of day.
 * - Daytime runs (6x): Check events happening in days 0-7 (imminent events)
 * - Nighttime runs (2x): Check events happening in days 8-14 (upcoming events)
 *
 * This ensures events happening soon get checked 6x/day while events
 * further out still get checked 2x/day.
 */
function getDateWindowForRun(): { startDays: number; endDays: number; label: string } {
  const hour = new Date().getUTCHours();
  // Daytime (7-22 UTC): Next 7 days (imminent events, checked 6x/day)
  // Nighttime (outside 7-22 UTC): Days 8-14 (upcoming events, checked 2x/day)
  if (hour >= 7 && hour < 23) {
    return { startDays: 0, endDays: 7, label: 'days 0-7 (imminent)' };
  } else {
    return { startDays: 8, endDays: 14, label: 'days 8-14 (upcoming)' };
  }
}

interface DeadEvent {
  id: string;
  title: string;
  url: string;
  status: number;
}

async function checkUrl(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
    });
    return response.status;
  } catch {
    return 0; // Network error
  }
}

export async function GET(request: Request) {
  // Verify cron secret (timing-safe comparison)
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startTime = Date.now();
  const runId = await startCronJob('cleanup');

  try {
    const { startDays, endDays, label } = getDateWindowForRun();

    console.log(`[Cleanup] Starting cleanup job (window: ${label})...`);

    // Calculate date window based on time of day
    // Daytime: check events happening in next 7 days (imminent, 6x/day coverage)
    // Nighttime: check events happening in days 8-14 (upcoming, 2x/day coverage)
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() + startDays);
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + endDays);
    windowEnd.setHours(23, 59, 59, 999);

    const eventbriteEvents = await db
      .select({
        id: events.id,
        title: events.title,
        url: events.url,
      })
      .from(events)
      .where(sql`
        ${events.source} = 'EVENTBRITE'
        AND ${events.startDate} >= ${windowStart.toISOString()}
        AND ${events.startDate} <= ${windowEnd.toISOString()}
      `);

    console.log(`[Cleanup] Checking ${eventbriteEvents.length} Eventbrite events (${label})...`);

    const deadEvents: DeadEvent[] = [];
    const batchSize = 10;

    // Check URLs in batches with progress logging
    const totalBatches = Math.ceil(eventbriteEvents.length / batchSize);
    for (let i = 0; i < eventbriteEvents.length; i += batchSize) {
      const batch = eventbriteEvents.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      const results = await Promise.all(
        batch.map(async (event) => {
          const status = await checkUrl(event.url);
          return { event, status };
        })
      );

      for (const { event, status } of results) {
        if (status === 404 || status === 410) {
          console.log(`[Cleanup] Dead: ${event.title.substring(0, 50)}...`);
          deadEvents.push({
            id: event.id,
            title: event.title,
            url: event.url,
            status,
          });
        }
      }

      // Log progress every 5 batches
      if (batchNum % 5 === 0 || batchNum === totalBatches) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Cleanup] URL check progress: ${Math.min(i + batchSize, eventbriteEvents.length)}/${eventbriteEvents.length} (${elapsed}s elapsed)`);
      }

      // Small delay between batches to be polite to Eventbrite
      if (i + batchSize < eventbriteEvents.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    console.log(`[Cleanup] Found ${deadEvents.length} dead events.`);

    // Delete dead events in batch (instead of one at a time)
    if (deadEvents.length > 0) {
      const deadIds = deadEvents.map(e => e.id);
      await db.delete(events).where(inArray(events.id, deadIds));
      for (const deadEvent of deadEvents) {
        console.log(`[Cleanup] Deleted: ${deadEvent.title.substring(0, 40)}...`);
      }
    }

    console.log(`[Cleanup] Dead event cleanup complete. Deleted ${deadEvents.length} dead events.`);

    // Step 2: Clean up non-NC events (events outside North Carolina)
    console.log('[Cleanup] Checking for non-NC events...');
    const allEvents = await db
      .select({
        id: events.id,
        title: events.title,
        location: events.location,
      })
      .from(events);

    const nonNCEventIds: string[] = [];
    const nonNCEventTitles: string[] = [];

    for (const event of allEvents) {
      if (isNonNCEvent(event.title, event.location)) {
        nonNCEventIds.push(event.id);
        nonNCEventTitles.push(event.title);
      }
    }

    console.log(`[Cleanup] Found ${nonNCEventIds.length} non-NC events.`);

    // Delete non-NC events in batches
    if (nonNCEventIds.length > 0) {
      const deleteBatchSize = 50;
      for (let i = 0; i < nonNCEventIds.length; i += deleteBatchSize) {
        const batch = nonNCEventIds.slice(i, i + deleteBatchSize);
        await db.delete(events).where(inArray(events.id, batch));
      }
      console.log(`[Cleanup] Deleted ${nonNCEventIds.length} non-NC events.`);
    }

    console.log(`[Cleanup] Non-NC cleanup complete. Deleted ${nonNCEventIds.length} non-NC events.`);

    // Step 3: Remove cancelled events (title starts with "CANCELLED")
    console.log('[Cleanup] Checking for cancelled events...');
    const cancelledEventIds: string[] = [];
    const cancelledEventTitles: string[] = [];

    for (const event of allEvents) {
      if (event.title.trim().toUpperCase().startsWith('CANCELLED')) {
        cancelledEventIds.push(event.id);
        cancelledEventTitles.push(event.title);
      }
    }

    console.log(`[Cleanup] Found ${cancelledEventIds.length} cancelled events.`);

    // Delete cancelled events in batches
    if (cancelledEventIds.length > 0) {
      const deleteBatchSize = 50;
      for (let i = 0; i < cancelledEventIds.length; i += deleteBatchSize) {
        const batch = cancelledEventIds.slice(i, i + deleteBatchSize);
        await db.delete(events).where(inArray(events.id, batch));
      }
      console.log(`[Cleanup] Deleted ${cancelledEventIds.length} cancelled events.`);
    }

    // Step 4: Remove duplicate events
    console.log('[Cleanup] Checking for duplicate events...');
    const allEventsForDedup = await db
      .select({
        id: events.id,
        title: events.title,
        organizer: events.organizer,
        location: events.location,
        startDate: events.startDate,
        price: events.price,
        description: events.description,
        createdAt: events.createdAt,
      })
      .from(events);

    const duplicateGroups = findDuplicates(allEventsForDedup);
    const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);
    const descriptionUpdates = getDescriptionUpdates(duplicateGroups);

    console.log(`[Cleanup] Found ${duplicateIdsToRemove.length} duplicate events to remove.`);

    // Apply description merges before deleting duplicates
    // (keep the longer description from removed events)
    if (descriptionUpdates.length > 0) {
      for (const update of descriptionUpdates) {
        await db.update(events)
          .set({ description: update.description })
          .where(eq(events.id, update.id));
      }
      console.log(`[Cleanup] Merged ${descriptionUpdates.length} longer descriptions.`);
    }

    if (duplicateIdsToRemove.length > 0) {
      const deleteBatchSize = 50;
      for (let i = 0; i < duplicateIdsToRemove.length; i += deleteBatchSize) {
        const batch = duplicateIdsToRemove.slice(i, i + deleteBatchSize);
        await db.delete(events).where(inArray(events.id, batch));
      }
      console.log(`[Cleanup] Deleted ${duplicateIdsToRemove.length} duplicate events.`);
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalDeleted = deadEvents.length + nonNCEventIds.length + cancelledEventIds.length + duplicateIdsToRemove.length;
    console.log(`[Cleanup] Complete in ${totalDuration}s. Deleted ${totalDeleted} events (${deadEvents.length} dead, ${nonNCEventIds.length} non-NC, ${cancelledEventIds.length} cancelled, ${duplicateIdsToRemove.length} duplicates)`);

    // Invalidate cache so home page reflects removed events
    invalidateEventsCache();

    const result = {
      window: label,
      checked: eventbriteEvents.length,
      deletedDead: deadEvents.length,
      deletedNonNC: nonNCEventIds.length,
      deletedCancelled: cancelledEventIds.length,
      deletedDuplicates: duplicateIdsToRemove.length,
      duplicateGroups: duplicateGroups.length,
    };

    await completeCronJob(runId, result);

    return NextResponse.json({
      success: true,
      durationSeconds: parseFloat(totalDuration),
      ...result,
      deadEvents: deadEvents.map((e) => ({
        title: e.title,
        status: e.status,
      })),
      nonNCEvents: nonNCEventTitles.slice(0, 20),
      cancelledEvents: cancelledEventTitles.slice(0, 20),
    });
  } catch (error) {
    console.error('[Cleanup] Error:', error);

    await failCronJob(runId, error);

    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
