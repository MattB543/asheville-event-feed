import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { isNonNCEvent } from '@/lib/utils/locationFilter';
import { findDuplicates, getIdsToRemove } from '@/lib/utils/deduplication';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';

export const maxDuration = 300; // 5 minutes max

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

  try {
    console.log('[Cleanup] Starting dead event cleanup...');

    // Fetch all Eventbrite events (they're the ones that get moderated/deleted)
    const eventbriteEvents = await db
      .select({
        id: events.id,
        title: events.title,
        url: events.url,
      })
      .from(events)
      .where(eq(events.source, 'EVENTBRITE'));

    console.log(`[Cleanup] Checking ${eventbriteEvents.length} Eventbrite events...`);

    const deadEvents: DeadEvent[] = [];
    const batchSize = 10;

    // Check URLs in batches
    for (let i = 0; i < eventbriteEvents.length; i += batchSize) {
      const batch = eventbriteEvents.slice(i, i + batchSize);

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

    // Step 3: Remove duplicate events
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

    console.log(`[Cleanup] Found ${duplicateIdsToRemove.length} duplicate events to remove.`);

    if (duplicateIdsToRemove.length > 0) {
      const deleteBatchSize = 50;
      for (let i = 0; i < duplicateIdsToRemove.length; i += deleteBatchSize) {
        const batch = duplicateIdsToRemove.slice(i, i + deleteBatchSize);
        await db.delete(events).where(inArray(events.id, batch));
      }
      console.log(`[Cleanup] Deleted ${duplicateIdsToRemove.length} duplicate events.`);
    }

    console.log(`[Cleanup] Cleanup complete. Deleted ${deadEvents.length} dead + ${nonNCEventIds.length} non-NC + ${duplicateIdsToRemove.length} duplicate events.`);

    return NextResponse.json({
      success: true,
      checked: eventbriteEvents.length,
      deletedDead: deadEvents.length,
      deletedNonNC: nonNCEventIds.length,
      deletedDuplicates: duplicateIdsToRemove.length,
      deadEvents: deadEvents.map((e) => ({
        title: e.title,
        status: e.status,
      })),
      nonNCEvents: nonNCEventTitles.slice(0, 20),
      duplicateGroups: duplicateGroups.length,
    });
  } catch (error) {
    console.error('[Cleanup] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
