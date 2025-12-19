import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq, or, like, sql, isNull, and, isNotNull } from "drizzle-orm";
import { generateTagsAndSummary } from "@/lib/ai/tagAndSummarize";
import { generateEmbedding, createEmbeddingText } from "@/lib/ai/embedding";
import { generateEventScore, getRecurringEventScore } from "@/lib/ai/scoring";
import { checkWeeklyRecurring } from "@/lib/ai/recurringDetection";
import { findSimilarEvents } from "@/lib/db/similaritySearch";
import { env } from "@/lib/config/env";
import { isAzureAIEnabled } from "@/lib/ai/azure-client";
import { verifyAuthToken } from "@/lib/utils/auth";
import { invalidateEventsCache } from "@/lib/cache/invalidation";

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
  const authHeader = request.headers.get("authorization");
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!isAzureAIEnabled()) {
    return NextResponse.json({
      success: false,
      error: "Azure AI not enabled (AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required)",
    }, { status: 400 });
  }

  const jobStartTime = Date.now();

  // Stats tracking
  const stats = {
    combined: { duration: 0, success: 0, failed: 0, total: 0 },
    embeddings: { duration: 0, success: 0, failed: 0, total: 0 },
    scoring: { duration: 0, success: 0, failed: 0, total: 0, skippedRecurring: 0 },
    images: { duration: 0, success: 0, failed: 0, total: 0 },
  };

  try {
    console.log("[AI] ════════════════════════════════════════════════");
    console.log("[AI] Starting AI processing job...");

    const now = new Date();
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    // ═══════════════════════════════════════════════════════════════
    // 1. COMBINED PASS: Tags + Summary in one Azure call
    // ═══════════════════════════════════════════════════════════════
    console.log("[AI] Finding events needing tags or summaries (next 3 months)...");
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
      for (const batch of chunk(eventsNeedingProcessing, 5)) {
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
                await db
                  .update(events)
                  .set(updateData)
                  .where(eq(events.id, event.id));

                stats.combined.success++;
                console.log(`[AI] Processed "${event.title.slice(0, 40)}..." - ${result.tags.length} tags, summary: ${result.summary ? 'yes' : 'no'}`);
              } else {
                stats.combined.failed++;
                console.warn(`[AI] No results for "${event.title.slice(0, 40)}..."`);
              }
            } catch (err) {
              stats.combined.failed++;
              console.error(
                `[AI] Failed to process "${event.title}":`,
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
        `[AI] Combined pass complete in ${formatDuration(stats.combined.duration)}: ${stats.combined.success}/${stats.combined.total} succeeded`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. EMBEDDINGS PASS: Generate Gemini embeddings
    // ═══════════════════════════════════════════════════════════════
    console.log("[AI] Finding events needing embeddings (next 3 months)...");
    const eventsNeedingEmbeddings = await db
      .select({
        id: events.id,
        title: events.title,
        aiSummary: events.aiSummary,
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
              const text = createEmbeddingText(event.title, event.aiSummary!);
              const embedding = await generateEmbedding(text);

              if (embedding) {
                await db
                  .update(events)
                  .set({ embedding })
                  .where(eq(events.id, event.id));

                stats.embeddings.success++;
                console.log(`[AI] Generated embedding for "${event.title.slice(0, 40)}..."`);
              } else {
                stats.embeddings.failed++;
              }
            } catch (err) {
              stats.embeddings.failed++;
              console.error(
                `[AI] Failed to generate embedding for "${event.title}":`,
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
        `[AI] Embedding generation complete in ${formatDuration(stats.embeddings.duration)}: ${stats.embeddings.success}/${stats.embeddings.total} succeeded`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. SCORING PASS: Score events with similar events context
    // ═══════════════════════════════════════════════════════════════
    console.log("[AI] Finding events needing scores (next 3 months, with embeddings)...");
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
      })
      .from(events)
      .where(
        and(
          isNull(events.score),
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
            await db
              .update(events)
              .set({
                score: recurringScore.score,
                scoreRarity: recurringScore.rarity,
                scoreUnique: recurringScore.unique,
                scoreMagnitude: recurringScore.magnitude,
                scoreReason: recurringScore.reason,
              })
              .where(eq(events.id, event.id));

            stats.scoring.skippedRecurring++;
            console.log(`[AI] Auto-scored daily recurring: "${event.title.slice(0, 40)}..." = 5/30`);
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
            await db
              .update(events)
              .set({
                score: recurringScore.score,
                scoreRarity: recurringScore.rarity,
                scoreUnique: recurringScore.unique,
                scoreMagnitude: recurringScore.magnitude,
                scoreReason: recurringScore.reason,
              })
              .where(eq(events.id, event.id));

            stats.scoring.skippedRecurring++;
            console.log(`[AI] Auto-scored weekly recurring (${recurringCheck.matchCount} matches): "${event.title.slice(0, 40)}..." = 5/30`);
            continue;
          }

          // Get similar events for context
          const similarEvents = await findSimilarEvents(event.id, {
            limit: 20,
            minSimilarity: 0.4,
            futureOnly: true,
            orderBy: 'similarity'
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
            similarEvents.map(e => ({
              title: e.title,
              location: e.location,
              organizer: e.organizer,
              startDate: e.startDate,
              similarity: e.similarity,
            }))
          );

          if (scoreResult) {
            await db
              .update(events)
              .set({
                score: scoreResult.score,
                scoreRarity: scoreResult.rarity,
                scoreUnique: scoreResult.unique,
                scoreMagnitude: scoreResult.magnitude,
                scoreReason: scoreResult.reason,
              })
              .where(eq(events.id, event.id));

            stats.scoring.success++;
            console.log(`[AI] Scored "${event.title.slice(0, 30)}...": ${scoreResult.score}/30 (R:${scoreResult.rarity} U:${scoreResult.unique} M:${scoreResult.magnitude})`);
          } else {
            stats.scoring.failed++;
          }

          // Delay between scoring calls (more expensive)
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          stats.scoring.failed++;
          console.error(
            `[AI] Failed to score "${event.title}":`,
            err instanceof Error ? err.message : err
          );
        }
      }

      stats.scoring.duration = Date.now() - scoringStartTime;
      console.log(
        `[AI] Scoring complete in ${formatDuration(stats.scoring.duration)}: ${stats.scoring.success}/${stats.scoring.total} succeeded, ${stats.scoring.skippedRecurring} recurring skipped`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. IMAGES PASS: Set default fallback images
    // ═══════════════════════════════════════════════════════════════
    console.log("[AI] Finding events needing images...");
    const eventsNeedingImages = await db
      .select({
        id: events.id,
        title: events.title,
      })
      .from(events)
      .where(
        or(
          isNull(events.imageUrl),
          eq(events.imageUrl, ""),
          like(events.imageUrl, "%/images/fallbacks/%"),
          like(events.imageUrl, "%group-cover%"),
          like(events.imageUrl, "%default_photo%")
        )
      )
      .limit(500); // Process more since we're just setting a static URL

    stats.images.total = eventsNeedingImages.length;
    console.log(`[AI] Found ${eventsNeedingImages.length} events needing images`);

    // Set default fallback image for all events without images
    if (eventsNeedingImages.length > 0) {
      const imageStartTime = Date.now();
      const DEFAULT_IMAGE = "/asheville-default.jpg";

      // Batch update all events without images
      const ids = eventsNeedingImages.map(e => e.id);
      await db
        .update(events)
        .set({ imageUrl: DEFAULT_IMAGE })
        .where(sql`${events.id} = ANY(${ids})`);

      stats.images.success = eventsNeedingImages.length;
      stats.images.duration = Date.now() - imageStartTime;
      console.log(
        `[AI] Set default image for ${stats.images.success} events in ${formatDuration(stats.images.duration)}`
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // Final Summary
    // ═══════════════════════════════════════════════════════════════
    const totalDuration = Date.now() - jobStartTime;
    console.log("[AI] ────────────────────────────────────────────────");
    console.log(`[AI] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log("[AI] ────────────────────────────────────────────────");
    console.log(`[AI] Combined (tags+summary): ${stats.combined.success}/${stats.combined.total} in ${formatDuration(stats.combined.duration)}`);
    console.log(`[AI] Embeddings: ${stats.embeddings.success}/${stats.embeddings.total} in ${formatDuration(stats.embeddings.duration)}`);
    console.log(`[AI] Scoring: ${stats.scoring.success}/${stats.scoring.total} (${stats.scoring.skippedRecurring} recurring) in ${formatDuration(stats.scoring.duration)}`);
    console.log(`[AI] Images: ${stats.images.success}/${stats.images.total} in ${formatDuration(stats.images.duration)}`);
    console.log("[AI] ════════════════════════════════════════════════");

    // Invalidate cache so home page shows updated events
    invalidateEventsCache();

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats: {
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
        images: {
          total: stats.images.total,
          success: stats.images.success,
          failed: stats.images.failed,
        },
      },
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error("[AI] ════════════════════════════════════════════════");
    console.error(`[AI] JOB FAILED after ${formatDuration(totalDuration)}`);
    console.error("[AI] Error:", error);
    console.error("[AI] ════════════════════════════════════════════════");
    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
