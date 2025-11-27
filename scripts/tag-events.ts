import { env } from "../lib/config/env";
import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { generateEventTags } from "../lib/ai/tagging";
import { isNull, eq } from "drizzle-orm";

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

  console.log("Fetching events to tag...");
  
  // Fetch all events to check for empty tags locally (simpler than complex SQL for now)
  const allEvents = await db.select().from(events);
  
  const untaggedEvents = allEvents.filter(e => !e.tags || e.tags.length === 0);

  console.log(`Found ${untaggedEvents.length} events needing tags (out of ${allEvents.length} total).`);

  let successCount = 0;
  let failCount = 0;

  for (const [index, event] of untaggedEvents.entries()) {
    console.log(`[${index + 1}/${untaggedEvents.length}] Processing event: "${event.title}" (ID: ${event.id})`);
    
    try {
      const tags = await generateEventTags({
        title: event.title,
        description: event.description,
        location: event.location,
        organizer: event.organizer,
        startDate: event.startDate,
      });

      console.log(`   -> Generated tags: ${JSON.stringify(tags)}`);

      if (tags.length > 0) {
        await db
          .update(events)
          .set({ tags })
          .where(eq(events.id, event.id));
        console.log(`   -> Database updated.`);
        successCount++;
      } else {
        console.log(`   -> No tags generated (empty response). SKIPPING DB UPDATE.`);
        failCount++;
      }
    } catch (err) {
      console.error(`   -> ERROR processing event:`, err);
      failCount++;
    }
      
    // Add a small delay to avoid hitting rate limits too hard
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("--------------------------------------------------");
  console.log(`Backfill complete.`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed/Empty: ${failCount}`);
}

main().catch((err) => {
  console.error("Fatal error in main loop:", err);
  process.exit(1);
});
