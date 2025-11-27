import "../lib/config/env";

import { db } from "../lib/db";
import { events } from "../lib/db/schema";
import { eq } from "drizzle-orm";

const API_BASE = "https://www.eventbrite.com/api/v3/destination/events/";

interface EventbriteApiResponse {
  events: Array<{
    id: string;
    primary_organizer?: { name: string };
    primary_venue?: {
      name: string;
      address?: { city: string };
    };
  }>;
}

async function fixEventbriteOrganizers() {
  console.log("Fetching all Eventbrite events from database...\n");

  const eventbriteEvents = await db
    .select({
      id: events.id,
      sourceId: events.sourceId,
      title: events.title,
      organizer: events.organizer,
      location: events.location,
    })
    .from(events)
    .where(eq(events.source, "EVENTBRITE"));

  console.log(`Found ${eventbriteEvents.length} Eventbrite events\n`);

  // Batch fetch from Eventbrite API
  const batchSize = 20;
  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < eventbriteEvents.length; i += batchSize) {
    const batch = eventbriteEvents.slice(i, i + batchSize);
    const eventIds = batch.map((e) => e.sourceId);

    console.log(`Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(eventbriteEvents.length / batchSize)} (${eventIds.length} events)...`);

    try {
      const apiUrl = `${API_BASE}?event_ids=${eventIds.join(",")}&expand=primary_venue,primary_organizer`;
      const response = await fetch(apiUrl);
      const data = (await response.json()) as EventbriteApiResponse;

      if (!data.events) {
        console.log("  No events in response, skipping batch");
        continue;
      }

      // Create a map for quick lookup
      const apiEventMap = new Map<string, EventbriteApiResponse["events"][0]>();
      for (const ev of data.events) {
        apiEventMap.set(ev.id, ev);
      }

      // Update each event
      for (const dbEvent of batch) {
        const apiEvent = apiEventMap.get(dbEvent.sourceId);
        if (!apiEvent) {
          console.log(`  ${dbEvent.title.substring(0, 40)}... - NOT FOUND in API`);
          skippedCount++;
          continue;
        }

        const newOrganizer = apiEvent.primary_organizer?.name || apiEvent.primary_venue?.name || "Unknown";
        const city = apiEvent.primary_venue?.address?.city || "Online";
        const venueName = apiEvent.primary_venue?.name;
        const newLocation = venueName && venueName !== city ? `${city} @ ${venueName}` : city;

        // Check if update is needed
        if (dbEvent.organizer !== newOrganizer || dbEvent.location !== newLocation) {
          console.log(`  ${dbEvent.title.substring(0, 40)}...`);
          console.log(`    Organizer: "${dbEvent.organizer}" -> "${newOrganizer}"`);
          console.log(`    Location: "${dbEvent.location}" -> "${newLocation}"`);

          await db
            .update(events)
            .set({
              organizer: newOrganizer,
              location: newLocation,
            })
            .where(eq(events.id, dbEvent.id));

          updatedCount++;
        } else {
          skippedCount++;
        }
      }

      // Polite delay between batches
      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      console.error(`  Error fetching batch:`, error);
    }
  }

  console.log(`\nDone! Updated ${updatedCount} events, skipped ${skippedCount} (already correct or not found)`);
}

fixEventbriteOrganizers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
