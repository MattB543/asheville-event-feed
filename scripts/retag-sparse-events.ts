/**
 * Re-tags events that have 0, 1, or 2 tags.
 * This is useful after cleaning up rare tags, to give events fresh tags
 * from the updated allowed tags list.
 */

import { env } from "../lib/config/env";
import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { generateEventTags } from "../lib/ai/tagging";
import { eq } from "drizzle-orm";

async function main() {
  const apiKey = env.GEMINI_API_KEY;
  console.log("Environment check:");
  console.log(`GEMINI_API_KEY present: ${!!apiKey}`);
  if (apiKey) {
    console.log(`GEMINI_API_KEY starts with: ${apiKey.substring(0, 4)}...`);
  } else {
    console.error("GEMINI_API_KEY is MISSING!");
    process.exit(1);
  }

  console.log("\nFetching events with 0 or 1 tags...");

  // Fetch all events and filter locally
  const allEvents = await db.select().from(events);

  const sparseEvents = allEvents.filter(
    (e) => !e.tags || e.tags.length <= 1
  );

  console.log(
    `Found ${sparseEvents.length} events with 0 or 1 tags (out of ${allEvents.length} total).`
  );

  if (sparseEvents.length === 0) {
    console.log("Nothing to re-tag!");
    process.exit(0);
  }

  let successCount = 0;
  let failCount = 0;
  let unchangedCount = 0;

  for (const [index, event] of sparseEvents.entries()) {
    const currentTagCount = event.tags?.length || 0;
    console.log(
      `\n[${index + 1}/${sparseEvents.length}] "${event.title}"`
    );
    console.log(`   Current tags (${currentTagCount}): ${JSON.stringify(event.tags || [])}`);

    try {
      const newTags = await generateEventTags({
        title: event.title,
        description: event.description,
        location: event.location,
        organizer: event.organizer,
        startDate: event.startDate,
      });

      console.log(`   New tags (${newTags.length}): ${JSON.stringify(newTags)}`);

      if (newTags.length > 0) {
        // Merge existing valid tags with new tags (deduplicated)
        const existingTags = event.tags || [];
        const mergedTags = [...new Set([...existingTags, ...newTags])];

        if (mergedTags.length > currentTagCount) {
          await db
            .update(events)
            .set({ tags: mergedTags })
            .where(eq(events.id, event.id));
          console.log(`   -> Updated: ${JSON.stringify(mergedTags)}`);
          successCount++;
        } else {
          console.log(`   -> No new tags to add, skipping.`);
          unchangedCount++;
        }
      } else {
        console.log(`   -> AI returned no tags, keeping existing.`);
        unchangedCount++;
      }
    } catch (err) {
      console.error(`   -> ERROR:`, err);
      failCount++;
    }

    // Rate limit delay
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n--------------------------------------------------");
  console.log("Re-tagging complete!");
  console.log(`Updated: ${successCount}`);
  console.log(`Unchanged: ${unchangedCount}`);
  console.log(`Failed: ${failCount}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
