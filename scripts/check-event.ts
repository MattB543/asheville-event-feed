import "../lib/config/env";

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { eq } from "drizzle-orm";

async function checkEvent(idOrUrl: string) {
  console.log(`\nLooking up event: ${idOrUrl}\n`);

  let event;

  // Check if it's a UUID or URL
  if (idOrUrl.includes("http") || idOrUrl.includes("eventbrite")) {
    const results = await db
      .select()
      .from(events)
      .where(eq(events.url, idOrUrl));
    event = results[0];
  } else {
    const results = await db
      .select()
      .from(events)
      .where(eq(events.id, idOrUrl));
    event = results[0];
  }

  if (!event) {
    console.log("Event not found!");
    return null;
  }

  console.log("=".repeat(80));
  console.log("EVENT DETAILS:");
  console.log("=".repeat(80));
  console.log(`ID:          ${event.id}`);
  console.log(`Source ID:   ${event.sourceId}`);
  console.log(`Source:      ${event.source}`);
  console.log(`Title:       ${event.title}`);
  console.log(`Organizer:   ${event.organizer}`);
  console.log(`Location:    ${event.location}`);
  console.log(`Price:       ${event.price}`);
  console.log(`URL:         ${event.url}`);
  console.log(`Start Date:  ${event.startDate}`);
  console.log(`Tags:        ${event.tags?.join(", ") || "none"}`);
  console.log(`Created:     ${event.createdAt}`);
  console.log("-".repeat(80));
  console.log(`Description: ${event.description?.substring(0, 500) || "none"}...`);
  console.log("-".repeat(80));
  console.log(`Image URL:   ${event.imageUrl || "none"}`);
  console.log("=".repeat(80));

  return event;
}

// Get event ID from command line
const eventId = process.argv[2];

if (!eventId) {
  console.log("Usage: npx tsx scripts/check-event.ts <event-id-or-url>");
  process.exit(1);
}

checkEvent(eventId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
