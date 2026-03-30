import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
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

/** Max events to verify per run - conservative to fit within timeout */
const MAX_EVENTS_PER_RUN = 30;

/**
 * Event verification cron job.
 *
 * Fetches event source pages via Jina Reader API and uses AI to:
 * - Fill in missing descriptions
 * - Fill in missing price data
 * - Detect cancelled/postponed events
 *
 * Only verifies events that:
 * - Have never been verified before
 * - Are missing description (null or < 50 chars) OR missing price data
 * - Are future events (startDate >= now)
 * - Are from verifiable sources (AVL_TODAY, EXPLORE_ASHEVILLE, MOUNTAIN_X)
 *
 * Runs every 3 hours, processes up to 30 events per run.
 */
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startTime = Date.now();
  const runId = await startCronJob('verify');
  let currentStep = 'initialization';
  let eventsProcessedBeforeError = 0;

  try {
    console.log('[Verify] Starting event verification job...');

    // Check if verification is enabled
    if (!isVerificationEnabled()) {
      const message = 'Verification not enabled - check JINA_API_KEY and Azure AI config';
      console.warn(`[Verify] ${message}`);
      await completeCronJob(runId, { skipped: true, reason: message });
      return NextResponse.json({ success: true, skipped: true, reason: message });
    }

    const now = new Date();

    // Query events to verify - only events that:
    // 1. Have NEVER been verified (no re-verification)
    // 2. Are MISSING data: short/no description OR no price (either triggers verification)
    // 3. Are future events from verifiable sources
    currentStep = 'querying events needing verification';
    console.log(
      `[Verify] Querying events needing verification (sources: ${VERIFIABLE_SOURCES.join(', ')}, limit: ${MAX_EVENTS_PER_RUN})...`
    );
    const queryStart = Date.now();

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
          // Only verifiable sources
          inArray(events.source, [...VERIFIABLE_SOURCES]),
          // Not hidden
          eq(events.hidden, false),
          // Future events only
          gte(events.startDate, now),
          // NEVER verified before (no re-verification)
          isNull(events.lastVerifiedAt),
          // Missing description OR missing price (either triggers verification)
          or(
            // Missing/short description
            isNull(events.description),
            sql`LENGTH(${events.description}) < 50`,
            // Missing price (NULL or 'Unknown', but 'Ticketed'/'Free'/'$X' are OK)
            isNull(events.price),
            eq(events.price, 'Unknown')
          )
        )
      )
      .orderBy(events.startDate) // Closest events first
      .limit(MAX_EVENTS_PER_RUN);

    const queryDuration = ((Date.now() - queryStart) / 1000).toFixed(1);
    console.log(
      `[Verify] Found ${eventsToVerify.length} events needing verification in ${queryDuration}s`
    );

    // Filter out spam events based on default filters
    currentStep = 'spam filtering';
    const filteredEvents = eventsToVerify.filter((event) => {
      if (matchesDefaultFilter(event.title)) return false;
      if (event.description && matchesDefaultFilter(event.description)) return false;
      if (event.organizer && matchesDefaultFilter(event.organizer)) return false;
      return true;
    });

    const spamFiltered = eventsToVerify.length - filteredEvents.length;
    if (spamFiltered > 0) {
      const spamExamples = eventsToVerify
        .filter(
          (e) =>
            matchesDefaultFilter(e.title) ||
            (e.description && matchesDefaultFilter(e.description)) ||
            (e.organizer && matchesDefaultFilter(e.organizer))
        )
        .slice(0, 3)
        .map((e) => `"${e.title.slice(0, 50)}"`)
        .join(', ');
      console.log(`[Verify] Filtered out ${spamFiltered} spam events (e.g. ${spamExamples})`);
    }

    // Process verification (already limited by query, but enforce here too)
    currentStep = 'processing event verification';
    const verificationResult = await processEventVerification(
      filteredEvents as EventForVerification[],
      {
        maxEvents: MAX_EVENTS_PER_RUN,
        verbose: true,
      }
    );

    // Apply results to database
    currentStep = 'applying DB updates';
    const hiddenEvents: Array<{ title: string; reason: string; url?: string }> = [];
    const updatedEvents: Array<{ title: string; reason: string; url?: string }> = [];
    let keptCount = 0;
    let skippedErrorCount = 0;

    for (const result of verificationResult.results) {
      const event = filteredEvents.find((e) => e.id === result.eventId);
      eventsProcessedBeforeError++;

      if (result.action === 'hide' && result.confidence >= 0.8) {
        // Hide the event (set hidden = true)
        try {
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

          console.log(
            `[Verify] DB hide: "${result.eventTitle.slice(0, 50)}" - ${result.reason} (confidence: ${result.confidence})`
          );
        } catch (dbError) {
          console.error(
            `[Verify] DB error hiding "${result.eventTitle.slice(0, 50)}": ${dbError instanceof Error ? dbError.message : String(dbError)}`
          );
        }
      } else if (result.action === 'update' && result.updates) {
        // Update the event with new details
        const updateData: Record<string, unknown> = {
          lastVerifiedAt: now,
          updatedAt: now,
        };

        const fieldChanges: string[] = [];
        if (result.updates.price) {
          updateData.price = result.updates.price;
          fieldChanges.push(`price: "${event?.price || 'null'}" -> "${result.updates.price}"`);
        }
        if (result.updates.description) {
          updateData.description = result.updates.description;
          const oldDesc = event?.description ? `${event.description.length} chars` : 'null';
          fieldChanges.push(
            `description: ${oldDesc} -> ${result.updates.description.length} chars`
          );
        }
        if (result.updates.location) {
          updateData.location = result.updates.location;
          fieldChanges.push(
            `location: "${event?.location || 'null'}" -> "${result.updates.location}"`
          );
        }

        try {
          await db.update(events).set(updateData).where(eq(events.id, result.eventId));

          updatedEvents.push({
            title: result.eventTitle,
            reason: result.reason,
            url: event?.url,
          });

          console.log(
            `[Verify] DB update: "${result.eventTitle.slice(0, 50)}" - ${fieldChanges.join(', ')}`
          );
        } catch (dbError) {
          console.error(
            `[Verify] DB error updating "${result.eventTitle.slice(0, 50)}": ${dbError instanceof Error ? dbError.message : String(dbError)}`
          );
        }
      } else if (!result.error) {
        // Only update lastVerifiedAt for successful "keep" events
        // Don't update if fetch failed - we need to retry when site is back up
        try {
          await db.update(events).set({ lastVerifiedAt: now }).where(eq(events.id, result.eventId));
          keptCount++;
        } catch (dbError) {
          console.error(
            `[Verify] DB error marking kept "${result.eventTitle.slice(0, 50)}": ${dbError instanceof Error ? dbError.message : String(dbError)}`
          );
        }
      } else {
        skippedErrorCount++;
      }
      // Skip updating lastVerifiedAt if there was an error (site down, fetch failed, etc.)
    }

    if (keptCount > 0) {
      console.log(`[Verify] Marked ${keptCount} events as verified (keep, no changes needed)`);
    }
    if (skippedErrorCount > 0) {
      console.log(
        `[Verify] Skipped lastVerifiedAt update for ${skippedErrorCount} events with errors (will retry)`
      );
    }

    // Invalidate cache if any events were modified
    currentStep = 'cache invalidation';
    if (hiddenEvents.length > 0 || updatedEvents.length > 0) {
      console.log(
        `[Verify] Invalidating cache (${hiddenEvents.length} hidden, ${updatedEvents.length} updated)...`
      );
      invalidateEventsCache();
    }

    // Send Slack notification
    currentStep = 'sending Slack notification';
    const slackResult = await sendVerificationNotification({
      eventsChecked: verificationResult.eventsChecked,
      eventsHidden: hiddenEvents.length,
      eventsUpdated: updatedEvents.length,
      eventsKept: verificationResult.eventsKept,
      hiddenEvents,
      updatedEvents,
      durationSeconds: verificationResult.durationMs / 1000,
    });
    if (hiddenEvents.length > 0 || updatedEvents.length > 0) {
      console.log(`[Verify] Slack notification: ${slackResult ? 'sent' : 'skipped or failed'}`);
    }

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
      totalTokensUsed: verificationResult.totalTokensUsed,
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
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(
      `[Verify] Fatal error during step "${currentStep}" after processing ${eventsProcessedBeforeError} events (${elapsed}s):`,
      error
    );

    await failCronJob(runId, error);

    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
