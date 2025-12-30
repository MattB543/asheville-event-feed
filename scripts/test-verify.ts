/**
 * Test script for event verification.
 * Usage: npx tsx scripts/test-verify.ts [shortId]
 *
 * Example: npx tsx scripts/test-verify.ts 705ffa
 */

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { sql } from "drizzle-orm";
import {
  isVerificationEnabled,
  verifySingleEvent,
  VERIFIABLE_SOURCES,
  type EventForVerification,
} from "../lib/ai/eventVerification";

async function main() {
  const shortId = process.argv[2] || "705ffa";

  console.log("=".repeat(60));
  console.log("Event Verification Test");
  console.log("=".repeat(60));

  // Check if verification is enabled
  console.log("\nChecking configuration...");
  const enabled = isVerificationEnabled();
  console.log(`Verification enabled: ${enabled}`);

  if (!enabled) {
    console.error("ERROR: Verification not enabled. Check JINA_API_KEY and Azure AI config.");
    process.exit(1);
  }

  // Find the event by short ID
  console.log(`\nSearching for event with short ID: ${shortId}`);
  const result = await db
    .select()
    .from(events)
    .where(sql`${events.id}::text LIKE ${shortId + "%"}`)
    .limit(1);

  if (result.length === 0) {
    console.error(`ERROR: No event found with short ID: ${shortId}`);

    // List some events from verifiable sources
    console.log("\nSample events from verifiable sources:");
    const sampleEvents = await db
      .select({
        id: events.id,
        title: events.title,
        source: events.source,
        url: events.url,
      })
      .from(events)
      .where(sql`${events.source} IN ('AVL_TODAY', 'EXPLORE_ASHEVILLE', 'MOUNTAIN_X')`)
      .limit(5);

    for (const e of sampleEvents) {
      console.log(`  ${e.id.slice(0, 6)} - ${e.title.slice(0, 40)}... (${e.source})`);
    }
    process.exit(1);
  }

  const event = result[0];
  console.log("\nEvent found:");
  console.log(`  ID: ${event.id}`);
  console.log(`  Title: ${event.title}`);
  console.log(`  Source: ${event.source}`);
  console.log(`  Date: ${event.startDate.toLocaleString()}`);
  console.log(`  Location: ${event.location || "N/A"}`);
  console.log(`  Price: ${event.price || "Unknown"}`);
  console.log(`  URL: ${event.url}`);
  console.log(`  Last Verified: ${event.lastVerifiedAt || "Never"}`);

  // Check if source is verifiable
  if (!VERIFIABLE_SOURCES.includes(event.source as typeof VERIFIABLE_SOURCES[number])) {
    console.log(`\nWARNING: Source ${event.source} is not in verifiable sources list.`);
    console.log(`Verifiable sources: ${VERIFIABLE_SOURCES.join(", ")}`);
  }

  // Run verification
  console.log("\n" + "=".repeat(60));
  console.log("Running verification...");
  console.log("=".repeat(60));

  const eventForVerification: EventForVerification = {
    id: event.id,
    title: event.title,
    description: event.description,
    startDate: event.startDate,
    location: event.location,
    organizer: event.organizer,
    price: event.price,
    url: event.url,
    source: event.source,
    lastVerifiedAt: event.lastVerifiedAt,
  };

  const verificationResult = await verifySingleEvent(eventForVerification);

  console.log("\n" + "=".repeat(60));
  console.log("Verification Result");
  console.log("=".repeat(60));
  console.log(`Action: ${verificationResult.action}`);
  console.log(`Reason: ${verificationResult.reason}`);
  console.log(`Confidence: ${(verificationResult.confidence * 100).toFixed(1)}%`);

  if (verificationResult.error) {
    console.log(`Error: ${verificationResult.error}`);
  }

  if (verificationResult.updates) {
    console.log("\nUpdates:");
    if (verificationResult.updates.price) {
      console.log(`  Price: ${verificationResult.updates.price}`);
    }
    if (verificationResult.updates.description) {
      console.log(`  Description: ${verificationResult.updates.description.slice(0, 100)}...`);
    }
    if (verificationResult.updates.location) {
      console.log(`  Location: ${verificationResult.updates.location}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
