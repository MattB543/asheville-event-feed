import "../lib/config/env";

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { isNonNCEvent, getNonNCReason } from "../lib/utils/locationFilter";

async function findNonNCEvents() {
  console.log("Finding non-NC events in database...\n");

  const allEvents = await db.select().from(events);
  console.log(`Total events in database: ${allEvents.length}\n`);

  const nonNCEvents: Array<{
    id: string;
    title: string;
    location: string | null;
    reason: string | null;
    source: string;
  }> = [];

  for (const event of allEvents) {
    if (isNonNCEvent(event.title, event.location)) {
      nonNCEvents.push({
        id: event.id,
        title: event.title,
        location: event.location,
        reason: getNonNCReason(event.title, event.location),
        source: event.source,
      });
    }
  }

  console.log(`Found ${nonNCEvents.length} non-NC events:\n`);
  console.log("=".repeat(80));

  for (const event of nonNCEvents) {
    console.log(`ID: ${event.id}`);
    console.log(`Title: ${event.title}`);
    console.log(`Location: ${event.location || "N/A"}`);
    console.log(`Source: ${event.source}`);
    console.log(`Reason: ${event.reason}`);
    console.log("-".repeat(80));
  }

  // Group by reason
  const byReason = new Map<string, number>();
  for (const event of nonNCEvents) {
    const reason = event.reason || "Unknown";
    byReason.set(reason, (byReason.get(reason) || 0) + 1);
  }

  console.log("\nSummary by reason:");
  for (const [reason, count] of byReason.entries()) {
    console.log(`  ${reason}: ${count}`);
  }

  return nonNCEvents;
}

findNonNCEvents()
  .then((events) => {
    console.log(`\nTotal non-NC events to delete: ${events.length}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
