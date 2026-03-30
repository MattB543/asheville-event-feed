import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events, newsletterSettings } from '@/lib/db/schema';
import { eq, or, like, sql, isNull, and, isNotNull, inArray } from 'drizzle-orm';
import { generateTagsAndSummary } from '@/lib/ai/tagAndSummarize';
import { generateEmbedding, createEmbeddingText } from '@/lib/ai/embedding';
import {
  buildMissingScoreUpdate,
  generateEventScore,
  getFallbackEventScore,
  getRecurringEventScore,
} from '@/lib/ai/scoring';
import { checkWeeklyRecurring } from '@/lib/ai/recurringDetection';
import { findSimilarEvents } from '@/lib/db/similaritySearch';
import { env } from '@/lib/config/env';
import { isAzureAIEnabled } from '@/lib/ai/provider-clients';
import { verifyAuthToken } from '@/lib/utils/auth';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { queryTop30Events } from '@/lib/db/queries/events';
import { sendEmail } from '@/lib/notifications/postmark';
import { isPostmarkEnabled } from '@/lib/config/env';
import { createServiceClient } from '@/lib/supabase/service';
import {
  generateTop30LiveEmailHtml,
  generateTop30LiveEmailText,
  type Top30Event,
} from '@/lib/notifications/top30-email-templates';
import { areEquivalentTop30Events } from '@/lib/notifications/top30-notification-equivalence';
import { encodeUnsubscribeToken } from '@/app/api/top30/unsubscribe/route';

export const maxDuration = 800; // 13+ minutes (requires Fluid Compute)

