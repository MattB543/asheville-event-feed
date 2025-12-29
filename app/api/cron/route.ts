import { NextResponse } from "next/server";
import { scrapeAvlToday } from "@/lib/scrapers/avltoday";
import { scrapeEventbrite } from "@/lib/scrapers/eventbrite";
import { scrapeMeetup } from "@/lib/scrapers/meetup";
import { scrapeFacebookEvents } from "@/lib/scrapers/facebook";
import { scrapeHarrahs } from "@/lib/scrapers/harrahs";
import { scrapeOrangePeel } from "@/lib/scrapers/orangepeel";
import { scrapeGreyEagle } from "@/lib/scrapers/greyeagle";
import { scrapeLiveMusicAvl } from "@/lib/scrapers/livemusicavl";
import { scrapeExploreAsheville, fetchEventDescription } from "@/lib/scrapers/exploreasheville";
import { scrapeMisfitImprov } from "@/lib/scrapers/misfitimprov";
import { scrapeUDharma } from "@/lib/scrapers/udharma";
import { scrapeNCStage } from "@/lib/scrapers/ncstage";
import { scrapeStoryParlor } from "@/lib/scrapers/storyparlor";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { generateEventTags } from "@/lib/ai/tagAndSummarize";
import { generateAndUploadEventImage } from "@/lib/ai/imageGeneration";
import type { ScrapedEventWithTags } from "@/lib/scrapers/types";
import { env, isFacebookEnabled } from "@/lib/config/env";
import { findDuplicates, getIdsToRemove } from "@/lib/utils/deduplication";
import { syncRecurringFromExploreAsheville } from "@/lib/utils/syncRecurringFromExploreAsheville";
import { verifyAuthToken } from "@/lib/utils/auth";
import { enrichEventData } from "@/lib/ai/dataEnrichment";
import { isAzureAIEnabled } from "@/lib/ai/provider-clients";
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

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const jobStartTime = Date.now();
  const azureEnabled = isAzureAIEnabled();

  // Stats tracking
  const stats = {
    scraping: { duration: 0, total: 0 },
    tagging: { duration: 0, success: 0, failed: 0, skipped: 0 },
    enrichment: { duration: 0, priceExtracted: 0, timeExtracted: 0, skipped: 0 },
    images: { duration: 0, success: 0, failed: 0 },
    upsert: { duration: 0, success: 0, failed: 0 },
    dedup: { removed: 0 },
    recurring: { found: 0, updated: 0 },
  };

  try {
    console.log("[Cron] ════════════════════════════════════════════════");
    console.log("[Cron] Starting scrape job...");

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
      exploreAshevilleResult,
      misfitImprovResult,
      udharmaResult,
      ncstageResult,
      storyParlorResult,
    ] = await Promise.allSettled([
      scrapeAvlToday(),
      scrapeEventbrite(25), // Scrape 25 pages (~500 events)
      scrapeMeetup(30), // Scrape 30 days of physical events (~236 events)
      scrapeHarrahs(), // Harrah's Cherokee Center (Ticketmaster API + HTML)
      scrapeOrangePeel(), // Orange Peel (Ticketmaster API + Website JSON-LD)
      scrapeGreyEagle(), // Grey Eagle (Website JSON-LD)
      scrapeLiveMusicAvl(), // Live Music Asheville (select venues only)
      scrapeExploreAsheville(), // ExploreAsheville.com public API
      scrapeMisfitImprov(), // Misfit Improv (Crowdwork API)
      scrapeUDharma(), // Urban Dharma NC (Squarespace API)
      scrapeNCStage(), // NC Stage Company (ThunderTix)
      scrapeStoryParlor(), // Story Parlor (Squarespace JSON-LD)
    ]);

    // Extract values from settled results, using empty arrays for rejected promises
    const avlEvents =
      avlResult.status === "fulfilled" ? avlResult.value : [];
    const ebEvents =
      ebResult.status === "fulfilled" ? ebResult.value : [];
    const meetupEvents =
      meetupResult.status === "fulfilled" ? meetupResult.value : [];
    const harrahsEvents =
      harrahsResult.status === "fulfilled" ? harrahsResult.value : [];
    const orangePeelEvents =
      orangePeelResult.status === "fulfilled" ? orangePeelResult.value : [];
    const greyEagleEvents =
      greyEagleResult.status === "fulfilled" ? greyEagleResult.value : [];
    const liveMusicAvlEvents =
      liveMusicAvlResult.status === "fulfilled" ? liveMusicAvlResult.value : [];
    const exploreAshevilleEvents =
      exploreAshevilleResult.status === "fulfilled" ? exploreAshevilleResult.value : [];
    const misfitImprovEvents =
      misfitImprovResult.status === "fulfilled" ? misfitImprovResult.value : [];
    const udharmaEvents =
      udharmaResult.status === "fulfilled" ? udharmaResult.value : [];
    const ncstageEvents =
      ncstageResult.status === "fulfilled" ? ncstageResult.value : [];
    const storyParlorEvents =
      storyParlorResult.status === "fulfilled" ? storyParlorResult.value : [];

    // Log any scraper failures
    if (avlResult.status === "rejected")
      console.error("[Cron] AVL Today scrape failed:", avlResult.reason);
    if (ebResult.status === "rejected")
      console.error("[Cron] Eventbrite scrape failed:", ebResult.reason);
    if (meetupResult.status === "rejected")
      console.error("[Cron] Meetup scrape failed:", meetupResult.reason);
    if (harrahsResult.status === "rejected")
      console.error("[Cron] Harrah's scrape failed:", harrahsResult.reason);
    if (orangePeelResult.status === "rejected")
      console.error("[Cron] Orange Peel scrape failed:", orangePeelResult.reason);
    if (greyEagleResult.status === "rejected")
      console.error("[Cron] Grey Eagle scrape failed:", greyEagleResult.reason);
    if (liveMusicAvlResult.status === "rejected")
      console.error("[Cron] Live Music AVL scrape failed:", liveMusicAvlResult.reason);
    if (exploreAshevilleResult.status === "rejected")
      console.error("[Cron] ExploreAsheville scrape failed:", exploreAshevilleResult.reason);
    if (misfitImprovResult.status === "rejected")
      console.error("[Cron] Misfit Improv scrape failed:", misfitImprovResult.reason);
    if (udharmaResult.status === "rejected")
      console.error("[Cron] UDharma scrape failed:", udharmaResult.reason);
    if (ncstageResult.status === "rejected")
      console.error("[Cron] NC Stage scrape failed:", ncstageResult.reason);
    if (storyParlorResult.status === "rejected")
      console.error("[Cron] Story Parlor scrape failed:", storyParlorResult.reason);

    stats.scraping.duration = Date.now() - scrapeStartTime;
    stats.scraping.total =
      avlEvents.length +
      ebEvents.length +
      meetupEvents.length +
      harrahsEvents.length +
      orangePeelEvents.length +
      greyEagleEvents.length +
      liveMusicAvlEvents.length +
      exploreAshevilleEvents.length +
      misfitImprovEvents.length +
      udharmaEvents.length +
      ncstageEvents.length +
      storyParlorEvents.length;

    console.log(
      `[Cron] Scrape complete in ${formatDuration(
        stats.scraping.duration
      )}. AVL: ${avlEvents.length}, EB: ${ebEvents.length}, Meetup: ${
        meetupEvents.length
      }, Harrahs: ${harrahsEvents.length}, OrangePeel: ${
        orangePeelEvents.length
      }, GreyEagle: ${greyEagleEvents.length}, LiveMusicAVL: ${
        liveMusicAvlEvents.length
      }, ExploreAVL: ${exploreAshevilleEvents.length}, Misfit: ${
        misfitImprovEvents.length
      }, UDharma: ${udharmaEvents.length}, NCStage: ${ncstageEvents.length}, StoryParlor: ${storyParlorEvents.length} (Total: ${stats.scraping.total})`
    );

    // Facebook scraping (separate due to browser requirements)
    // Note: Facebook scraping uses Playwright/Patchright which is resource-intensive
    // It's done separately to avoid blocking other scrapers if it fails
    let fbEvents: ScrapedEventWithTags[] = [];
    if (isFacebookEnabled()) {
      try {
        console.log("[Cron] Attempting Facebook scrape...");
        const fbRawEvents = await scrapeFacebookEvents();
        // Filter out low-interest events (must have >=4 going OR >=9 interested)
        // "Going" is a stronger signal than "interested"
        const fbFiltered = fbRawEvents.filter(
          (e) =>
            (e.goingCount !== undefined && e.goingCount >= 4) ||
            (e.interestedCount !== undefined && e.interestedCount >= 9)
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
    const exploreAshevilleWithTags: ScrapedEventWithTags[] = exploreAshevilleEvents.map(
      (e) => ({ ...e, tags: [] })
    );
    const misfitImprovWithTags: ScrapedEventWithTags[] = misfitImprovEvents.map(
      (e) => ({ ...e, tags: [] })
    );
    const udharmaWithTags: ScrapedEventWithTags[] = udharmaEvents.map(
      (e) => ({ ...e, tags: [] })
    );
    const ncstageWithTags: ScrapedEventWithTags[] = ncstageEvents.map(
      (e) => ({ ...e, tags: [] })
    );
    const storyParlorWithTags: ScrapedEventWithTags[] = storyParlorEvents.map(
      (e) => ({ ...e, tags: [] })
    );

    const allEventsRaw: ScrapedEventWithTags[] = [
      ...avlEvents,
      ...ebEvents,
      ...meetupEvents,
      ...fbEvents,
      ...harrahsWithTags,
      ...orangePeelWithTags,
      ...greyEagleWithTags,
      ...liveMusicAvlWithTags,
      ...exploreAshevilleWithTags,
      ...misfitImprovWithTags,
      ...udharmaWithTags,
      ...ncstageWithTags,
      ...storyParlorWithTags,
    ];

    // Filter out cancelled events (title starts with "CANCELLED")
    const allEvents = allEventsRaw.filter(
      (e) => !e.title.trim().toUpperCase().startsWith("CANCELLED")
    );
    const cancelledCount = allEventsRaw.length - allEvents.length;
    if (cancelledCount > 0) {
      console.log(`[Cron] Filtered out ${cancelledCount} cancelled events.`);
    }

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

    // 3.5 Fetch descriptions for new ExploreAsheville events
    // The grid API doesn't include descriptions, so we fetch from detail pages
    const newExploreEvents = newEvents.filter(
      (e) => e.source === "EXPLORE_ASHEVILLE" && !e.description
    );
    if (newExploreEvents.length > 0) {
      console.log(
        `[Cron] Fetching descriptions for ${newExploreEvents.length} new ExploreAsheville events...`
      );
      let descFetched = 0;
      for (const event of newExploreEvents) {
        try {
          // Strip hash fragment for recurring events (URL like ...#2025-12-15)
          const cleanUrl = event.url.split("#")[0];
          const description = await fetchEventDescription(cleanUrl);
          if (description) {
            event.description = description;
            descFetched++;
          }
        } catch {
          // Silently continue - descriptions are optional
        }
        // Rate limit: 150ms between fetches
        await new Promise((r) => setTimeout(r, 150));
      }
      console.log(
        `[Cron] Fetched ${descFetched}/${newExploreEvents.length} descriptions for ExploreAsheville events.`
      );
    }

    // 4. Generate tags for new events (in parallel with concurrency limit)
    // Helper to process in chunks to avoid rate limits
    const chunk = <T>(arr: T[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
      );

    if (azureEnabled) {
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
    } else {
      console.log("[Cron] Skipping tagging: Azure AI not configured");
      stats.tagging.failed = 0;
    }

    // 4.5 AI Enrichment: Extract missing price/time for new events
    // Only process events that still have Unknown price or timeUnknown=true
    // Limit to 10 events per cron run to avoid excessive API calls
    const MAX_ENRICHMENT_PER_RUN = 10;
    const eventsNeedingEnrichment = newEvents.filter(
      (e) =>
        !e.price || e.price === "Unknown" || e.timeUnknown === true
    );

    if (eventsNeedingEnrichment.length > 0 && azureEnabled) {
      const eventsToEnrich = eventsNeedingEnrichment.slice(0, MAX_ENRICHMENT_PER_RUN);
      stats.enrichment.skipped = eventsNeedingEnrichment.length - eventsToEnrich.length;

      console.log(
        `[Cron] AI enrichment: processing ${eventsToEnrich.length} events (${stats.enrichment.skipped} skipped due to limit)`
      );

      const enrichmentStartTime = Date.now();
      for (const event of eventsToEnrich) {
        try {
          const result = await enrichEventData({
            title: event.title,
            description: event.description,
            url: event.url,
            organizer: event.organizer,
            currentPrice: event.price,
            timeUnknown: event.timeUnknown,
            currentStartDate: event.startDate,
          });

          if (result) {
            if (result.price && (!event.price || event.price === "Unknown")) {
              event.price = result.price;
              stats.enrichment.priceExtracted++;
            }
            if (result.updatedStartDate && event.timeUnknown) {
              event.startDate = result.updatedStartDate;
              event.timeUnknown = false;
              stats.enrichment.timeExtracted++;
            }
          }
        } catch (err) {
          console.warn(
            `[Cron] Enrichment failed for "${event.title}":`,
            err instanceof Error ? err.message : err
          );
        }
        // Rate limit between enrichment calls
        await new Promise((r) => setTimeout(r, 500));
      }
      stats.enrichment.duration = Date.now() - enrichmentStartTime;
      console.log(
        `[Cron] Enrichment complete in ${formatDuration(stats.enrichment.duration)}: ${
          stats.enrichment.priceExtracted
        } prices, ${stats.enrichment.timeExtracted} times extracted`
      );
    } else if (eventsNeedingEnrichment.length > 0) {
      console.log(`[Cron] Skipping AI enrichment: Azure AI not configured`);
    }

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
            // Use source-sourceId as unique key for storage (since we don't have DB ID yet)
            const storageKey = `${event.source}-${event.sourceId}`;
            const imageUrl = await generateAndUploadEventImage(
              {
                title: event.title,
                description: event.description,
                location: event.location,
                tags: event.tags,
              },
              storageKey
            );
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
                zip: event.zip,
                organizer: event.organizer,
                price: event.price,
                url: event.url,
                imageUrl: event.imageUrl,
                tags: event.tags || [],
                interestedCount: event.interestedCount,
                goingCount: event.goingCount,
                timeUnknown: event.timeUnknown || false,
                recurringType: event.recurringType,
                recurringEndDate: event.recurringEndDate,
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
                  timeUnknown: event.timeUnknown || false,
                  recurringType: event.recurringType,
                  recurringEndDate: event.recurringEndDate,
                  lastSeenAt: new Date(),
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
    // Uses multiple methods including venue-based matching for cross-source duplicates
    console.log(`[Cron] Running deduplication...`);
    const allDbEvents = await db
      .select({
        id: events.id,
        title: events.title,
        organizer: events.organizer,
        location: events.location,
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

    // Sync recurring info from Explore Asheville
    // This enriches events from other sources with daily recurring metadata
    console.log(`[Cron] Syncing recurring info from Explore Asheville...`);
    try {
      const recurringResult = await syncRecurringFromExploreAsheville();
      stats.recurring.found = recurringResult.dailyRecurringFound;
      stats.recurring.updated = recurringResult.eventsUpdated;
      console.log(
        `[Cron] Recurring sync: found ${recurringResult.dailyRecurringFound} daily events, updated ${recurringResult.eventsUpdated} DB events`
      );
    } catch (recurringError) {
      console.error("[Cron] Recurring sync failed:", recurringError);
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
      }, ExploreAVL: ${exploreAshevilleEvents.length}, Misfit: ${
        misfitImprovEvents.length
      }, UDharma: ${udharmaEvents.length}, NCStage: ${ncstageEvents.length}, StoryParlor: ${storyParlorEvents.length}${fbEvents.length > 0 ? `, FB: ${fbEvents.length}` : ""}`
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
    console.log(
      `[Cron] Recurring: ${stats.recurring.updated} events tagged as daily (from ${stats.recurring.found} EA daily events)`
    );
    console.log("[Cron] ════════════════════════════════════════════════");

    // Invalidate cache so home page shows updated events
    invalidateEventsCache();

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
        recurringTagged: stats.recurring.updated,
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
