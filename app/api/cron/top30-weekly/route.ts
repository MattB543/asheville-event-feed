import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events, newsletterSettings } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
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
import { encodeUnsubscribeToken } from '@/app/api/top30/unsubscribe/route';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';

export const maxDuration = 300; // 5 minutes

// Helper to format duration in human-readable form
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

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
  const runId = await startCronJob('top30-weekly');

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
      .where(sql`${events.startDate} >= ${now}`);
    const futureEventIdSet = new Set(futureEventIds.map((e) => e.id));

    // Get user emails from Supabase
    const supabase = createServiceClient();
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
      perPage: 1000,
    });

    if (authError) {
      console.error('[Top30Weekly] Failed to fetch auth users:', authError);
      await failCronJob(runId, authError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch user emails' },
        { status: 500 }
      );
    }

    const userEmailMap = new Map<string, { email: string; name?: string }>();
    authUsers.users.forEach((user) => {
      if (user.email) {
        const metadata = user.user_metadata as Record<string, unknown> | undefined;
        const name =
          typeof metadata?.full_name === 'string'
            ? metadata.full_name
            : typeof metadata?.name === 'string'
              ? metadata.name
              : undefined;
        userEmailMap.set(user.id, { email: user.email, name });
      }
    });

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
    for (const subscriber of weeklySubscribers) {
      const userInfo = userEmailMap.get(subscriber.userId);
      if (!userInfo) {
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

          // Fetch current notified IDs for this user to append (not replace)
          const currentSettings = await db
            .select({ top30LastEventIds: newsletterSettings.top30LastEventIds })
            .from(newsletterSettings)
            .where(eq(newsletterSettings.userId, subscriber.userId))
            .limit(1);

          const existingIds = currentSettings[0]?.top30LastEventIds || [];
          const currentIds = currentTop30.map((e) => e.id);
          // Filter existing IDs to only keep future events (cleanup past events)
          // Then append new IDs (deduplicated) to prevent duplicates if user switches to live
          const existingValidIds = existingIds.filter((id) => futureEventIdSet.has(id));
          const existingIdSet = new Set(existingValidIds);
          const updatedNotifiedIds = [
            ...existingValidIds,
            ...currentIds.filter((id) => !existingIdSet.has(id)),
          ];

          await db
            .update(newsletterSettings)
            .set({
              top30LastNotifiedAt: new Date(),
              top30LastEventIds: updatedNotifiedIds,
              updatedAt: new Date(),
            })
            .where(eq(newsletterSettings.userId, subscriber.userId));
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
