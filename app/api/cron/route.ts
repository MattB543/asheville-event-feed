import { NextResponse } from "next/server";
import { scrapeAvlToday } from "@/lib/scrapers/avltoday";
import { scrapeEventbrite } from "@/lib/scrapers/eventbrite";
import { scrapeMeetup } from "@/lib/scrapers/meetup";
import { scrapeFacebookEvents } from "@/lib/scrapers/facebook";
import { scrapeHarrahs } from "@/lib/scrapers/harrahs";
import { scrapeOrangePeel } from "@/lib/scrapers/orangepeel";
import { scrapeGreyEagle } from "@/lib/scrapers/greyeagle";
import { scrapeLiveMusicAvl } from "@/lib/scrapers/livemusicavl";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { generateEventTags } from "@/lib/ai/tagging";
import { generateEventImage } from "@/lib/ai/imageGeneration";
import { ScrapedEventWithTags } from "@/lib/scrapers/types";
import { env, isFacebookEnabled } from "@/lib/config/env";
import { findDuplicates, getIdsToRemove } from "@/lib/utils/deduplication";

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

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const jobStartTime = Date.now();

  // Stats tracking
  const stats = {
    scraping: { duration: 0, total: 0 },
    tagging: { duration: 0, success: 0, failed: 0, skipped: 0 },
    images: { duration: 0, success: 0, failed: 0 },
    upsert: { duration: 0, success: 0, failed: 0 },
    dedup: { removed: 0 },
  };

  try {
    console.log("[Cron] ════════════════════════════════════════════════");
    console.log("[Cron] Starting scrape job...");

    // Scrape AVL Today, Eventbrite, Meetup, Harrah's, Orange Peel, Grey Eagle, and Live Music AVL in parallel
    const scrapeStartTime = Date.now();
    const [
      avlEvents,
      ebEvents,
      meetupEvents,
      harrahsEvents,
      orangePeelEvents,
      greyEagleEvents,
      liveMusicAvlEvents,
    ] = await Promise.allSettled([
      scrapeAvlToday(),
      scrapeEventbrite(30), // Scrape 30 pages (~609 events)
      scrapeMeetup(30), // Scrape 30 days of physical events (~236 events)
      scrapeHarrahs(), // Harrah's Cherokee Center (Ticketmaster API + HTML)
      scrapeOrangePeel(), // Orange Peel (Ticketmaster API + Website JSON-LD)
      scrapeGreyEagle(), // Grey Eagle (Website JSON-LD)
      scrapeLiveMusicAvl(), // Live Music Asheville (select venues only)
    ]);
    stats.scraping.duration = Date.now() - scrapeStartTime;
    stats.scraping.total =
      avlEvents.length +
      ebEvents.length +
      meetupEvents.length +
      harrahsEvents.length +
      orangePeelEvents.length +
      greyEagleEvents.length +
      liveMusicAvlEvents.length;

    console.log(
      `[Cron] Scrape complete in ${formatDuration(
        stats.scraping.duration
      )}. AVL: ${avlEvents.length}, EB: ${ebEvents.length}, Meetup: ${
        meetupEvents.length
      }, Harrahs: ${harrahsEvents.length}, OrangePeel: ${
        orangePeelEvents.length
      }, GreyEagle: ${greyEagleEvents.length}, LiveMusicAVL: ${
        liveMusicAvlEvents.length
      } (Total: ${stats.scraping.total})`
    );

    // Facebook scraping (separate due to browser requirements)
    // Note: Facebook scraping uses Playwright/Patchright which is resource-intensive
    // It's done separately to avoid blocking other scrapers if it fails
    let fbEvents: ScrapedEventWithTags[] = [];
    if (isFacebookEnabled()) {
      try {
        console.log("[Cron] Attempting Facebook scrape...");
        const fbRawEvents = await scrapeFacebookEvents();
        // Filter out low-interest events (must have >1 going OR >3 interested)
        // "Going" is a stronger signal than "interested"
        const fbFiltered = fbRawEvents.filter(
          (e) =>
            (e.goingCount !== undefined && e.goingCount > 1) ||
            (e.interestedCount !== undefined && e.interestedCount > 3)
        );
        // Transform to ScrapedEventWithTags format
        fbEvents = fbFiltered.map((e) => ({ ...e, tags: [] }));
        console.log(
          `[Cron] Facebook scrape complete: ${
            fbEvents.length
          } events (filtered ${
            fbRawEvents.length - fbFiltered.length
          } low-interest)`
        );
      } catch (fbError) {
        // Log error but don't fail the entire cron job
        console.error(
          "[Cron] Facebook scrape failed (continuing with other sources):",
          fbError
        );
      }
    }

    // Transform venue events to include tags array
    const harrahsWithTags: ScrapedEventWithTags[] = harrahsEvents.map((e) => ({
      ...e,
      tags: [],
    }));
    const orangePeelWithTags: ScrapedEventWithTags[] = orangePeelEvents.map(
      (e) => ({ ...e, tags: [] })
    );
    const greyEagleWithTags: ScrapedEventWithTags[] = greyEagleEvents.map(
      (e) => ({ ...e, tags: [] })
    );
    const liveMusicAvlWithTags: ScrapedEventWithTags[] = liveMusicAvlEvents.map(
      (e) => ({ ...e, tags: [] })
    );

    const allEvents: ScrapedEventWithTags[] = [
      ...avlEvents,
      ...ebEvents,
      ...meetupEvents,
      ...fbEvents,
      ...harrahsWithTags,
      ...orangePeelWithTags,
      ...greyEagleWithTags,
      ...liveMusicAvlWithTags,
    ];

    // Optimization: Only generate tags for NEW events
    // 1. Get URLs of all scraped events
    const scrapedUrls = allEvents.map((e) => e.url);

    // 2. Find which URLs already exist in DB
    let existingUrls = new Set<string>();
    if (scrapedUrls.length > 0) {
      const existingEvents = await db
        .select({ url: events.url })
        .from(events)
        .where(inArray(events.url, scrapedUrls));
      existingUrls = new Set(existingEvents.map((e) => e.url));
    }

    // 3. Identify new events
    const newEvents = allEvents.filter((e) => !existingUrls.has(e.url));
    stats.tagging.skipped = allEvents.length - newEvents.length;
    console.log(
      `[Cron] Found ${newEvents.length} new events to tag (${stats.tagging.skipped} existing, skipped).`
    );

    // 4. Generate tags for new events (in parallel with concurrency limit)
    // Helper to process in chunks to avoid rate limits
    const chunk = <T>(arr: T[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
      );

    const tagStartTime = Date.now();
    for (const batch of chunk(newEvents, 5)) {
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
            event.tags = tags;
            stats.tagging.success++;
          } catch (err) {
            stats.tagging.failed++;
            console.error(
              `[Cron] Failed to tag "${event.title}":`,
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
      `[Cron] Tagging complete in ${formatDuration(stats.tagging.duration)}: ${
        stats.tagging.success
      } succeeded, ${stats.tagging.failed} failed`
    );

    // 5. Generate images for events without images (or with placeholder images)
    // Also catch Meetup fallback images that should be replaced
    const needsImage = (url: string | null | undefined): boolean => {
      if (!url) return true;
      // Meetup placeholder/fallback images should be replaced with AI-generated ones
      if (
        url.includes("/images/fallbacks/") ||
        url.includes("group-cover") ||
        url.includes("default_photo")
      ) {
        return true;
      }
      return false;
    };
    const eventsWithoutImages = allEvents.filter((e) => needsImage(e.imageUrl));
    console.log(
      `[Cron] Found ${eventsWithoutImages.length} events needing images (no image or placeholder).`
    );

    const imageStartTime = Date.now();
    for (const batch of chunk(eventsWithoutImages, 3)) {
      await Promise.all(
        batch.map(async (event) => {
          try {
            const imageUrl = await generateEventImage({
              title: event.title,
              description: event.description,
              location: event.location,
              tags: event.tags,
            });
            if (imageUrl) {
              event.imageUrl = imageUrl;
              stats.images.success++;
            } else {
              stats.images.failed++;
              console.warn(
                `[Cron] Image generation returned null for "${event.title}"`
              );
            }
          } catch (err) {
            stats.images.failed++;
            console.error(
              `[Cron] Failed to generate image for "${event.title}":`,
              err instanceof Error ? err.message : err
            );
          }
        })
      );
      // Longer delay for image generation (more resource intensive)
      await new Promise((r) => setTimeout(r, 2000));
    }
    stats.images.duration = Date.now() - imageStartTime;
    console.log(
      `[Cron] Image generation complete in ${formatDuration(
        stats.images.duration
      )}: ${stats.images.success} succeeded, ${stats.images.failed} failed`
    );

    console.log(`[Cron] Upserting ${allEvents.length} events to database...`);

    // Batch upserts in parallel (chunks of 10 to avoid overwhelming the DB)
    const upsertStartTime = Date.now();
    const upsertBatches = chunk(allEvents, 10);

    for (const batch of upsertBatches) {
      await Promise.all(
        batch.map(async (event) => {
          try {
            await db
              .insert(events)
              .values({
                sourceId: event.sourceId,
                source: event.source,
                title: event.title,
                description: event.description,
                startDate: event.startDate,
                location: event.location,
                organizer: event.organizer,
                price: event.price,
                url: event.url,
                imageUrl: event.imageUrl,
                tags: event.tags || [],
                interestedCount: event.interestedCount,
                goingCount: event.goingCount,
              })
              .onConflictDoUpdate({
                target: events.url,
                set: {
                  title: event.title,
                  description: event.description,
                  startDate: event.startDate,
                  location: event.location,
                  organizer: event.organizer,
                  price: event.price,
                  imageUrl: event.imageUrl,
                  interestedCount: event.interestedCount,
                  goingCount: event.goingCount,
                },
              });
            stats.upsert.success++;
          } catch (err) {
            stats.upsert.failed++;
            console.error(
              `[Cron] Failed to upsert "${event.title}" (${event.source}):`,
              err instanceof Error ? err.message : err
            );
          }
        })
      );
    }
    stats.upsert.duration = Date.now() - upsertStartTime;
    console.log(
      `[Cron] Upsert complete in ${formatDuration(stats.upsert.duration)}: ${
        stats.upsert.success
      } succeeded, ${stats.upsert.failed} failed`
    );

    // Note: We no longer delete old events - they're kept in the DB for historical reference
    // Only duplicates are removed (see deduplication below)

    // Deduplication: Remove duplicate events after upsert
    // Duplicates = same organizer + same time + share significant word in title
    console.log(`[Cron] Running deduplication...`);
    const allDbEvents = await db
      .select({
        id: events.id,
        title: events.title,
        organizer: events.organizer,
        startDate: events.startDate,
        price: events.price,
        description: events.description,
        createdAt: events.createdAt,
      })
      .from(events);

    const duplicateGroups = findDuplicates(allDbEvents);
    const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);
    stats.dedup.removed = duplicateIdsToRemove.length;

    if (duplicateIdsToRemove.length > 0) {
      await db.delete(events).where(inArray(events.id, duplicateIdsToRemove));
      console.log(
        `[Cron] Deduplication: removed ${duplicateIdsToRemove.length} duplicate events.`
      );
    } else {
      console.log(`[Cron] Deduplication: no duplicates found.`);
    }

    // Final summary
    const totalDuration = Date.now() - jobStartTime;
    console.log("[Cron] ────────────────────────────────────────────────");
    console.log(`[Cron] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log("[Cron] ────────────────────────────────────────────────");
    console.log(
      `[Cron] Scraping:  ${stats.scraping.total} events in ${formatDuration(
        stats.scraping.duration
      )}`
    );
    console.log(
      `[Cron]   → AVL: ${avlEvents.length}, EB: ${ebEvents.length}, Meetup: ${
        meetupEvents.length
      }, Harrahs: ${harrahsEvents.length}, OrangePeel: ${
        orangePeelEvents.length
      }, GreyEagle: ${greyEagleEvents.length}, LiveMusicAVL: ${
        liveMusicAvlEvents.length
      }${fbEvents.length > 0 ? `, FB: ${fbEvents.length}` : ""}`
    );
    console.log(
      `[Cron] Tagging:   ${stats.tagging.success}/${
        newEvents.length
      } new events tagged in ${formatDuration(stats.tagging.duration)}${
        stats.tagging.failed > 0 ? ` (${stats.tagging.failed} failed)` : ""
      }`
    );
    console.log(
      `[Cron] Images:    ${stats.images.success}/${
        eventsWithoutImages.length
      } generated in ${formatDuration(stats.images.duration)}${
        stats.images.failed > 0 ? ` (${stats.images.failed} failed)` : ""
      }`
    );
    console.log(
      `[Cron] Database:  ${stats.upsert.success} upserted in ${formatDuration(
        stats.upsert.duration
      )}${stats.upsert.failed > 0 ? ` (${stats.upsert.failed} failed)` : ""}, ${
        stats.dedup.removed
      } duplicates removed`
    );
    console.log("[Cron] ════════════════════════════════════════════════");

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats: {
        scraped: stats.scraping.total,
        newEvents: newEvents.length,
        tagged: stats.tagging.success,
        imagesGenerated: stats.images.success,
        upserted: stats.upsert.success,
        duplicatesRemoved: stats.dedup.removed,
        failures: {
          tagging: stats.tagging.failed,
          images: stats.images.failed,
          upsert: stats.upsert.failed,
        },
      },
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error("[Cron] ════════════════════════════════════════════════");
    console.error(`[Cron] JOB FAILED after ${formatDuration(totalDuration)}`);
    console.error("[Cron] Error:", error);
    console.error("[Cron] ════════════════════════════════════════════════");
    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
