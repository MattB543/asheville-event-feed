import '../../lib/config/env';

import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { generateEventImage } from '../../lib/ai/imageGeneration';
import { sql, isNull } from 'drizzle-orm';

async function main() {
  const limit = parseInt(process.argv[2] || '3', 10);

  console.log(`Finding ${limit} events without images...\n`);

  // Find events without images
  const eventsWithoutImages = await db
    .select()
    .from(events)
    .where(isNull(events.imageUrl))
    .limit(limit);

  if (eventsWithoutImages.length === 0) {
    console.log('No events without images found!');
    return;
  }

  console.log(`Found ${eventsWithoutImages.length} events without images:\n`);

  for (const event of eventsWithoutImages) {
    console.log(`--- ${event.title} ---`);
    console.log(`  ID: ${event.id}`);
    console.log(`  Location: ${event.location || 'N/A'}`);
    console.log(`  Tags: ${event.tags?.join(', ') || 'None'}`);

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

        console.log(`  ✓ Image saved to DB (${(imageUrl.length / 1024).toFixed(1)} KB data URL)\n`);
      } else {
        console.log(`  ✗ No image generated\n`);
      }
    } catch (err) {
      console.error(`  ✗ Error:`, err);
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nDone! Check your dev server to see the images.');
}

main().catch(console.error);
