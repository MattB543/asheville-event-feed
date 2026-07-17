/**
 * AI-powered deduplication cron job.
 *
 * Runs daily at 5 AM ET to catch semantic duplicates that rule-based
 * deduplication might miss.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { and, gte, inArray, lte } from 'drizzle-orm';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import {
  runAIDeduplication,
  isAIDeduplicationAvailable,
  type EventForAIDedup,
} from '@/lib/ai/aiDeduplication';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';

export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startTime = Date.now();
  let runId: string;
  try {
    runId = await startCronJob('dedup');
    console.log(`[Dedup] Cron job tracker started (runId: ${runId})`);
  } catch (trackerErr) {
    console.error(
      '[Dedup] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
    runId = 'unknown';
  }

  try {
    console.log('[Dedup] ════════════════════════════════════════════════');
    console.log('[Dedup] Starting AI deduplication job...');

    // Check if Azure AI is configured
    if (!isAIDeduplicationAvailable()) {
      console.log('[Dedup] Azure AI not configured, skipping.');
      try {
        await completeCronJob(runId, { skipped: true, reason: 'Azure AI not configured' });
        console.log('[Dedup] Cron job tracker completed (skipped)');
      } catch (trackerErr) {
        console.error(
          '[Dedup] Failed to complete cron job tracker:',
          trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
        );
      }
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Azure AI not configured',
      });
    }

    // Fetch upcoming "Top Events" for AI analysis.
    //
    // Scoping here is essential on two axes:
    //  1. Date: runAIDeduplication sorts dates ascending and processes only the
    //     first `maxDays` of them. Without a lower bound, stale past events
    //     (going back years) fill the window and upcoming dates are never checked.
    //  2. Score: only events with score >= TOP_EVENT_SCORE ("Top Events") are
    //     shown by default to all visitors, so those are the ones that matter to
    //     dedup. Restricting to them shrinks each day's list ~4x, which both cuts
    //     tokens and improves accuracy (dupes are easier to spot in a short list),
    //     letting us cover the full 30-day Top-30 window instead of ~11 days.
    //     Duplicates among lower-scored events are hidden by default anyway.
    const TOP_EVENT_SCORE = 15; // matches getEventScoreTier() in EventFeed.tsx
    const DEDUP_WINDOW_DAYS = 31; // today + next 30 days (Top-30 window)
    const now = new Date();
    // Include events from the start of today (ET) onward. Use a generous
    // buffer (subtract 1 day) so timezone edge cases near midnight don't drop
    // events happening later today.
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    let allEvents;
    try {
      console.log('[Dedup] Fetching upcoming Top Events from database...');
      const fetchStart = Date.now();
      allEvents = await db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          organizer: events.organizer,
          location: events.location,
          startDate: events.startDate,
          price: events.price,
          source: events.source,
        })
        .from(events)
        .where(
          and(
            gte(events.startDate, cutoff),
            lte(events.startDate, windowEnd),
            gte(events.score, TOP_EVENT_SCORE)
          )
        );
      const fetchDuration = ((Date.now() - fetchStart) / 1000).toFixed(1);
      console.log(`[Dedup] Fetched ${allEvents.length} upcoming Top Events in ${fetchDuration}s`);
    } catch (dbErr) {
      const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error(`[Dedup] Database fetch failed: ${errMsg}`);
      throw dbErr;
    }

    const eventsForAI: EventForAIDedup[] = allEvents.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      organizer: e.organizer,
      location: e.location,
      startDate: e.startDate,
      price: e.price,
      source: e.source,
    }));

    // Run AI deduplication across the full Top-30 window (today + next 30 days)
    let result;
    try {
      console.log(`[Dedup] Starting AI deduplication analysis (maxDays=${DEDUP_WINDOW_DAYS})...`);
      result = await runAIDeduplication(eventsForAI, {
        maxDays: DEDUP_WINDOW_DAYS,
        delayBetweenDays: 300,
        verbose: true,
      });
    } catch (aiErr) {
      const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
      console.error(`[Dedup] AI deduplication call failed: ${errMsg}`);
      throw aiErr;
    }

    // Log errors from AI dedup results
    if (result.errors.length > 0) {
      console.warn(`[Dedup] AI dedup reported ${result.errors.length} error(s):`);
      for (const err of result.errors) {
        console.warn(`[Dedup]   - ${err}`);
      }
    }

    // Delete duplicates
    if (result.idsToRemove.length > 0) {
      try {
        console.log(
          `[Dedup] Deleting ${result.idsToRemove.length} duplicate events from database...`
        );
        const deleteStart = Date.now();
        await db.delete(events).where(inArray(events.id, result.idsToRemove));
        const deleteDuration = ((Date.now() - deleteStart) / 1000).toFixed(1);
        console.log(
          `[Dedup] Deleted ${result.idsToRemove.length} duplicate events in ${deleteDuration}s`
        );
      } catch (deleteErr) {
        const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
        console.error(
          `[Dedup] Database delete failed (${result.idsToRemove.length} events): ${errMsg}`
        );
        throw deleteErr;
      }
    } else {
      console.log('[Dedup] No duplicates found.');
    }

    const duration = Date.now() - startTime;
    const durationSec = (duration / 1000).toFixed(1);
    console.log('[Dedup] ────────────────────────────────────────────────');
    console.log(
      `[Dedup] Complete in ${durationSec}s: ${result.daysProcessed} days processed, ${result.idsToRemove.length} removed, ${result.totalTokensUsed} tokens used`
    );
    console.log('[Dedup] ════════════════════════════════════════════════');

    // Invalidate cache so home page reflects deduplicated events
    console.log('[Dedup] Invalidating events cache...');
    invalidateEventsCache();
    console.log('[Dedup] Cache invalidated');

    const jobResult = {
      daysProcessed: result.daysProcessed,
      duplicatesRemoved: result.idsToRemove.length,
      tokensUsed: result.totalTokensUsed,
      errors: result.errors,
    };

    try {
      await completeCronJob(runId, jobResult);
      console.log('[Dedup] Cron job tracker completed');
    } catch (trackerErr) {
      console.error(
        '[Dedup] Failed to complete cron job tracker:',
        trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
      );
    }

    return NextResponse.json({
      success: true,
      duration,
      ...jobResult,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const durationSec = (duration / 1000).toFixed(1);
    console.error('[Dedup] ════════════════════════════════════════════════');
    console.error(`[Dedup] Job failed after ${durationSec}s:`, error);
    console.error('[Dedup] ════════════════════════════════════════════════');

    try {
      await failCronJob(runId, error);
      console.log('[Dedup] Cron job tracker marked as failed');
    } catch (trackerErr) {
      console.error(
        '[Dedup] Failed to update cron job tracker:',
        trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
      );
    }

    return NextResponse.json({ success: false, error: String(error), duration }, { status: 500 });
  }
}