// Helper to format duration in human-readable form
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Helper to chunk arrays
const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// AI processing cron job
//
// This route handles AI tagging, summary generation, embeddings, scoring, and images.
// Scraping and upserts are handled by /api/cron/scrape
//
// Schedule: Every 6 hours at :10 (runs 10 minutes after the scrape job)
//
// Processing Flow:
// 1. Combined Pass: Generate tags + summary in one Azure call
// 2. Embeddings Pass: Generate Gemini embeddings for events with summaries
// 3. Scoring Pass: Score events using similar events context (daily/weekly skip AI)
// 4. Images Pass: Set default fallback images
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (!isAzureAIEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Azure AI not enabled (AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required)',
      },
      { status: 400 }
    );
  }

  const jobStartTime = Date.now();
  const runId = await startCronJob('ai');

  // Stats tracking
  const stats = {
    combined: { duration: 0, success: 0, failed: 0, total: 0 },
    embeddings: { duration: 0, success: 0, failed: 0, total: 0 },
    scoring: { duration: 0, success: 0, failed: 0, total: 0, skippedRecurring: 0 },
    images: { duration: 0, success: 0, failed: 0, total: 0 },
    top30Notifications: { duration: 0, sent: 0, skipped: 0, newEvents: 0 },
  };

  try {
    console.log('[AI] ════════════════════════════════════════════════');
    console.log('[AI] Starting AI processing job...');

    const now = new Date();
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    // ═══════════════════════════════════════════════════════════════
    // 1. COMBINED PASS: Tags + Summary in one Azure call
    // ═══════════════════════════════════════════════════════════════
    console.log('[AI] Finding events needing tags or summaries (next 3 months)...');
    const eventsNeedingProcessing = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        location: events.location,
        organizer: events.organizer,
        startDate: events.startDate,
        tags: events.tags,
        aiSummary: events.aiSummary,
      })
      .from(events)
      .where(
        and(
          or(
            sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`,
            isNull(events.aiSummary)
          ),
          sql`${events.startDate} >= ${now.toISOString()}`,
          sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
        )
      )
      .limit(100); // Process max 100 per run

    stats.combined.total = eventsNeedingProcessing.length;
    console.log(`[AI] Found ${eventsNeedingProcessing.length} events needing tags/summaries`);

    if (eventsNeedingProcessing.length > 0) {
      const combinedStartTime = Date.now();
      const batches = chunk(eventsNeedingProcessing, 5);
      let batchIndex = 0;
      for (const batch of batches) {
        batchIndex++;
        console.log(
          `[AI] Combined batch ${batchIndex}/${batches.length} (${batch.length} events)...`
        );
        await Promise.all(
          batch.map(async (event) => {
            try {
              // Check if we already have tags or summary
              const needsTags = !event.tags || event.tags.length === 0;
              const needsSummary = !event.aiSummary;

              // If we need either, generate both (combined call is more efficient)
              const result = await generateTagsAndSummary({
                title: event.title,
                description: event.description,
                location: event.location,
                organizer: event.organizer,
                startDate: event.startDate,
              });

              // Update with results (only update fields that were empty)
              const updateData: { tags?: string[]; aiSummary?: string } = {};
              if (needsTags && result.tags.length > 0) {
                updateData.tags = result.tags;
              }
              if (needsSummary && result.summary) {
                updateData.aiSummary = result.summary;
              }

              if (Object.keys(updateData).length > 0) {
                await db.update(events).set(updateData).where(eq(events.id, event.id));

                stats.combined.success++;
              } else {
                stats.combined.failed++;
                const reasons: string[] = [];
                if (needsTags && result.tags.length === 0) reasons.push('tags empty');
                if (needsSummary && !result.summary) reasons.push('summary null');
                if (!needsTags && !needsSummary) reasons.push('neither needed');
                console.warn(
                  `[AI] Skipped update for "${event.title.slice(0, 40)}..." - ${reasons.join(', ')}`
                );
              }
            } catch (err) {
              stats.combined.failed++;
              console.error(
                `[AI] Failed to process "${event.title.slice(0, 40)}...":`,
                err instanceof Error ? err.message : err
              );
            }
          })
        );
        // Delay between batches
        await new Promise((r) => setTimeout(r, 1000));
      }
      stats.combined.duration = Date.now() - combinedStartTime;
      console.log(
        `[AI] Combined pass complete in ${formatDuration(stats.combined.duration)}: ${stats.combined.success}/${stats.combined.total} succeeded, ${stats.combined.failed} failed`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. EMBEDDINGS PASS: Generate Gemini embeddings
    // ═══════════════════════════════════════════════════════════════
    console.log('[AI] Finding events needing embeddings (next 3 months)...');
    const eventsNeedingEmbeddings = await db
      .select({
        id: events.id,
        title: events.title,
        aiSummary: events.aiSummary,
        tags: events.tags,
        organizer: events.organizer,
      })
      .from(events)
      .where(
        and(
          isNotNull(events.aiSummary),
          isNull(events.embedding),
          sql`${events.startDate} >= ${now.toISOString()}`,
          sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
        )
      )
      .limit(100); // Process max 100 per run

    stats.embeddings.total = eventsNeedingEmbeddings.length;
    console.log(`[AI] Found ${eventsNeedingEmbeddings.length} events needing embeddings`);

    if (eventsNeedingEmbeddings.length > 0) {
      const embeddingStartTime = Date.now();
      for (const batch of chunk(eventsNeedingEmbeddings, 10)) {
        await Promise.all(
          batch.map(async (event) => {
            try {
              const text = createEmbeddingText(
                event.title,
                event.aiSummary!,
                event.tags,
                event.organizer
              );
              const embedding = await generateEmbedding(text);

              if (embedding) {
                await db.update(events).set({ embedding }).where(eq(events.id, event.id));
                stats.embeddings.success++;
              } else {
                stats.embeddings.failed++;
                // generateEmbedding logs the specific reason (AI disabled, model unavailable, API error)
                console.warn(`[AI] Embedding returned null for "${event.title.slice(0, 40)}..."`);
              }
            } catch (err) {
              stats.embeddings.failed++;
              console.error(
                `[AI] Failed to generate embedding for "${event.title.slice(0, 40)}...":`,
                err instanceof Error ? err.message : err
              );
            }
          })
        );
        // Delay between batches
        await new Promise((r) => setTimeout(r, 500));
      }
      stats.embeddings.duration = Date.now() - embeddingStartTime;
      console.log(
        `[AI] Embedding pass complete in ${formatDuration(stats.embeddings.duration)}: ${stats.embeddings.success}/${stats.embeddings.total} succeeded, ${stats.embeddings.failed} failed`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. SCORING PASS: Score events with similar events context
    // ═══════════════════════════════════════════════════════════════
    console.log('[AI] Finding events needing scores (next 3 months, with embeddings)...');
    const eventsNeedingScores = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        location: events.location,
        organizer: events.organizer,
        tags: events.tags,
        aiSummary: events.aiSummary,
        startDate: events.startDate,
        price: events.price,
        recurringType: events.recurringType,
        score: events.score,
        scoreRarity: events.scoreRarity,
        scoreUnique: events.scoreUnique,
        scoreMagnitude: events.scoreMagnitude,
        scoreReason: events.scoreReason,
        scoreAshevilleWeird: events.scoreAshevilleWeird,
        scoreSocial: events.scoreSocial,
      })
      .from(events)
      .where(
        and(
          or(
            isNull(events.score),
            isNull(events.scoreRarity),
            isNull(events.scoreUnique),
            isNull(events.scoreMagnitude),
            isNull(events.scoreReason),
            isNull(events.scoreAshevilleWeird),
            isNull(events.scoreSocial)
          ),
          isNotNull(events.embedding),
          isNotNull(events.aiSummary),
          sql`${events.startDate} >= ${now.toISOString()}`,
          sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
        )
      )
      .limit(50); // Smaller batch - scoring uses more context

    stats.scoring.total = eventsNeedingScores.length;
    console.log(`[AI] Found ${eventsNeedingScores.length} events needing scores`);

    if (eventsNeedingScores.length > 0) {
      const scoringStartTime = Date.now();

      for (const event of eventsNeedingScores) {
        try {
          // Check if daily recurring (existing field)
          if (event.recurringType === 'daily') {
            const recurringScore = getRecurringEventScore('daily');
            const updateData = buildMissingScoreUpdate(event, recurringScore);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }

            stats.scoring.skippedRecurring++;
            console.log(
              `[AI] Auto-scored daily recurring: "${event.title.slice(0, 40)}..." = 5/30`
            );
            continue;
          }

          // Check if weekly recurring
          const recurringCheck = await checkWeeklyRecurring(
            event.title,
            event.location,
            event.organizer,
            event.id,
            event.startDate
          );

          if (recurringCheck.isWeeklyRecurring) {
            const recurringScore = getRecurringEventScore('weekly');
            const updateData = buildMissingScoreUpdate(event, recurringScore);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }

            stats.scoring.skippedRecurring++;
            console.log(
              `[AI] Auto-scored weekly recurring (${recurringCheck.matchCount} matches): "${event.title.slice(0, 40)}..." = 5/30`
            );
            continue;
          }

          // Get similar events for context
          const similarEvents = await findSimilarEvents(event.id, {
            limit: 20,
            minSimilarity: 0.4,
            futureOnly: true,
            orderBy: 'similarity',
          });

          // Generate AI score
          const scoreResult = await generateEventScore(
            {
              id: event.id,
              title: event.title,
              description: event.description,
              location: event.location,
              organizer: event.organizer,
              tags: event.tags,
              aiSummary: event.aiSummary,
              startDate: event.startDate,
              price: event.price,
            },
            similarEvents.map((e) => ({
              title: e.title,
              location: e.location,
              organizer: e.organizer,
              startDate: e.startDate,
              similarity: e.similarity,
            }))
          );

          if (scoreResult) {
            const updateData = buildMissingScoreUpdate(event, scoreResult);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }

            stats.scoring.success++;
            console.log(
              `[AI] Scored "${event.title.slice(0, 30)}...": ${scoreResult.score}/30 (R:${scoreResult.rarity} U:${scoreResult.unique} M:${scoreResult.magnitude} AW:${scoreResult.ashevilleWeird} S:${scoreResult.social}) [${similarEvents.length} similar]`
            );
          } else {
            stats.scoring.failed++;
            const fallbackScore = getFallbackEventScore('Fallback score: AI scoring failed');
            const updateData = buildMissingScoreUpdate(event, fallbackScore);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }
            console.warn(
              `[AI] Fallback score applied for "${event.title.slice(0, 40)}..." - AI returned null [${similarEvents.length} similar]`
            );
          }

          // Delay between scoring calls (more expensive)
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          stats.scoring.failed++;
          const isContentFilter =
            err instanceof Error &&
            (err.message.includes('content_filter') ||
              err.message.includes('content management policy'));
          const fallbackScore = getFallbackEventScore(
            isContentFilter
              ? 'Fallback score: AI scoring blocked by content filter'
              : 'Fallback score: AI scoring failed'
          );
          const updateData = buildMissingScoreUpdate(event, fallbackScore);
          if (Object.keys(updateData).length > 0) {
            await db.update(events).set(updateData).where(eq(events.id, event.id));
          }
          if (isContentFilter) {
            console.warn(
              `[AI] Content filter blocked scoring for "${event.title.slice(0, 40)}..." - fallback applied`
            );
          } else {
            console.error(
              `[AI] Failed to score "${event.title.slice(0, 40)}...":`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }

      stats.scoring.duration = Date.now() - scoringStartTime;
      console.log(
        `[AI] Scoring complete in ${formatDuration(stats.scoring.duration)}: ${stats.scoring.success}/${stats.scoring.total} succeeded, ${stats.scoring.skippedRecurring} recurring skipped`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. TOP 30 LIVE NOTIFICATIONS: Email users when new events enter top 30
    // ═══════════════════════════════════════════════════════════════
    if (isPostmarkEnabled() && stats.scoring.success > 0) {
      console.log('[AI] Checking for top 30 live notification subscribers...');
      const top30NotifStartTime = Date.now();

      try {
        // Get current top 30 events (use overall category for live notifications)
        const top30Result = await queryTop30Events();
        const currentTop30 = top30Result.overall;
        console.log(`[AI] Top 30 query returned ${currentTop30.length} events`);

        // Get all future event IDs for cleanup (events that have passed can be removed from tracking)
        const now = new Date();
        const nowIso = now.toISOString();
        const futureEventIds = await db
          .select({ id: events.id })
          .from(events)
          .where(sql`${events.startDate} >= ${nowIso}`);
        const futureEventIdSet = new Set(futureEventIds.map((e) => e.id));

        // Get users with live subscription
        const liveSubscribers = await db
          .select({
            userId: newsletterSettings.userId,
            top30LastEventIds: newsletterSettings.top30LastEventIds,
          })
          .from(newsletterSettings)
          .where(eq(newsletterSettings.top30Subscription, 'live'));

        if (liveSubscribers.length > 0) {
          console.log(`[AI] Found ${liveSubscribers.length} live top 30 subscribers`);

          const trackedIds = Array.from(
            new Set(
              liveSubscribers.flatMap((subscriber) =>
                (subscriber.top30LastEventIds || []).filter((id) => futureEventIdSet.has(id))
              )
            )
          );

          const trackedEvents =
            trackedIds.length > 0
              ? await db
                  .select({
                    id: events.id,
                    title: events.title,
                    startDate: events.startDate,
                    location: events.location,
                    organizer: events.organizer,
                  })
                  .from(events)
                  .where(inArray(events.id, trackedIds))
              : [];

          const trackedEventById = new Map(trackedEvents.map((event) => [event.id, event]));

          // Get user emails from Supabase
          const supabase = createServiceClient();
          const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
            perPage: 1000,
          });

          if (authError) {
            console.error('[AI] Failed to fetch auth users:', authError);
          } else {
            const usersWithEmail = authUsers.users.filter((u) => u.email).length;
            console.log(
              `[AI] Fetched ${authUsers.users.length} auth users (${usersWithEmail} with emails)`
            );
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

            for (const subscriber of liveSubscribers) {
              const userInfo = userEmailMap.get(subscriber.userId);
              if (!userInfo) {
                stats.top30Notifications.skipped++;
                console.log(
                  `[AI] Skipped subscriber ${subscriber.userId.slice(0, 8)}... - no email found`
                );
                continue;
              }

              // Find new events (in current top 30 but not in user's notified list)
              // We track ALL events ever notified, not just current Top 30 composition,
              // to prevent duplicate notifications when events bounce in/out of Top 30
              const notifiedIds = new Set(subscriber.top30LastEventIds || []);
              const existingValidIds = (subscriber.top30LastEventIds || []).filter((id) =>
                futureEventIdSet.has(id)
              );
              const previouslyNotifiedEvents = existingValidIds
                .map((id) => trackedEventById.get(id))
                .filter((event): event is NonNullable<typeof event> => Boolean(event));

              const newEvents: Top30Event[] = currentTop30
                .filter((event) => {
                  if (notifiedIds.has(event.id)) {
                    return false;
                  }

                  return !previouslyNotifiedEvents.some((previousEvent) =>
                    areEquivalentTop30Events(event, previousEvent)
                  );
                })
                .map((event) => ({
                  id: event.id,
                  title: event.title,
                  startDate: event.startDate,
                  location: event.location,
                  organizer: event.organizer,
                  price: event.price,
                  imageUrl: event.imageUrl,
                  tags: event.tags,
                  url: event.url,
                  aiSummary: event.aiSummary,
                  score: event.score,
                }));

              if (newEvents.length === 0) {
                // No new events for this user - don't update the notified list
                // (preserves history of all events they've been notified about)
                stats.top30Notifications.skipped++;
                console.log(
                  `[AI] Skipped ${userInfo.email} - no new events (${notifiedIds.size} already notified)`
                );
                continue;
              }

              const newEventIds = newEvents.map((event) => event.id);

              if (newEvents.length > stats.top30Notifications.newEvents) {
                stats.top30Notifications.newEvents = newEvents.length;
              }

              const unsubscribeUrl = `${appUrl}/api/top30/unsubscribe?token=${encodeUnsubscribeToken(subscriber.userId)}`;

              const htmlBody = generateTop30LiveEmailHtml({
                recipientName: userInfo.name,
                newEvents,
                unsubscribeUrl,
              });

              const textBody = generateTop30LiveEmailText({
                recipientName: userInfo.name,
                newEvents,
                unsubscribeUrl,
              });

              const subject =
                newEvents.length === 1
                  ? "New event in Asheville's Top 30!"
                  : `${newEvents.length} new events in Asheville's Top 30!`;

              try {
                const sent = await sendEmail({
                  to: userInfo.email,
                  subject,
                  htmlBody,
                  textBody,
                });

                if (sent) {
                  stats.top30Notifications.sent++;
                  console.log(
                    `[AI] Sent top 30 notification to ${userInfo.email}: ${newEvents.length} new events`
                  );

                  // Append new event IDs to the notified list (don't replace)
                  // This ensures events are only notified once, even if they bounce in/out of Top 30
                  // Also clean up IDs for events that have already passed (to prevent unbounded growth)
                  const updatedNotifiedIds = [...existingValidIds, ...newEventIds];
                  await db
                    .update(newsletterSettings)
                    .set({
                      top30LastEventIds: updatedNotifiedIds,
                      top30LastNotifiedAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .where(eq(newsletterSettings.userId, subscriber.userId));
                } else {
                  stats.top30Notifications.skipped++;
                }
              } catch (emailError) {
                console.error(
                  `[AI] Failed to send top 30 notification to ${userInfo.email}:`,
                  emailError
                );
                stats.top30Notifications.skipped++;
              }

              // Small delay between emails
              await new Promise((r) => setTimeout(r, 100));
            }
          }
        } else {
          console.log('[AI] No live top 30 subscribers found');
        }
      } catch (top30Error) {
        console.error('[AI] Error in top 30 notifications:', top30Error);
      }

      stats.top30Notifications.duration = Date.now() - top30NotifStartTime;
      console.log(
        `[AI] Top 30 notifications complete in ${formatDuration(stats.top30Notifications.duration)}: ${stats.top30Notifications.sent} sent, ${stats.top30Notifications.skipped} skipped`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. IMAGES PASS: Set default fallback images
    // ═══════════════════════════════════════════════════════════════
    console.log('[AI] Finding events needing images...');
    const eventsNeedingImages = await db
      .select({
        id: events.id,
        title: events.title,
      })
      .from(events)
      .where(
        or(
          isNull(events.imageUrl),
          eq(events.imageUrl, ''),
          like(events.imageUrl, '%/images/fallbacks/%'),
          like(events.imageUrl, '%group-cover%'),
          like(events.imageUrl, '%default_photo%')
        )
      )
      .limit(500); // Process more since we're just setting a static URL

    stats.images.total = eventsNeedingImages.length;
    console.log(`[AI] Found ${eventsNeedingImages.length} events needing images`);

    // Set default fallback image for all events without images
    if (eventsNeedingImages.length > 0) {
      const imageStartTime = Date.now();
      const DEFAULT_IMAGE = '/asheville-default.jpg';

      try {
        // Batch update all events without images
        const ids = eventsNeedingImages.map((e) => e.id);
        await db.update(events).set({ imageUrl: DEFAULT_IMAGE }).where(inArray(events.id, ids));

        stats.images.success = eventsNeedingImages.length;
        stats.images.duration = Date.now() - imageStartTime;
        console.log(
          `[AI] Set default image for ${stats.images.success} events in ${formatDuration(stats.images.duration)}`
        );
      } catch (imageErr) {
        stats.images.failed = eventsNeedingImages.length;
        stats.images.duration = Date.now() - imageStartTime;
        console.error(
          `[AI] Failed to set default images for ${eventsNeedingImages.length} events:`,
          imageErr instanceof Error ? imageErr.message : imageErr
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Final Summary
    // ═══════════════════════════════════════════════════════════════
    const totalDuration = Date.now() - jobStartTime;
    console.log('[AI] ────────────────────────────────────────────────');
    console.log(`[AI] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log('[AI] ────────────────────────────────────────────────');
    console.log(
      `[AI] Combined (tags+summary): ${stats.combined.success}/${stats.combined.total} in ${formatDuration(stats.combined.duration)}`
    );
    console.log(
      `[AI] Embeddings: ${stats.embeddings.success}/${stats.embeddings.total} in ${formatDuration(stats.embeddings.duration)}`
    );
    console.log(
      `[AI] Scoring: ${stats.scoring.success}/${stats.scoring.total} (${stats.scoring.skippedRecurring} recurring) in ${formatDuration(stats.scoring.duration)}`
    );
    console.log(
      `[AI] Top 30 Notifications: ${stats.top30Notifications.sent} sent, ${stats.top30Notifications.skipped} skipped in ${formatDuration(stats.top30Notifications.duration)}`
    );
    console.log(
      `[AI] Images: ${stats.images.success}/${stats.images.total} in ${formatDuration(stats.images.duration)}`
    );
    console.log('[AI] ════════════════════════════════════════════════');

    // Invalidate cache so home page shows updated events
    try {
      invalidateEventsCache();
      console.log('[AI] Cache invalidation completed');
    } catch (cacheErr) {
      console.error(
        '[AI] Cache invalidation failed:',
        cacheErr instanceof Error ? cacheErr.message : cacheErr
      );
    }

    const result = {
      combined: {
        total: stats.combined.total,
        success: stats.combined.success,
        failed: stats.combined.failed,
      },
      embeddings: {
        total: stats.embeddings.total,
        success: stats.embeddings.success,
        failed: stats.embeddings.failed,
      },
      scoring: {
        total: stats.scoring.total,
        success: stats.scoring.success,
        failed: stats.scoring.failed,
        skippedRecurring: stats.scoring.skippedRecurring,
      },
      top30Notifications: {
        sent: stats.top30Notifications.sent,
        skipped: stats.top30Notifications.skipped,
        newEvents: stats.top30Notifications.newEvents,
      },
      images: {
        total: stats.images.total,
        success: stats.images.success,
        failed: stats.images.failed,
      },
    };

    try {
      await completeCronJob(runId, result);
      console.log(`[AI] Cron job tracker updated (runId=${runId})`);
    } catch (trackerErr) {
      console.error(
        `[AI] Failed to update cron job tracker (runId=${runId}):`,
        trackerErr instanceof Error ? trackerErr.message : trackerErr
      );
    }

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats: result,
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error('[AI] ════════════════════════════════════════════════');
    console.error(`[AI] JOB FAILED after ${formatDuration(totalDuration)}`);
    console.error('[AI] Error:', error);
    console.error('[AI] ════════════════════════════════════════════════');

    await failCronJob(runId, error);

    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
