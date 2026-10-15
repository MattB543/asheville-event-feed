import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { sendVerificationNotification } from '@/lib/notifications/slack';
import { THIN_DESCRIPTION_LENGTH } from '@/lib/config/verification';
import {
  MAX_EVENT_MS,
  UNVERIFIABLE_URL_PATTERN,
  VERIFIABLE_SOURCES,
  isVerificationEnabled,
  runVerification,
  type VerificationOutcome,
} from '@/lib/ai/eventVerification';
import { matchesDefaultFilter } from '@/lib/config/defaultFilters';
import { liveEvent } from '@/lib/db/liveEvent';

export const maxDuration = 800; // ~13 minutes max (Fluid Compute)

/** Max events to verify per run - conservative to fit within timeout */
const MAX_EVENTS_PER_RUN = 30;

/**
 * Stop starting new events this long into the run: the last one can take
 * MAX_EVENT_MS, and the dead-link writes, run record and Slack still have to
 * fit inside maxDuration after it.
 */
const START_DEADLINE_MS = maxDuration * 1000 - MAX_EVENT_MS - 60_000;

/**
 * Event verification cron job.
 *
 * Fetches event source pages via Jina Reader API and uses AI to:
 * - Fill in missing descriptions and prices
 * - Detect cancelled/postponed events (hidden)
 * - Detect pages that 404 for events the scrapers no longer list (deadAt)
 *
 * Only verifies events that:
 * - Have never been verified before
 * - Are missing description (null or < 50 chars) OR missing price data, OR have
 *   a retry pending (e.g. a 404 on an event its source still listed)
 * - Have a page about the event (see UNVERIFIABLE_URL_PATTERN)
 * - Are future events (startDate >= now)
 * - Are live (not hidden, deduped, or dead) and not backing off from a failed attempt
 * - Are from verifiable sources (AVL_TODAY, EXPLORE_ASHEVILLE, MOUNTAIN_X)
 *
 * Thin descriptions go first (they show on the site; a missing price mostly
 * can't be found on the page), soonest first within each group.
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
  let runId: string | null = null;
  try {
    runId = await startCronJob('verify');
  } catch (trackerErr) {
    console.error(
      '[Verify] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
  }
  let currentStep = 'initialization';

  // Every outcome goes into the run's record: cron_job_runs is the only durable
  // trail (Vercel logs last ~1h). Kept outside the try so a failed run still
  // records what it had already written. Restore a bad hide with hidden = false,
  // a bad dead mark with dead_at = NULL.
  const outcomes: VerificationOutcome[] = [];

  try {
    console.log('[Verify] Starting event verification job...');

    // Check if verification is enabled
    if (!isVerificationEnabled()) {
      const message = 'Verification not enabled - check Azure AI config';
      console.warn(`[Verify] ${message}`);
      await completeCronJob(runId, { skipped: true, reason: message });
      return NextResponse.json({ success: true, skipped: true, reason: message });
    }

    const now = new Date();
    const isThin = or(
      isNull(events.description),
      sql`LENGTH(${events.description}) < ${THIN_DESCRIPTION_LENGTH}`
    );

    currentStep = 'querying events needing verification';
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
        lastSeenAt: events.lastSeenAt,
        verifyAttempts: events.verifyAttempts,
      })
      .from(events)
      .where(
        and(
          // Only verifiable sources, and only rows with a page about the event
          inArray(events.source, [...VERIFIABLE_SOURCES]),
          sql`${events.url} !~* ${UNVERIFIABLE_URL_PATTERN}`,
          liveEvent,
          // Future events only
          gte(events.startDate, now),
          // NEVER verified before (no re-verification)
          isNull(events.lastVerifiedAt),
          // Respect the failure backoff: NULL means "never failed / due now"
          or(isNull(events.verifyNextAttemptAt), lte(events.verifyNextAttemptAt, now)),
          // Missing description OR missing price (NULL or 'Unknown'; 'Ticketed'/'Free'/'$X'
          // are OK), OR a retry is pending: a deferred 404 must still be re-checked
          // after a scrape fills the missing data, to be marked dead once unlisted
          or(
            isThin,
            isNull(events.price),
            eq(events.price, 'Unknown'),
            gt(events.verifyAttempts, 0)
          )
        )
      )
      // The backoff already keeps a failing row from holding the head of the queue
      .orderBy(sql`(${isThin}) DESC`, asc(events.startDate))
      // Headroom for the spam filter below, which can't run in SQL
      .limit(MAX_EVENTS_PER_RUN * 2);
    console.log(`[Verify] Found ${eventsToVerify.length} events needing verification`);

    // Filter out spam events based on default filters
    currentStep = 'spam filtering';
    const isSpam = (event: (typeof eventsToVerify)[number]) =>
      matchesDefaultFilter(event.title) ||
      (!!event.description && matchesDefaultFilter(event.description)) ||
      (!!event.organizer && matchesDefaultFilter(event.organizer));
    const filteredEvents = eventsToVerify.filter((e) => !isSpam(e)).slice(0, MAX_EVENTS_PER_RUN);
    const spamFiltered = eventsToVerify.filter(isSpam).length;

    currentStep = 'verifying events';
    const stats = await runVerification(filteredEvents, {
      now,
      deadline: startTime + START_DEADLINE_MS,
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    const byOutcome = (kind: VerificationOutcome['outcome']) =>
      outcomes.filter((o) => o.outcome === kind);

    currentStep = 'cache invalidation';
    if (outcomes.some((o) => ['updated', 'hidden', 'dead'].includes(o.outcome))) {
      invalidateEventsCache();
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const resultSummary = {
      eventsEligible: eventsToVerify.length,
      eventsFiltered: filteredEvents.length,
      spamFiltered,
      eventsChecked: stats.eventsChecked,
      eventsSkipped: stats.eventsSkipped,
      eventsNotAttempted: stats.eventsNotAttempted,
      stoppedEarly: stats.stoppedEarly ?? null,
      eventsKept: byOutcome('kept').length,
      eventsUpdated: byOutcome('updated').length,
      eventsHidden: byOutcome('hidden').length,
      eventsDead: byOutcome('dead').length,
      eventsUnverifiable: byOutcome('unverifiable').length,
      eventsDeferred: byOutcome('deferred').length,
      eventsStale: byOutcome('stale').length,
      errors: byOutcome('write_failed').length,
      totalTokensUsed: stats.totalTokensUsed,
      durationSeconds: parseFloat(totalDuration),
    };
    console.log(`[Verify] Summary: ${JSON.stringify(resultSummary)}`);

    // Recorded before Slack, so the record doesn't depend on the webhook
    currentStep = 'recording the run';
    await completeCronJob(runId, { ...resultSummary, outcomes });

    currentStep = 'sending Slack notification';
    await sendVerificationNotification({
      eventsChecked: stats.eventsChecked,
      eventsKept: resultSummary.eventsKept,
      hiddenEvents: byOutcome('hidden'),
      deadEvents: byOutcome('dead'),
      updatedEvents: byOutcome('updated'),
      durationSeconds: parseFloat(totalDuration),
    });

    return NextResponse.json({ success: true, ...resultSummary, outcomes });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[Verify] Fatal error during step "${currentStep}" (${elapsed}s):`, error);

    // Events already written stay written; keep their record with the error
    if (outcomes.some((o) => ['updated', 'hidden', 'dead'].includes(o.outcome))) {
      invalidateEventsCache();
    }
    await failCronJob(runId, error, { outcomes });

    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
