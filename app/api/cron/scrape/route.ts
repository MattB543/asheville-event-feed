import { NextResponse } from "next/server";
import { scrapeAvlToday } from "@/lib/scrapers/avltoday";
import { scrapeEventbrite } from "@/lib/scrapers/eventbrite";
import { scrapeMeetup } from "@/lib/scrapers/meetup";
import { scrapeFacebookEvents } from "@/lib/scrapers/facebook";
import { scrapeHarrahs } from "@/lib/scrapers/harrahs";
import { scrapeOrangePeel } from "@/lib/scrapers/orangepeel";
import { scrapeGreyEagle } from "@/lib/scrapers/greyeagle";
import { scrapeLiveMusicAvl } from "@/lib/scrapers/livemusicavl";
import { scrapeMountainX } from "@/lib/scrapers/mountainx";
import { scrapeStaticAge } from "@/lib/scrapers/staticage";
import { scrapeRevolve } from "@/lib/scrapers/revolve";
import { scrapeBMCMuseum } from "@/lib/scrapers/bmcmuseum";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { ScrapedEvent } from "@/lib/scrapers/types";
import { env, isFacebookEnabled } from "@/lib/config/env";
import { findDuplicates, getIdsToRemove } from "@/lib/utils/deduplication";
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

// Scrape-only cron job
//
// This route handles ONLY scraping and database upserts.
// AI tagging and image generation are handled by /api/cron/ai
//
// Schedule: Every 6 hours at :00 (cron: "0 0/6 * * *")
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const jobStartTime = Date.now();

  // Stats tracking
  const stats = {
    scraping: { duration: 0, total: 0 },
    upsert: { duration: 0, success: 0, failed: 0 },
    dedup: { removed: 0 },
  };

  try {
    console.log("[Scrape] ════════════════════════════════════════════════");
    console.log("[Scrape] Starting scrape-only job...");

    // Scrape all sources in parallel
    const scrapeStartTime = Date.now();
    const [
      avlResult,
      ebResult,
      meetupResult,
      harrahsResult,
      orangePeelResult,
      greyEagleResult,
      liveMusicAvlResult,
      mountainXResult,
      staticAgeResult,
      revolveResult,
      bmcMuseumResult,
    ] = await Promise.allSettled([
      scrapeAvlToday(),
      scrapeEventbrite(25), // Scrape 25 pages (~500 events)
      scrapeMeetup(30), // Scrape 30 days of physical events (~236 events)
      scrapeHarrahs(), // Harrah's Cherokee Center (Ticketmaster API + HTML)
      scrapeOrangePeel(), // Orange Peel (Ticketmaster API + Website JSON-LD)
      scrapeGreyEagle(), // Grey Eagle (Website JSON-LD)
      scrapeLiveMusicAvl(), // Live Music Asheville (select venues only)
      scrapeMountainX(), // Mountain Xpress (Tribe Events REST API)
      scrapeStaticAge(), // Static Age NC (Next.js + Sanity CMS)
      scrapeRevolve(), // Revolve (Asheville arts collective)
      scrapeBMCMuseum(), // Black Mountain College Museum + Arts Center
    ]);

    // Extract values from settled results
    const avlEvents = avlResult.status === "fulfilled" ? avlResult.value : [];
    const ebEvents = ebResult.status === "fulfilled" ? ebResult.value : [];
    const meetupEvents = meetupResult.status === "fulfilled" ? meetupResult.value : [];
    const harrahsEvents = harrahsResult.status === "fulfilled" ? harrahsResult.value : [];
    const orangePeelEvents = orangePeelResult.status === "fulfilled" ? orangePeelResult.value : [];
    const greyEagleEvents = greyEagleResult.status === "fulfilled" ? greyEagleResult.value : [];
    const liveMusicAvlEvents = liveMusicAvlResult.status === "fulfilled" ? liveMusicAvlResult.value : [];
    const mountainXEvents = mountainXResult.status === "fulfilled" ? mountainXResult.value : [];
    const staticAgeEvents = staticAgeResult.status === "fulfilled" ? staticAgeResult.value : [];
    const revolveEvents = revolveResult.status === "fulfilled" ? revolveResult.value : [];
    const bmcMuseumEvents = bmcMuseumResult.status === "fulfilled" ? bmcMuseumResult.value : [];

    // Log any scraper failures
    if (avlResult.status === "rejected")
      console.error("[Scrape] AVL Today scrape failed:", avlResult.reason);
    if (ebResult.status === "rejected")
      console.error("[Scrape] Eventbrite scrape failed:", ebResult.reason);
    if (meetupResult.status === "rejected")
      console.error("[Scrape] Meetup scrape failed:", meetupResult.reason);
    if (harrahsResult.status === "rejected")
      console.error("[Scrape] Harrah's scrape failed:", harrahsResult.reason);
    if (orangePeelResult.status === "rejected")
      console.error("[Scrape] Orange Peel scrape failed:", orangePeelResult.reason);
    if (greyEagleResult.status === "rejected")
      console.error("[Scrape] Grey Eagle scrape failed:", greyEagleResult.reason);
    if (liveMusicAvlResult.status === "rejected")
      console.error("[Scrape] Live Music AVL scrape failed:", liveMusicAvlResult.reason);
    if (mountainXResult.status === "rejected")
      console.error("[Scrape] Mountain Xpress scrape failed:", mountainXResult.reason);
    if (staticAgeResult.status === "rejected")
      console.error("[Scrape] Static Age scrape failed:", staticAgeResult.reason);
    if (revolveResult.status === "rejected")
      console.error("[Scrape] Revolve scrape failed:", revolveResult.reason);
    if (bmcMuseumResult.status === "rejected")
      console.error("[Scrape] BMC Museum scrape failed:", bmcMuseumResult.reason);

    stats.scraping.duration = Date.now() - scrapeStartTime;
    stats.scraping.total =
      avlEvents.length +
      ebEvents.length +
      meetupEvents.length +
      harrahsEvents.length +
      orangePeelEvents.length +
      greyEagleEvents.length +
      liveMusicAvlEvents.length +
      mountainXEvents.length +
      staticAgeEvents.length +
      revolveEvents.length +
      bmcMuseumEvents.length;

    console.log(
      `[Scrape] Scrape complete in ${formatDuration(stats.scraping.duration)}. AVL: ${avlEvents.length}, EB: ${ebEvents.length}, Meetup: ${meetupEvents.length}, Harrahs: ${harrahsEvents.length}, OrangePeel: ${orangePeelEvents.length}, GreyEagle: ${greyEagleEvents.length}, LiveMusicAVL: ${liveMusicAvlEvents.length}, MountainX: ${mountainXEvents.length}, StaticAge: ${staticAgeEvents.length}, Revolve: ${revolveEvents.length}, BMCMuseum: ${bmcMuseumEvents.length} (Total: ${stats.scraping.total})`
    );

    // Facebook scraping (separate due to browser requirements)
    let fbEvents: ScrapedEvent[] = [];
    if (isFacebookEnabled()) {
      try {
        console.log("[Scrape] Attempting Facebook scrape...");
        const fbRawEvents = await scrapeFacebookEvents();
        // Filter out low-interest events (must have >=4 going OR >=9 interested)
        fbEvents = fbRawEvents.filter(
          (e) =>
            (e.goingCount !== undefined && e.goingCount >= 4) ||
            (e.interestedCount !== undefined && e.interestedCount >= 9)
        );
        console.log(
          `[Scrape] Facebook scrape complete: ${fbEvents.length} events (filtered ${fbRawEvents.length - fbEvents.length} low-interest)`
        );
      } catch (fbError) {
        console.error("[Scrape] Facebook scrape failed (continuing):", fbError);
      }
    }

    // Combine all events (no tags - AI job will add them later)
    const allEvents: ScrapedEvent[] = [
      ...avlEvents.map(e => ({ ...e, tags: undefined })),
      ...ebEvents.map(e => ({ ...e, tags: undefined })),
      ...meetupEvents.map(e => ({ ...e, tags: undefined })),
      ...fbEvents,
      ...harrahsEvents,
      ...orangePeelEvents,
      ...greyEagleEvents,
      ...liveMusicAvlEvents,
      ...mountainXEvents,
      ...staticAgeEvents,
      ...revolveEvents,
      ...bmcMuseumEvents,
    ];

    console.log(`[Scrape] Upserting ${allEvents.length} events to database...`);

    // Helper to chunk arrays
    const chunk = <T>(arr: T[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
      );

    // Batch upserts (chunks of 10)
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
                zip: event.zip,
                organizer: event.organizer,
                price: event.price,
                url: event.url,
                imageUrl: event.imageUrl,
                tags: [], // Empty tags - AI job will populate
                interestedCount: event.interestedCount,
                goingCount: event.goingCount,
                timeUnknown: event.timeUnknown || false,
                lastSeenAt: new Date(),
              })
              .onConflictDoUpdate({
                target: events.url,
                set: {
                  title: event.title,
                  description: event.description,
                  startDate: event.startDate,
                  location: event.location,
                  zip: event.zip,
                  organizer: event.organizer,
                  price: event.price,
                  imageUrl: event.imageUrl,
                  interestedCount: event.interestedCount,
                  goingCount: event.goingCount,
                  lastSeenAt: new Date(),
                  // Note: tags are NOT updated on conflict - preserves AI-generated tags
                },
              });
            stats.upsert.success++;
          } catch (err) {
            stats.upsert.failed++;
            console.error(
              `[Scrape] Failed to upsert "${event.title}" (${event.source}):`,
              err instanceof Error ? err.message : err
            );
          }
        })
      );
    }
    stats.upsert.duration = Date.now() - upsertStartTime;
    console.log(
      `[Scrape] Upsert complete in ${formatDuration(stats.upsert.duration)}: ${stats.upsert.success} succeeded, ${stats.upsert.failed} failed`
    );

    // Deduplication
    console.log(`[Scrape] Running deduplication...`);
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
      console.log(`[Scrape] Deduplication: removed ${duplicateIdsToRemove.length} duplicate events.`);
    } else {
      console.log(`[Scrape] Deduplication: no duplicates found.`);
    }

    // Final summary
    const totalDuration = Date.now() - jobStartTime;
    console.log("[Scrape] ────────────────────────────────────────────────");
    console.log(`[Scrape] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log("[Scrape] ────────────────────────────────────────────────");
    console.log(`[Scrape] Scraped: ${stats.scraping.total} events`);
    console.log(`[Scrape] Upserted: ${stats.upsert.success} (${stats.upsert.failed} failed)`);
    console.log(`[Scrape] Duplicates removed: ${stats.dedup.removed}`);
    console.log("[Scrape] ════════════════════════════════════════════════");

    // Invalidate cache so home page shows updated events
    invalidateEventsCache();

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats: {
        scraped: stats.scraping.total,
        upserted: stats.upsert.success,
        duplicatesRemoved: stats.dedup.removed,
        failures: {
          upsert: stats.upsert.failed,
        },
      },
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error("[Scrape] ════════════════════════════════════════════════");
    console.error(`[Scrape] JOB FAILED after ${formatDuration(totalDuration)}`);
    console.error("[Scrape] Error:", error);
    console.error("[Scrape] ════════════════════════════════════════════════");
    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}
