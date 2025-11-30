import { NextResponse } from 'next/server';
import { scrapeAvlToday } from '@/lib/scrapers/avltoday';
import { scrapeEventbrite } from '@/lib/scrapers/eventbrite';
import { scrapeMeetup } from '@/lib/scrapers/meetup';
import { scrapeFacebookEvents } from '@/lib/scrapers/facebook';
import { scrapeHarrahs } from '@/lib/scrapers/harrahs';
import { scrapeOrangePeel } from '@/lib/scrapers/orangepeel';
import { scrapeGreyEagle } from '@/lib/scrapers/greyeagle';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { generateEventTags } from '@/lib/ai/tagging';
import { generateEventImage } from '@/lib/ai/imageGeneration';
import { ScrapedEventWithTags } from '@/lib/scrapers/types';
import { env, isFacebookEnabled } from '@/lib/config/env';
import { findDuplicates, getIdsToRemove } from '@/lib/utils/deduplication';

export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    console.log('[Cron] Starting scrape job...');

    // Scrape AVL Today, Eventbrite, Meetup, Harrah's, Orange Peel, and Grey Eagle in parallel
    const [avlEvents, ebEvents, meetupEvents, harrahsEvents, orangePeelEvents, greyEagleEvents] = await Promise.all([
      scrapeAvlToday(),
      scrapeEventbrite(3), // Scrape 3 pages for regular updates (de-duplication handled by DB)
      scrapeMeetup(3),     // Scrape 3 pages (~150 events)
      scrapeHarrahs(),     // Harrah's Cherokee Center (Ticketmaster API + HTML)
      scrapeOrangePeel(),  // Orange Peel (Ticketmaster API + Website JSON-LD)
      scrapeGreyEagle(),   // Grey Eagle (Website JSON-LD)
    ]);

    console.log(`[Cron] Scrape complete. AVL: ${avlEvents.length}, EB: ${ebEvents.length}, Meetup: ${meetupEvents.length}, Harrahs: ${harrahsEvents.length}, OrangePeel: ${orangePeelEvents.length}, GreyEagle: ${greyEagleEvents.length}`);

    // Facebook scraping (separate due to browser requirements)
    // Note: Facebook scraping uses Playwright/Patchright which is resource-intensive
    // It's done separately to avoid blocking other scrapers if it fails
    let fbEvents: ScrapedEventWithTags[] = [];
    if (isFacebookEnabled()) {
      try {
        console.log('[Cron] Attempting Facebook scrape...');
        const fbRawEvents = await scrapeFacebookEvents();
        // Filter out low-interest events (must have >1 going OR >3 interested)
        // "Going" is a stronger signal than "interested"
        const fbFiltered = fbRawEvents.filter(e =>
          (e.goingCount !== undefined && e.goingCount > 1) ||
          (e.interestedCount !== undefined && e.interestedCount > 3)
        );
        // Transform to ScrapedEventWithTags format
        fbEvents = fbFiltered.map(e => ({ ...e, tags: [] }));
        console.log(`[Cron] Facebook scrape complete: ${fbEvents.length} events (filtered ${fbRawEvents.length - fbFiltered.length} low-interest)`);
      } catch (fbError) {
        // Log error but don't fail the entire cron job
        console.error('[Cron] Facebook scrape failed (continuing with other sources):', fbError);
      }
    }

    // Transform venue events to include tags array
    const harrahsWithTags: ScrapedEventWithTags[] = harrahsEvents.map(e => ({ ...e, tags: [] }));
    const orangePeelWithTags: ScrapedEventWithTags[] = orangePeelEvents.map(e => ({ ...e, tags: [] }));
    const greyEagleWithTags: ScrapedEventWithTags[] = greyEagleEvents.map(e => ({ ...e, tags: [] }));

    const allEvents: ScrapedEventWithTags[] = [...avlEvents, ...ebEvents, ...meetupEvents, ...fbEvents, ...harrahsWithTags, ...orangePeelWithTags, ...greyEagleWithTags];
    
    // Optimization: Only generate tags for NEW events
    // 1. Get URLs of all scraped events
    const scrapedUrls = allEvents.map(e => e.url);

    // 2. Find which URLs already exist in DB
    let existingUrls = new Set<string>();
    if (scrapedUrls.length > 0) {
      const existingEvents = await db
        .select({ url: events.url })
        .from(events)
        .where(inArray(events.url, scrapedUrls));
      existingUrls = new Set(existingEvents.map(e => e.url));
    }

    // 3. Identify new events
    const newEvents = allEvents.filter(e => !existingUrls.has(e.url));
    console.log(`[Cron] Found ${newEvents.length} new events to tag.`);

    // 4. Generate tags for new events (in parallel with concurrency limit)
    // Helper to process in chunks to avoid rate limits
    const chunk = <T>(arr: T[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

    for (const batch of chunk(newEvents, 5)) {
      await Promise.all(batch.map(async (event) => {
        try {
          const tags = await generateEventTags({
            title: event.title,
            description: event.description,
            location: event.location,
            organizer: event.organizer,
            startDate: event.startDate,
          });
          event.tags = tags;
        } catch (err) {
          console.error(`[Cron] Failed to tag event ${event.title}:`, err);
        }
      }));
      // Small delay between batches
      await new Promise(r => setTimeout(r, 1000));
    }

    // 5. Generate images for events without images (or with placeholder images)
    // Also catch Meetup fallback images that should be replaced
    const needsImage = (url: string | null | undefined): boolean => {
      if (!url) return true;
      // Meetup placeholder/fallback images should be replaced with AI-generated ones
      if (url.includes('/images/fallbacks/') || url.includes('group-cover') || url.includes('default_photo')) {
        return true;
      }
      return false;
    };
    const eventsWithoutImages = allEvents.filter(e => needsImage(e.imageUrl));
    console.log(`[Cron] Found ${eventsWithoutImages.length} events without images (or with placeholders). Generating...`);

    for (const batch of chunk(eventsWithoutImages, 3)) {
      await Promise.all(batch.map(async (event) => {
        try {
          const imageUrl = await generateEventImage({
            title: event.title,
            description: event.description,
            location: event.location,
            tags: event.tags,
          });
          if (imageUrl) {
            event.imageUrl = imageUrl;
          }
        } catch (err) {
          console.error(`[Cron] Failed to generate image for ${event.title}:`, err);
        }
      }));
      // Longer delay for image generation (more resource intensive)
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(`[Cron] Image generation complete.`);

    console.log(`[Cron] Upserting ${allEvents.length} events to database...`);

    // Batch upserts in parallel (chunks of 10 to avoid overwhelming the DB)
    let upsertCount = 0;
    const upsertBatches = chunk(allEvents, 10);

    for (const batch of upsertBatches) {
      await Promise.all(batch.map(async (event) => {
        try {
          await db.insert(events)
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
          upsertCount++;
        } catch (err) {
          console.error(`[Cron] Failed to upsert event ${event.title}:`, err);
        }
      }));
    }
    console.log(`[Cron] Upserted ${upsertCount} events.`);

    // Note: We no longer delete old events - they're kept in the DB for historical reference
    // Only duplicates are removed (see deduplication below)

    // Deduplication: Remove duplicate events after upsert
    // Duplicates = same organizer + same time + share significant word in title
    console.log(`[Cron] Running deduplication...`);
    const allDbEvents = await db.select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      startDate: events.startDate,
      price: events.price,
      description: events.description,
      createdAt: events.createdAt,
    }).from(events);

    const duplicateGroups = findDuplicates(allDbEvents);
    const duplicateIdsToRemove = getIdsToRemove(duplicateGroups);

    if (duplicateIdsToRemove.length > 0) {
      await db.delete(events).where(inArray(events.id, duplicateIdsToRemove));
      console.log(`[Cron] Removed ${duplicateIdsToRemove.length} duplicate events.`);
    } else {
      console.log(`[Cron] No duplicates found.`);
    }

    return NextResponse.json({
      success: true,
      count: allEvents.length,
      duplicatesRemoved: duplicateIdsToRemove.length,
    });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
