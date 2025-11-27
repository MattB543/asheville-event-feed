import "../lib/config/env";

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Script to check for dead/404 Eventbrite events and optionally remove them
 * Usage: npx tsx scripts/check-dead-events.ts
 */

interface DeadEvent {
  id: string;
  title: string;
  url: string;
  status: number;
}

async function checkUrl(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      method: "HEAD", // Use HEAD to avoid downloading full page
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      redirect: "follow",
    });
    return response.status;
  } catch (err) {
    // Network error
    return 0;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Dead Event Checker");
  console.log("=".repeat(60));

  // Fetch all Eventbrite events
  console.log("\n[Step 1] Fetching Eventbrite events from database...");
  const eventbriteEvents = await db
    .select()
    .from(events)
    .where(eq(events.source, "EVENTBRITE"));

  console.log(`Found ${eventbriteEvents.length} Eventbrite events.`);

  // Check each URL
  console.log("\n[Step 2] Checking URLs for dead links...\n");
  const deadEvents: DeadEvent[] = [];
  const batchSize = 10;

  for (let i = 0; i < eventbriteEvents.length; i += batchSize) {
    const batch = eventbriteEvents.slice(i, i + batchSize);
    const progress = `[${i + 1}-${Math.min(i + batchSize, eventbriteEvents.length)}/${eventbriteEvents.length}]`;

    // Check batch in parallel
    const results = await Promise.all(
      batch.map(async (event) => {
        const status = await checkUrl(event.url);
        return { event, status };
      })
    );

    // Log progress and collect dead events
    for (const { event, status } of results) {
      if (status === 404 || status === 410) {
        console.log(`${progress} ❌ ${status} - ${event.title.substring(0, 50)}...`);
        deadEvents.push({
          id: event.id,
          title: event.title,
          url: event.url,
          status,
        });
      } else if (status === 0) {
        console.log(`${progress} ⚠️  Network error - ${event.title.substring(0, 50)}...`);
      } else {
        // Only log every 10th success to reduce noise
        if ((i + results.indexOf({ event, status })) % 20 === 0) {
          console.log(`${progress} ✓ Checking...`);
        }
      }
    }

    // Small delay between batches to be polite
    await new Promise((r) => setTimeout(r, 500));
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Total Eventbrite events: ${eventbriteEvents.length}`);
  console.log(`Dead events (404/410): ${deadEvents.length}`);

  if (deadEvents.length > 0) {
    console.log("\nDead events found:");
    deadEvents.forEach((e, i) => {
      console.log(`  ${i + 1}. [${e.status}] ${e.title}`);
      console.log(`     ${e.url}`);
    });

    console.log("\n" + "=".repeat(60));
    console.log(`Found ${deadEvents.length} dead events.`);
    console.log("To delete them, run: npx tsx scripts/check-dead-events.ts --delete");
    console.log("=".repeat(60));

    // Check if --delete flag is passed
    if (process.argv.includes("--delete")) {
      console.log("\n⚠️  DELETING dead events...");
      for (const deadEvent of deadEvents) {
        await db.delete(events).where(eq(events.id, deadEvent.id));
        console.log(`  Deleted: ${deadEvent.title.substring(0, 50)}...`);
      }
      console.log(`\n✓ Deleted ${deadEvents.length} dead events.`);
    }
  } else {
    console.log("\n✓ No dead events found!");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
