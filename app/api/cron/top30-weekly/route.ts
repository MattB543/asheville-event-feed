import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events, newsletterSettings } from '@/lib/db/schema';
import { eq, gte } from 'drizzle-orm';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { sendEmail } from '@/lib/notifications/postmark';
import { isPostmarkEnabled } from '@/lib/config/env';
import { createServiceClient } from '@/lib/supabase/service';
import { queryTop30Events } from '@/lib/db/queries/events';
import {
  generateTop30WeeklyEmailHtml,
  generateTop30WeeklyEmailText,
  type Top30Event,
} from '@/lib/notifications/top30-email-templates';
import {
  buildTop30NotificationTrackingKey,
  extractStoredTop30NotificationTrackingKeys,
  extractStoredTop30TrackedEventIds,
} from '@/lib/notifications/top30-notification-tracking';
import { encodeUnsubscribeToken } from '@/lib/notifications/unsubscribe-token';
import { listAuthUserContacts } from '@/lib/supabase/adminUsers';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { formatDuration } from '@/lib/utils/cron';

export const maxDuration = 300; // 5 minutes

// Weekly Top 30 digest cron job
//
// This route sends a weekly Top 30 summary to all subscribers.
//
// Schedule: Every Friday at 10 AM ET (cron: "0 15 * * 5" = 15:00 UTC on Fridays)
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (!isPostmarkEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Email features not enabled (POSTMARK_API_KEY or POSTMARK_FROM_EMAIL not set)',
      },
      { status: 400 }
    );
  }

  const jobStartTime = Date.now();
  let runId: string | null = null;
  try {
    runId = await startCronJob('top30-weekly');
  } catch (trackerErr) {
    console.error(
      '[Top30Weekly] Failed to start cron job tracker:',
      trackerErr instanceof Error ? trackerErr.message : String(trackerErr)
    );
  }

  const stats = {
    subscribers: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    console.log('[Top30Weekly] Starting weekly Top 30 digest job...');

    // Get users with weekly subscription
    const weeklySubscribers = await db
      .select({
        userId: newsletterSettings.userId,
        top30LastNotifiedAt: newsletterSettings.top30LastNotifiedAt,
      })
      .from(newsletterSettings)
      .where(eq(newsletterSettings.top30Subscription, 'weekly'));

    stats.subscribers = weeklySubscribers.length;

    if (weeklySubscribers.length === 0) {
      console.log('[Top30Weekly] No weekly subscribers found');
      const totalDuration = Date.now() - jobStartTime;
      await completeCronJob(runId, stats);
      return NextResponse.json({
        success: true,
        duration: totalDuration,
        stats,
      });
    }

    console.log(`[Top30Weekly] Found ${weeklySubscribers.length} weekly subscribers`);

    // Get current top 30 events (use overall category for weekly digest)
    const top30Result = await queryTop30Events();
    const currentTop30 = top30Result.overall;

    if (currentTop30.length === 0) {
      console.log('[Top30Weekly] No top 30 events found');
      const totalDuration = Date.now() - jobStartTime;
      await completeCronJob(runId, stats);
      return NextResponse.json({
        success: true,
        duration: totalDuration,
        stats,
      });
    }

    console.log(`[Top30Weekly] Found ${currentTop30.length} top events`);

    // Get all future event IDs for cleanup (events that have passed can be removed from tracking)
    const now = new Date();
    const futureEventIds = await db
      .select({ id: events.id })
      .from(events)
      .where(gte(events.startDate, now));
    const futureEventIdSet = new Set(futureEventIds.map((e) => e.id));

    // Get user emails from Supabase (paged - a single 1000-row page silently
    // drops every subscriber past the first page)
    const supabase = createServiceClient();
    const { contacts: userEmailMap, error: authError } = await listAuthUserContacts(supabase);

    if (authError) {
      console.error('[Top30Weekly] Failed to fetch auth users:', authError);
      await failCronJob(runId, authError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch user emails' },
        { status: 500 }
      );
    }

    const appUrl = env.NEXT_PUBLIC_APP_URL;

    // Transform events to Top30Event format
    const top30Events: Top30Event[] = currentTop30.map((e) => ({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      location: e.location,
      organizer: e.organizer,
      price: e.price,
      imageUrl: e.imageUrl,
      tags: e.tags,
      url: e.url,
      aiSummary: e.aiSummary,
      score: e.score,
    }));

    // Send email to each subscriber
    const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
    for (const subscriber of weeklySubscribers) {
      const userInfo = userEmailMap.get(subscriber.userId);
      if (!userInfo) {
        stats.skipped++;
        continue;
      }

      // Idempotency guard: the digest goes out weekly, so anyone notified in
      // the last 6 days was covered by this week's run — a retry or second
      // invocation the same Friday must not double-send
      if (
        subscriber.top30LastNotifiedAt &&
        Date.now() - subscriber.top30LastNotifiedAt.getTime() < SIX_DAYS_MS
      ) {
        stats.skipped++;
        continue;
      }

      const unsubscribeUrl = `${appUrl}/api/top30/unsubscribe?token=${encodeUnsubscribeToken(subscriber.userId)}`;

      const htmlBody = generateTop30WeeklyEmailHtml({
        recipientName: userInfo.name,
        events: top30Events,
        unsubscribeUrl,
      });

      const textBody = generateTop30WeeklyEmailText({
        recipientName: userInfo.name,
        events: top30Events,
        unsubscribeUrl,
      });

      const subject = "This week's Top 30 events in Asheville";

      try {
        const sent = await sendEmail({
          to: userInfo.email,
          subject,
          htmlBody,
          textBody,
        });

        if (sent) {
          stats.sent++;
          console.log(`[Top30Weekly] Sent weekly digest to ${userInfo.email}`);

          // Fetch current tracking entries for this user to append (not replace).
          const currentSettings = await db
            .select({ top30LastEventIds: newsletterSettings.top30LastEventIds })
            .from(newsletterSettings)
            .where(eq(newsletterSettings.userId, subscriber.userId))
            .limit(1);

          const existingEntries = currentSettings[0]?.top30LastEventIds || [];
          const existingTrackedEventIds = extractStoredTop30TrackedEventIds(existingEntries);
          const existingTrackingKeys = extractStoredTop30NotificationTrackingKeys(existingEntries);
          const currentIds = currentTop30.map((e) => e.id);
          const currentTrackingKeys = currentTop30.map((event) =>
            buildTop30NotificationTrackingKey(event)
          );
          // Filter current-row IDs to future events, but keep durable tracking keys so users do not
          // get re-notified if the same event is later recreated under a different UUID.
          const existingValidIds = existingTrackedEventIds.filter((id) => futureEventIdSet.has(id));
          const updatedTrackingEntries = Array.from(
            new Set([
              ...existingValidIds,
              ...existingTrackingKeys,
              ...currentIds,
              ...currentTrackingKeys,
            ])
          );

          try {
            await db
              .update(newsletterSettings)
              .set({
                top30LastNotifiedAt: new Date(),
                top30LastEventIds: updatedTrackingEntries,
                updatedAt: new Date(),
              })
              .where(eq(newsletterSettings.userId, subscriber.userId));
          } catch (trackingError) {
            console.error(
              `[Top30Weekly] Sent weekly digest to ${userInfo.email}, but failed to persist tracking. Retrying once...`,
              trackingError
            );
            await new Promise((r) => setTimeout(r, 250));
            await db
              .update(newsletterSettings)
              .set({
                top30LastNotifiedAt: new Date(),
                top30LastEventIds: updatedTrackingEntries,
                updatedAt: new Date(),
              })
              .where(eq(newsletterSettings.userId, subscriber.userId));
          }
        } else {
          stats.failed++;
        }
      } catch (emailError) {
        console.error(`[Top30Weekly] Failed to send to ${userInfo.email}:`, emailError);
        stats.failed++;
      }

      // Small delay between emails
      await new Promise((r) => setTimeout(r, 100));
    }

    const totalDuration = Date.now() - jobStartTime;
    console.log('[Top30Weekly] ────────────────────────────────────────────────');
    console.log(`[Top30Weekly] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log(
      `[Top30Weekly] Sent: ${stats.sent}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`
    );
    console.log('[Top30Weekly] ════════════════════════════════════════════════');

    await completeCronJob(runId, stats);

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats,
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error('[Top30Weekly] ════════════════════════════════════════════════');
    console.error(`[Top30Weekly] JOB FAILED after ${formatDuration(totalDuration)}`);
    console.error('[Top30Weekly] Error:', error);
    console.error('[Top30Weekly] ════════════════════════════════════════════════');

    await failCronJob(runId, error);

    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
