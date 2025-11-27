import "../lib/config/env";

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { inArray } from "drizzle-orm";
import { findDuplicates, getIdsToRemove } from "../lib/utils/deduplication";

async function deduplicateEvents() {
  console.log("Finding duplicate events in database...\n");

  const allEvents = await db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      startDate: events.startDate,
      price: events.price,
      description: events.description,
      createdAt: events.createdAt,
    })
    .from(events);

  console.log(`Total events in database: ${allEvents.length}\n`);

  const duplicateGroups = findDuplicates(allEvents);

  if (duplicateGroups.length === 0) {
    console.log("No duplicates found!");
    return;
  }

  console.log(`Found ${duplicateGroups.length} duplicate groups:\n`);
  console.log("=".repeat(80));

  for (const group of duplicateGroups) {
    console.log("\n📌 KEEPING:");
    console.log(`   Title: ${group.keep.title}`);
    console.log(`   Organizer: ${group.keep.organizer}`);
    console.log(`   Time: ${group.keep.startDate}`);
    console.log(`   Price: ${group.keep.price}`);
    console.log(`   Description length: ${group.keep.description?.length || 0}`);

    console.log("\n🗑️  REMOVING:");
    for (const removed of group.remove) {
      console.log(`   Title: ${removed.title}`);
      console.log(`   Organizer: ${removed.organizer}`);
      console.log(`   Price: ${removed.price}`);
      console.log(`   Description length: ${removed.description?.length || 0}`);
    }
    console.log("-".repeat(80));
  }

  const idsToRemove = getIdsToRemove(duplicateGroups);
  console.log(`\nTotal events to remove: ${idsToRemove.length}`);

  if (idsToRemove.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  // Delete duplicates in batches
  console.log("\nDeleting duplicate events...");
  const batchSize = 50;

  for (let i = 0; i < idsToRemove.length; i += batchSize) {
    const batch = idsToRemove.slice(i, i + batchSize);
    await db.delete(events).where(inArray(events.id, batch));
    console.log(`  Deleted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(idsToRemove.length / batchSize)}`);
  }

  console.log(`\nSuccessfully deleted ${idsToRemove.length} duplicate events.`);

  // Verify
  const remainingCount = await db.select().from(events);
  console.log(`Events remaining in database: ${remainingCount.length}`);
}

deduplicateEvents()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
