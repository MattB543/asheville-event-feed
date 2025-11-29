/**
 * Fix events that have Meetup placeholder/fallback images
 * These should be replaced with AI-generated images
 */

import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, or, like, isNull } from 'drizzle-orm';
import { generateEventImage, isImageGenerationEnabled } from '../lib/ai/imageGeneration';

async function fixPlaceholderImages() {
  console.log('=== Fixing Placeholder Images ===\n');

  if (!isImageGenerationEnabled()) {
    console.log('ERROR: GEMINI_API_KEY not set. Cannot generate AI images.');
    process.exit(1);
  }

  // Find events with placeholder images
  const allEvents = await db.select().from(events);

  const needsFix = allEvents.filter(e => {
    if (!e.imageUrl) return true;
    if (e.imageUrl.includes('/images/fallbacks/')) return true;
    if (e.imageUrl.includes('group-cover')) return true;
    if (e.imageUrl.includes('default_photo')) return true;
    return false;
  });

  console.log(`Found ${needsFix.length} events needing image fixes:\n`);
  needsFix.forEach(e => {
    console.log(`  [${e.source}] ${e.title.substring(0, 50)}`);
    console.log(`    Current imageUrl: ${e.imageUrl || 'NULL'}`);
  });

  if (needsFix.length === 0) {
    console.log('No events need fixing!');
    process.exit(0);
  }

  console.log('\n--- Generating AI images ---\n');

  let fixed = 0;
  let failed = 0;

  for (const event of needsFix) {
    try {
      console.log(`Generating image for: ${event.title.substring(0, 50)}...`);

      const imageUrl = await generateEventImage({
        title: event.title,
        description: event.description,
        location: event.location,
        tags: event.tags || [],
      });

      if (imageUrl) {
        await db.update(events)
          .set({ imageUrl })
          .where(eq(events.id, event.id));

        console.log(`  ✓ Updated with AI image (${(imageUrl.length / 1024).toFixed(1)}KB)`);
        fixed++;
      } else {
        console.log(`  ✗ AI returned no image`);
        failed++;
      }

      // Rate limiting - wait between generations
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.error(`  ✗ Error:`, error);
      failed++;
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`Fixed: ${fixed}`);
  console.log(`Failed: ${failed}`);

  process.exit(0);
}

fixPlaceholderImages().catch(console.error);
