import "../lib/config/env";
import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { generateEventTags } from "../lib/ai/tagging";
import { eq, sql } from "drizzle-orm";

/**
 * Test script to clear tags and re-tag 50 events with the new prompt
 * Usage: npx tsx scripts/retag-test.ts
 */
async function main() {
  const LIMIT = 50;

  console.log("=".repeat(60));
  console.log(`Re-tagging Test (${LIMIT} events)`);
  console.log("=".repeat(60));

  // Step 1: Clear all tags
  console.log("\n[Step 1] Clearing all existing tags...");
  await db.update(events).set({ tags: [] });
  console.log("All tags cleared.");

  // Step 2: Fetch 50 events to re-tag
  console.log(`\n[Step 2] Fetching ${LIMIT} events to tag...`);
  const eventsToTag = await db
    .select()
    .from(events)
    .limit(LIMIT);

  console.log(`Found ${eventsToTag.length} events.`);

  // Step 3: Generate tags for each event
  console.log("\n[Step 3] Generating tags...");
  let successCount = 0;
  let failCount = 0;

  for (const [index, event] of eventsToTag.entries()) {
    console.log(`\n[${index + 1}/${LIMIT}] "${event.title}"`);

    try {
      const tags = await generateEventTags({
        title: event.title,
        description: event.description,
        location: event.location,
        organizer: event.organizer,
        startDate: event.startDate,
      });

      console.log(`   Tags: ${JSON.stringify(tags)}`);

      if (tags.length > 0) {
        await db
          .update(events)
          .set({ tags })
          .where(eq(events.id, event.id));
        successCount++;
      } else {
        console.log(`   (No tags generated)`);
        failCount++;
      }
    } catch (err) {
      console.error(`   ERROR:`, err);
      failCount++;
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n" + "=".repeat(60));
  console.log("Re-tagging Test Complete!");
  console.log(`Success: ${successCount}`);
  console.log(`Failed/Empty: ${failCount}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
