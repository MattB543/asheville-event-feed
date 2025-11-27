import { AvlTodayResponse } from '../lib/scrapers/types';

/**
 * Verification script to test API responses from AVL Today and Eventbrite
 * This script fetches raw data and displays it for debugging purposes
 *
 * Usage: npx tsx scripts/verify-data.ts
 */

// --- AVL TODAY VERIFICATION ---
async function verifyAvlToday() {
  console.log('\n--- VERIFYING AVL TODAY ---');
  const API_URL = "https://portal.cityspark.com/v1/events/AVLT";
  const startDate = new Date();
  const startStr = startDate.toISOString().split("T")[0] + "T00:00";

  const payload = {
    ppid: 9219,
    start: startStr,
    end: null,
    skip: 0,
    sort: "Time",
    defFilter: "all",
    labels: [],
    pick: false,
    tps: null,
    sparks: false,
    distance: 10,
    lat: 35.5950581,
    lng: -82.5514869,
    search: "",
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = (await response.json()) as AvlTodayResponse;

    if (data.Value && data.Value.length > 0) {
      console.log(`Found ${data.Value.length} events.`);

      // Pick a random event to display
      const randomIndex = Math.floor(Math.random() * Math.min(data.Value.length, 10));
      const rawEvent = data.Value[randomIndex];

      console.log('\nRAW AVL EVENT (Sample):');
      console.log(JSON.stringify(rawEvent, null, 2));
    } else {
      console.log('No AVL events found to verify.');
    }
  } catch (error) {
    console.error('AVL Verification Error:', error);
  }
}

// --- EVENTBRITE VERIFICATION ---
async function verifyEventbrite() {
  console.log('\n--- VERIFYING EVENTBRITE ---');
  const BROWSE_URL = "https://www.eventbrite.com/d/nc--asheville/all-events/";
  const API_BASE = "https://www.eventbrite.com/api/v3/destination/events/";

  try {
    const browseResponse = await fetch(BROWSE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!browseResponse.ok) throw new Error(`Browse page error: ${browseResponse.status}`);
    const html = await browseResponse.text();

    const eventIdMatches = html.matchAll(
      /https:\/\/www\.eventbrite\.com\/e\/[^"]*-tickets-(\d+)/g
    );
    const eventIds = [...new Set([...eventIdMatches].map((m) => m[1]))];

    if (eventIds.length > 0) {
      console.log(`Found ${eventIds.length} event IDs on browse page.`);

      // Pick a random ID to fetch details
      const randomIndex = Math.floor(Math.random() * Math.min(eventIds.length, 5));
      const randomId = eventIds[randomIndex];

      const apiUrl = `${API_BASE}?event_ids=${randomId}&expand=image,primary_venue,ticket_availability,primary_organizer`;
      const apiResponse = await fetch(apiUrl);
      const data = await apiResponse.json();

      if (data.events && data.events.length > 0) {
        const rawEvent = data.events[0];
        console.log('\nRAW EVENTBRITE EVENT (Sample):');
        console.log(JSON.stringify(rawEvent, null, 2));
      }
    } else {
      console.log('No Eventbrite IDs found.');
    }
  } catch (error) {
    console.error('Eventbrite Verification Error:', error);
  }
}

async function main() {
  await verifyAvlToday();
  await verifyEventbrite();
}

main();
