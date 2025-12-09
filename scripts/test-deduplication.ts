/**
 * Dry-run test script for deduplication logic.
 * Analyzes the database and shows what would be removed without deleting anything.
 *
 * Usage: npx tsx scripts/test-deduplication.ts
 */

import "../lib/config/env";

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { analyzeDuplicates, DuplicateGroup } from "../lib/utils/deduplication";
import { getVenueForEvent } from "../lib/utils/venues";

async function testDeduplication() {
  console.log("=".repeat(80));
  console.log("DEDUPLICATION DRY RUN - No changes will be made");
  console.log("=".repeat(80));
  console.log();

  // Fetch all events with location
  const allEvents = await db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      location: events.location,
      startDate: events.startDate,
      price: events.price,
      description: events.description,
      createdAt: events.createdAt,
      source: events.source,
    })
    .from(events);

  console.log(`Total events in database: ${allEvents.length}\n`);

  // Analyze duplicates
  const { groups, summary } = analyzeDuplicates(allEvents);

  console.log("SUMMARY");
  console.log("-".repeat(40));
  console.log(`Total events:       ${summary.totalEvents}`);
  console.log(`Duplicate groups:   ${summary.duplicateGroups}`);
  console.log(`Events to remove:   ${summary.eventsToRemove}`);
  console.log(`Events remaining:   ${summary.totalEvents - summary.eventsToRemove}`);
  console.log();
  console.log("By detection method:");
  for (const [method, count] of Object.entries(summary.byMethod)) {
    const methodDesc = getMethodDescription(method);
    console.log(`  Method ${method}: ${count} groups - ${methodDesc}`);
  }
  console.log();

  if (groups.length === 0) {
    console.log("No duplicates found!");
    return;
  }

  // Show details for each group
  console.log("=".repeat(80));
  console.log("DUPLICATE GROUPS (sorted by method)");
  console.log("=".repeat(80));

  // Sort by method for easier review
  const sortedGroups = [...groups].sort((a, b) => a.method.localeCompare(b.method));

  for (let i = 0; i < sortedGroups.length; i++) {
    const group = sortedGroups[i];
    console.log(`\n--- Group ${i + 1}/${sortedGroups.length} [Method ${group.method}] ---`);
    printGroup(group, allEvents);
  }

  // Show cross-source duplicates (most interesting)
  console.log("\n");
  console.log("=".repeat(80));
  console.log("CROSS-SOURCE DUPLICATES (Methods D & E)");
  console.log("=".repeat(80));

  const crossSourceGroups = groups.filter(g => g.method.includes('D') || g.method.includes('E'));
  if (crossSourceGroups.length === 0) {
    console.log("\nNo cross-source duplicates found.");
  } else {
    console.log(`\nFound ${crossSourceGroups.length} cross-source duplicate groups:\n`);
    for (const group of crossSourceGroups) {
      printGroup(group, allEvents);
      console.log();
    }
  }
}

function getMethodDescription(method: string): string {
  const descriptions: Record<string, string> = {
    'A': 'Same organizer + same time + 2+ title words',
    'B': 'Exact title + same time + similar descriptions',
    'C': 'Same time + consecutive title words',
    'D': 'Same venue + same date + 2+ title words (cross-source)',
    'E': 'Known venue + same date + any title overlap (cross-source)',
  };
  return descriptions[method] || 'Unknown method';
}

function printGroup(group: DuplicateGroup, allEvents: Array<{ id: string; source: string }>) {
  const getSource = (id: string) => allEvents.find(e => e.id === id)?.source || 'UNKNOWN';

  // Get venue info
  const keepVenue = getVenueForEvent(group.keep.organizer, group.keep.location);

  console.log(`\n  KEEPING [${getSource(group.keep.id)}]:`);
  console.log(`    Title:     ${group.keep.title}`);
  console.log(`    Organizer: ${group.keep.organizer || 'N/A'}`);
  console.log(`    Location:  ${group.keep.location || 'N/A'}`);
  console.log(`    Venue:     ${keepVenue || '(not detected)'}`);
  console.log(`    Time:      ${group.keep.startDate.toISOString()}`);
  console.log(`    Price:     ${group.keep.price || 'N/A'}`);
  console.log(`    Desc:      ${group.keep.description?.length || 0} chars`);

  for (const removed of group.remove) {
    const removeVenue = getVenueForEvent(removed.organizer, removed.location);
    console.log(`\n  REMOVING [${getSource(removed.id)}]:`);
    console.log(`    Title:     ${removed.title}`);
    console.log(`    Organizer: ${removed.organizer || 'N/A'}`);
    console.log(`    Location:  ${removed.location || 'N/A'}`);
    console.log(`    Venue:     ${removeVenue || '(not detected)'}`);
    console.log(`    Price:     ${removed.price || 'N/A'}`);
    console.log(`    Desc:      ${removed.description?.length || 0} chars`);
  }
}

testDeduplication()
  .then(() => {
    console.log("\n" + "=".repeat(80));
    console.log("DRY RUN COMPLETE - No changes were made");
    console.log("=".repeat(80));
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
