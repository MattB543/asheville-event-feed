import '../lib/config/env'; // Load .env with override
import { scrapeMeetup } from '../lib/scrapers/meetup';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { inArray } from 'drizzle-orm';
import { generateEventTags } from '../lib/ai/tagging';
import { generateEventImage } from '../lib/ai/imageGeneration';
import { ScrapedEventWithTags } from '../lib/scrapers/types';

async function main() {
  console.log('Starting bulk Meetup scrape (30 pages)...');

  try {
    // Scrape 30 pages (~1500 events before filtering)
    const meetupEvents: ScrapedEventWithTags[] = await scrapeMeetup(30);
    console.log(`Scraped ${meetupEvents.length} Asheville-area events.`);

    if (meetupEvents.length === 0) {
      console.log('No events found. Exiting.');
      return;
    }

    // Find which URLs already exist in DB
    const scrapedUrls = meetupEvents.map(e => e.url);
    const existingEvents = await db
      .select({ url: events.url })
      .from(events)
      .where(inArray(events.url, scrapedUrls));
    const existingUrls = new Set(existingEvents.map(e => e.url));

    const newEvents = meetupEvents.filter(e => !existingUrls.has(e.url));
    console.log(`Found ${newEvents.length} NEW events (${existingUrls.size} already in DB).`);

    // Generate tags for new events
    const chunk = <T>(arr: T[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

    console.log('Generating tags for new events...');
    let taggedCount = 0;
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
          taggedCount++;
        } catch (err) {
          console.error(`Failed to tag: ${event.title}`, err);
        }
      }));
      await new Promise(r => setTimeout(r, 1000));
      process.stdout.write(`\rTagged ${taggedCount}/${newEvents.length}`);
    }
    console.log('\nTagging complete.');

    // Generate images for events without images
    const eventsWithoutImages = meetupEvents.filter(e => !e.imageUrl);
    console.log(`Generating images for ${eventsWithoutImages.length} events...`);
    let imageCount = 0;
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
            imageCount++;
          }
        } catch (err) {
          console.error(`Failed to generate image: ${event.title}`, err);
        }
      }));
      await new Promise(r => setTimeout(r, 2000));
      process.stdout.write(`\rGenerated ${imageCount} images`);
    }
    console.log('\nImage generation complete.');

    // Upsert to database
    console.log('Upserting to database...');
    let upsertCount = 0;
    for (const batch of chunk(meetupEvents, 10)) {
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
          console.error(`Failed to upsert: ${event.title}`, err);
        }
      }));
    }

    console.log(`\nDone! Upserted ${upsertCount} events.`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
