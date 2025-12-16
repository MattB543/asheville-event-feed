import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq, or, like, sql, isNull, and, isNotNull } from "drizzle-orm";
import { generateEventTags } from "@/lib/ai/tagging";
import { generateAndUploadEventImage } from "@/lib/ai/imageGeneration";
import { generateEventSummary } from "@/lib/ai/summary";
import { generateEmbedding, createEmbeddingText } from "@/lib/ai/embedding";
import { env, isAIEnabled } from "@/lib/config/env";
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

// AI-only cron job
//
// This route handles ONLY AI tagging and image generation.
// Scraping and upserts are handled by /api/cron/scrape
//
// Schedule: Every 6 hours at :30 (cron: "30 0/6 * * *")
// Runs 30 minutes after the scrape job to process new events
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!isAIEnabled()) {
    return NextResponse.json({
      success: false,
      error: "AI features not enabled (GEMINI_API_KEY not set)",
    }, { status: 400 });
  }

  const jobStartTime = Date.now();

  // Stats tracking
  const stats = {
    tagging: { duration: 0, success: 0, failed: 0, total: 0 },
    summaries: { duration: 0, success: 0, failed: 0, total: 0 },
    embeddings: { duration: 0, success: 0, failed: 0, total: 0 },
    images: { duration: 0, success: 0, failed: 0, total: 0 },
  };

  try {
    console.log("[AI] ════════════════════════════════════════════════");
    console.log("[AI] Starting AI processing job...");

    // 1. Find events that need tags (empty tags array)
    console.log("[AI] Finding events needing tags...");
    const eventsNeedingTags = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        location: events.location,
        organizer: events.organizer,
        startDate: events.startDate,
      })
      .from(events)
      .where(
        sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`
      )
      .limit(100); // Process max 100 per run to stay within timeout

    stats.tagging.total = eventsNeedingTags.length;
    console.log(`[AI] Found ${eventsNeedingTags.length} events needing tags`);

    // 2. Generate tags in batches
    if (eventsNeedingTags.length > 0) {
      const tagStartTime = Date.now();
      for (const batch of chunk(eventsNeedingTags, 5)) {
        await Promise.all(
          batch.map(async (event) => {
            try {
              const tags = await generateEventTags({
                title: event.title,
                description: event.description,
                location: event.location,
                organizer: event.organizer,
                startDate: event.startDate,
              });

              // Update event with generated tags
              await db
                .update(events)
                .set({ tags })
                .where(eq(events.id, event.id));

              stats.tagging.success++;
              console.log(`[AI] Tagged "${event.title}" with ${tags.length} tags`);
            } catch (err) {
              stats.tagging.failed++;
              console.error(
                `[AI] Failed to tag "${event.title}":`,
                err instanceof Error ? err.message : err
              );
            }
          })
        );
        // Small delay between batches
        await new Promise((r) => setTimeout(r, 1000));
      }
      stats.tagging.duration = Date.now() - tagStartTime;
      console.log(
        `[AI] Tagging complete in ${formatDuration(stats.tagging.duration)}: ${stats.tagging.success}/${stats.tagging.total} succeeded`
      );
    }

    // 3. Generate AI summaries for events that need them (next 3 months only)
    const now = new Date();
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    if (isAzureAIEnabled()) {
      console.log("[AI] Finding events needing summaries (next 3 months)...");
      const eventsNeedingSummaries = await db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          location: events.location,
          organizer: events.organizer,
          tags: events.tags,
        })
        .from(events)
        .where(
          and(
            isNull(events.aiSummary),
            sql`${events.startDate} >= ${now}`,
            sql`${events.startDate} <= ${threeMonthsFromNow}`
          )
        )
        .limit(100); // Process max 100 per run

      stats.summaries.total = eventsNeedingSummaries.length;
      console.log(`[AI] Found ${eventsNeedingSummaries.length} events needing summaries`);

      if (eventsNeedingSummaries.length > 0) {
        const summaryStartTime = Date.now();
        for (const batch of chunk(eventsNeedingSummaries, 5)) {
          await Promise.all(
            batch.map(async (event) => {
              try {
                const summary = await generateEventSummary({
                  title: event.title,
                  description: event.description,
                  location: event.location,
                  organizer: event.organizer,
                  tags: event.tags,
                });

                if (summary) {
                  await db
                    .update(events)
                    .set({ aiSummary: summary })
                    .where(eq(events.id, event.id));

                  stats.summaries.success++;
                  console.log(`[AI] Generated summary for "${event.title.slice(0, 40)}..."`);
                } else {
                  stats.summaries.failed++;
                }
              } catch (err) {
                stats.summaries.failed++;
                console.error(
                  `[AI] Failed to generate summary for "${event.title}":`,
                  err instanceof Error ? err.message : err
                );
              }
            })
          );
          // Delay between batches
          await new Promise((r) => setTimeout(r, 1000));
        }
        stats.summaries.duration = Date.now() - summaryStartTime;
        console.log(
          `[AI] Summary generation complete in ${formatDuration(stats.summaries.duration)}: ${stats.summaries.success}/${stats.summaries.total} succeeded`
        );
      }
    } else {
      console.log("[AI] Azure AI not configured, skipping summary generation");
    }

    // 4. Generate embeddings for events that have summaries but no embedding (next 3 months only)
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
          sql`${events.startDate} >= ${now}`,
          sql`${events.startDate} <= ${threeMonthsFromNow}`
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

    // 5. Find events that need images and set default fallback
    // NOTE: AI image generation is disabled - using static fallback instead
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

    /* AI IMAGE GENERATION DISABLED - uncomment to re-enable
    if (eventsNeedingImages.length > 0) {
      const imageStartTime = Date.now();
      for (const batch of chunk(eventsNeedingImages, 3)) {
        await Promise.all(
          batch.map(async (event) => {
            try {
              const imageUrl = await generateAndUploadEventImage(
                {
                  title: event.title,
                  description: event.description,
                  location: event.location,
                  tags: event.tags || [],
                },
                event.id
              );

              if (imageUrl) {
                await db
                  .update(events)
                  .set({ imageUrl })
                  .where(eq(events.id, event.id));

                stats.images.success++;
                console.log(`[AI] Generated and uploaded image for "${event.title}"`);
              } else {
                stats.images.failed++;
              }
            } catch (err) {
              stats.images.failed++;
              console.error(`[AI] Failed to generate image for "${event.title}":`, err);
            }
          })
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
      stats.images.duration = Date.now() - imageStartTime;
      console.log(
        `[AI] Image generation complete in ${formatDuration(stats.images.duration)}: ${stats.images.success}/${stats.images.total} succeeded`
      );
    }
    */

    // Final summary
    const totalDuration = Date.now() - jobStartTime;
    console.log("[AI] ────────────────────────────────────────────────");
    console.log(`[AI] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log("[AI] ────────────────────────────────────────────────");
    console.log(`[AI] Tagging: ${stats.tagging.success}/${stats.tagging.total} in ${formatDuration(stats.tagging.duration)}`);
    console.log(`[AI] Summaries: ${stats.summaries.success}/${stats.summaries.total} in ${formatDuration(stats.summaries.duration)}`);
    console.log(`[AI] Embeddings: ${stats.embeddings.success}/${stats.embeddings.total} in ${formatDuration(stats.embeddings.duration)}`);
    console.log(`[AI] Images: ${stats.images.success}/${stats.images.total} in ${formatDuration(stats.images.duration)}`);
    console.log("[AI] ════════════════════════════════════════════════");

    // Invalidate cache so home page shows updated events
    invalidateEventsCache();

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats: {
        tagging: {
          total: stats.tagging.total,
          success: stats.tagging.success,
          failed: stats.tagging.failed,
        },
        summaries: {
          total: stats.summaries.total,
          success: stats.summaries.success,
          failed: stats.summaries.failed,
        },
        embeddings: {
          total: stats.embeddings.total,
          success: stats.embeddings.success,
          failed: stats.embeddings.failed,
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
