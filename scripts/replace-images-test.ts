import '../lib/config/env';

import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { generateEventImage } from '../lib/ai/imageGeneration';
import { sql } from 'drizzle-orm';

async function main() {
  const limit = parseInt(process.argv[2] || '3', 10);

  console.log(`Selecting ${limit} events with missing images...\n`);

  // Get events that have NO image (NULL or empty string only)
  const targetEvents = await db
    .select()
    .from(events)
    .where(sql`image_url IS NULL OR image_url = ''`)
    .limit(limit);

  if (targetEvents.length === 0) {
    console.log('No suitable events found!');
    return;
  }

  console.log(`Found ${targetEvents.length} events to update:\n`);

  for (const event of targetEvents) {
    console.log(`--- ${event.title} ---`);
    console.log(`  ID: ${event.id}`);
    console.log(`  Old image: ${event.imageUrl?.slice(0, 60)}...`);

    try {
      const imageUrl = await generateEventImage({
        title: event.title,
        description: event.description,
        location: event.location,
        tags: event.tags || [],
      });

      if (imageUrl) {
        // Update DB with the new image
        await db
          .update(events)
          .set({ imageUrl })
          .where(sql`${events.id} = ${event.id}`);

        console.log(`  ✓ New image saved (${(imageUrl.length / 1024).toFixed(1)} KB data URL)`);
        console.log(`  URL: ${event.url}\n`);
      } else {
        console.log(`  ✗ No image generated\n`);
      }
    } catch (err) {
      console.error(`  ✗ Error:`, err);
    }

    // Delay between requests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n✓ Done! Check your dev server to see the generated images.');
  console.log('  The events above now have AI-generated compressed images.');
}

main().catch(console.error);
