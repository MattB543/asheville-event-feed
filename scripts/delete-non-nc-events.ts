import "../lib/config/env";

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { inArray } from "drizzle-orm";
import { isNonNCEvent, getNonNCReason } from "../lib/utils/locationFilter";

async function deleteNonNCEvents() {
  console.log("Finding and deleting non-NC events from database...\n");

  const allEvents = await db.select().from(events);
  console.log(`Total events in database: ${allEvents.length}\n`);

  const nonNCEvents: Array<{
    id: string;
    title: string;
    location: string | null;
    reason: string | null;
  }> = [];

  for (const event of allEvents) {
    if (isNonNCEvent(event.title, event.location)) {
      nonNCEvents.push({
        id: event.id,
        title: event.title,
        location: event.location,
        reason: getNonNCReason(event.title, event.location),
      });
    }
  }

  console.log(`Found ${nonNCEvents.length} non-NC events to delete:\n`);

  // Show what we're deleting
  for (const event of nonNCEvents.slice(0, 10)) {
    console.log(`  - ${event.title.substring(0, 60)}...`);
    console.log(`    Location: ${event.location || "N/A"}`);
    console.log(`    Reason: ${event.reason}\n`);
  }

  if (nonNCEvents.length > 10) {
    console.log(`  ... and ${nonNCEvents.length - 10} more\n`);
  }

  if (nonNCEvents.length === 0) {
    console.log("No non-NC events to delete.");
    return;
  }

  // Delete in batches
  const ids = nonNCEvents.map((e) => e.id);
  const batchSize = 50;

  console.log(`Deleting ${ids.length} events in batches of ${batchSize}...`);

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    await db.delete(events).where(inArray(events.id, batch));
    console.log(`  Deleted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ids.length / batchSize)}`);
  }

  console.log(`\nSuccessfully deleted ${nonNCEvents.length} non-NC events.`);

  // Verify
  const remainingCount = await db.select().from(events);
  console.log(`Events remaining in database: ${remainingCount.length}`);
}

deleteNonNCEvents()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
