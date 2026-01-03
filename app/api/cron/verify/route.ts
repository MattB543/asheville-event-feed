import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { sendVerificationNotification } from '@/lib/notifications/slack';
import {
  VERIFIABLE_SOURCES,
  isVerificationEnabled,
  processEventVerification,
  type EventForVerification,
} from '@/lib/ai/eventVerification';
import { matchesDefaultFilter } from '@/lib/config/defaultFilters';

export const maxDuration = 800; // ~13 minutes max (Fluid Compute)

/**
 * Event verification cron job.
 *
 * Fetches event source pages via Jina Reader API and uses AI to verify:
 * - Cancelled or postponed events
 * - Updated event details (price, description, location)
 * - Wrong pages (404, generic content)
 *
 * Runs twice daily at 6 AM and 6 PM ET.
 */
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startTime = Date.now();
  const runId = await startCronJob('verify');

  try {
    console.log('[Verify] Starting event verification job...');

    // Check if verification is enabled
    if (!isVerificationEnabled()) {
      const message = 'Verification not enabled - check JINA_API_KEY and Azure AI config';
      console.warn(`[Verify] ${message}`);
      await completeCronJob(runId, { skipped: true, reason: message });
      return NextResponse.json({ success: true, skipped: true, reason: message });
    }

    // Calculate date windows
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    // Query events to verify:
    // - From verifiable sources (AVL_TODAY, EXPLORE_ASHEVILLE, MOUNTAIN_X)
    // - Not hidden
    // - Future events
    // - Not verified in last 10 days (or never verified)
    // - Limit to 1000 events into the future
    const eventsToVerify = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        startDate: events.startDate,
        location: events.location,
        organizer: events.organizer,
        price: events.price,
        url: events.url,
        source: events.source,
        lastVerifiedAt: events.lastVerifiedAt,
      })
      .from(events)
      .where(
        and(
          inArray(events.source, [...VERIFIABLE_SOURCES]),
          eq(events.hidden, false),
          gte(events.startDate, now),
          or(isNull(events.lastVerifiedAt), lte(events.lastVerifiedAt, tenDaysAgo))
        )
      )
      .orderBy(events.startDate) // Most imminent first
      .limit(1000);

    console.log(`[Verify] Found ${eventsToVerify.length} events eligible for verification`);

    // Filter out spam events based on default filters
    const filteredEvents = eventsToVerify.filter((event) => {
      if (matchesDefaultFilter(event.title)) return false;
      if (event.description && matchesDefaultFilter(event.description)) return false;
      if (event.organizer && matchesDefaultFilter(event.organizer)) return false;
      return true;
    });

    const spamFiltered = eventsToVerify.length - filteredEvents.length;
    if (spamFiltered > 0) {
      console.log(`[Verify] Filtered out ${spamFiltered} spam events`);
    }

    // Process verification (limit to 500 per run, within 500 RPM rate limit)
    const verificationResult = await processEventVerification(
      filteredEvents as EventForVerification[],
      {
        maxEvents: 500,
        verbose: true,
      }
    );

    // Apply results to database
    const hiddenEvents: Array<{ title: string; reason: string; url?: string }> = [];
    const updatedEvents: Array<{ title: string; reason: string; url?: string }> = [];

    for (const result of verificationResult.results) {
      const event = filteredEvents.find((e) => e.id === result.eventId);

      if (result.action === 'hide' && result.confidence >= 0.8) {
        // Hide the event (set hidden = true)
        await db
          .update(events)
          .set({
            hidden: true,
            lastVerifiedAt: now,
            updatedAt: now,
          })
          .where(eq(events.id, result.eventId));

        hiddenEvents.push({
          title: result.eventTitle,
          reason: result.reason,
          url: event?.url,
        });

        console.log(`[Verify] Hidden: ${result.eventTitle} - ${result.reason}`);
      } else if (result.action === 'update' && result.updates) {
        // Update the event with new details
        const updateData: Record<string, unknown> = {
          lastVerifiedAt: now,
          updatedAt: now,
        };

        if (result.updates.price) {
          updateData.price = result.updates.price;
        }
        if (result.updates.description) {
          updateData.description = result.updates.description;
        }
        if (result.updates.location) {
          updateData.location = result.updates.location;
        }

        await db.update(events).set(updateData).where(eq(events.id, result.eventId));

        updatedEvents.push({
          title: result.eventTitle,
          reason: result.reason,
          url: event?.url,
        });

        console.log(`[Verify] Updated: ${result.eventTitle} - ${result.reason}`);
      } else if (!result.error) {
        // Only update lastVerifiedAt for successful "keep" events
        // Don't update if fetch failed - we need to retry when site is back up
        await db.update(events).set({ lastVerifiedAt: now }).where(eq(events.id, result.eventId));
      }
      // Skip updating lastVerifiedAt if there was an error (site down, fetch failed, etc.)
    }

    // Invalidate cache if any events were modified
    if (hiddenEvents.length > 0 || updatedEvents.length > 0) {
      invalidateEventsCache();
    }

    // Send Slack notification
    await sendVerificationNotification({
      eventsChecked: verificationResult.eventsChecked,
      eventsHidden: hiddenEvents.length,
      eventsUpdated: updatedEvents.length,
      eventsKept: verificationResult.eventsKept,
      hiddenEvents,
      updatedEvents,
      durationSeconds: verificationResult.durationMs / 1000,
    });

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

    const resultSummary = {
      eventsEligible: eventsToVerify.length,
      eventsFiltered: filteredEvents.length,
      spamFiltered,
      eventsChecked: verificationResult.eventsChecked,
      eventsHidden: hiddenEvents.length,
      eventsUpdated: updatedEvents.length,
      eventsKept: verificationResult.eventsKept,
      eventsSkipped: verificationResult.eventsSkipped,
      errors: verificationResult.errors,
      durationSeconds: parseFloat(totalDuration),
    };

    console.log(`[Verify] Complete in ${totalDuration}s`);
    console.log(`[Verify] Summary: ${JSON.stringify(resultSummary)}`);

    await completeCronJob(runId, resultSummary);

    return NextResponse.json({
      success: true,
      ...resultSummary,
      hiddenEvents: hiddenEvents.slice(0, 20),
      updatedEvents: updatedEvents.slice(0, 20),
    });
  } catch (error) {
    console.error('[Verify] Error:', error);

    await failCronJob(runId, error);

    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
