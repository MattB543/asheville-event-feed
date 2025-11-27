import { NextResponse } from 'next/server';
import { scrapeAvlToday } from '@/lib/scrapers/avltoday';
import { scrapeEventbrite } from '@/lib/scrapers/eventbrite';
import { scrapeMeetup } from '@/lib/scrapers/meetup';
import { scrapeFacebookEvents } from '@/lib/scrapers/facebook';
import { scrapeHarrahs } from '@/harrahs/harrahs-ticketmaster';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { sql, inArray } from 'drizzle-orm';
import { generateEventTags } from '@/lib/ai/tagging';
import { generateEventImage } from '@/lib/ai/imageGeneration';
import { ScrapedEventWithTags } from '@/lib/scrapers/types';
import { env, isFacebookEnabled } from '@/lib/config/env';

export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    console.log('[Cron] Starting scrape job...');

    // Scrape AVL Today, Eventbrite, Meetup, and Harrah's in parallel
    const [avlEvents, ebEvents, meetupEvents, harrahsEvents] = await Promise.all([
      scrapeAvlToday(),
      scrapeEventbrite(3), // Scrape 3 pages for regular updates (de-duplication handled by DB)
      scrapeMeetup(3),     // Scrape 3 pages (~150 events)
      scrapeHarrahs(),     // Harrah's Cherokee Center (Ticketmaster API + HTML)
    ]);

    console.log(`[Cron] Scrape complete. AVL: ${avlEvents.length}, EB: ${ebEvents.length}, Meetup: ${meetupEvents.length}, Harrahs: ${harrahsEvents.length}`);

    // Facebook scraping (separate due to browser requirements)
    // Note: Facebook scraping uses Playwright/Patchright which is resource-intensive
    // It's done separately to avoid blocking other scrapers if it fails
    let fbEvents: ScrapedEventWithTags[] = [];
    if (isFacebookEnabled()) {
      try {
        console.log('[Cron] Attempting Facebook scrape...');
        const fbRawEvents = await scrapeFacebookEvents();
        // Transform to ScrapedEventWithTags format
        fbEvents = fbRawEvents.map(e => ({ ...e, tags: [] }));
        console.log(`[Cron] Facebook scrape complete: ${fbEvents.length} events`);
      } catch (fbError) {
        // Log error but don't fail the entire cron job
        console.error('[Cron] Facebook scrape failed (continuing with other sources):', fbError);
      }
    }

    // Transform harrahsEvents to include tags array
    const harrahsWithTags: ScrapedEventWithTags[] = harrahsEvents.map(e => ({ ...e, tags: [] }));

    const allEvents: ScrapedEventWithTags[] = [...avlEvents, ...ebEvents, ...meetupEvents, ...fbEvents, ...harrahsWithTags];
    
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

    // 5. Generate images for events without images
    const eventsWithoutImages = allEvents.filter(e => !e.imageUrl);
    console.log(`[Cron] Found ${eventsWithoutImages.length} events without images. Generating...`);

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
              },
            });
          upsertCount++;
        } catch (err) {
          console.error(`[Cron] Failed to upsert event ${event.title}:`, err);
        }
      }));
    }
    console.log(`[Cron] Upserted ${upsertCount} events.`);

    // Cleanup old events (older than 24 hours ago)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    console.log(`[Cron] Cleaning up events older than ${yesterday.toISOString()}...`);
    await db.delete(events).where(sql`${events.startDate} < ${yesterday}`);
    console.log(`[Cron] Deleted old events.`);

    return NextResponse.json({ success: true, count: allEvents.length });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
