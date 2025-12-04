import { ScrapedEvent, EventbriteApiEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { isNonNCEvent } from '@/lib/utils/locationFilter';
import { formatPrice } from '@/lib/utils/formatPrice';

// Common headers to avoid blocking
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.eventbrite.com/d/nc--asheville/all-events/",
};

export async function scrapeEventbrite(maxPages: number = 30): Promise<ScrapedEvent[]> {
  const BROWSE_URL = "https://www.eventbrite.com/d/nc--asheville/all-events/";
  const API_BASE = "https://www.eventbrite.com/api/v3/destination/events/";

  // Rate limiting config - conservative to avoid blocks
  const PAGE_DELAY_MS = 2000;      // 2 seconds between browse pages
  const BATCH_DELAY_MS = 1500;     // 1.5 seconds between API batches
  const BATCH_SIZE = 15;           // Smaller batches = gentler on API

  console.log(`[Eventbrite Scraper] Starting fetch (max ${maxPages} pages, ~${PAGE_DELAY_MS}ms between pages)...`);

  // Step 1: Scrape browse page to get event IDs
  const eventIds: Set<string> = new Set();
  const MAX_PAGES = maxPages;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const pageUrl = `${BROWSE_URL}?page=${page}`;
      console.log(`[Eventbrite Scraper] Fetching browse page ${page}/${MAX_PAGES}: ${pageUrl}`);

      let browseResponse: Response;
      try {
        browseResponse = await fetchWithRetry(
          pageUrl,
          {
            headers: BROWSER_HEADERS,
          },
          { maxRetries: 2, baseDelay: 1000 }
        );
      } catch (err) {
        console.error(`[Eventbrite Scraper] Browse page ${page} failed after retries:`, err);
        // On error, wait longer before continuing
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      const html = await browseResponse.text();

      // Extract event IDs from URLs in the page
      const eventIdMatches = html.matchAll(
        /https:\/\/www\.eventbrite\.com\/e\/[^"]*-tickets-(\d+)/g
      );

      let count = 0;
      let firstId = "";
      for (const match of eventIdMatches) {
        if (count === 0) firstId = match[1];
        eventIds.add(match[1]);
        count++;
      }

      console.log(`[Eventbrite Scraper] Page ${page}: Found ${count} IDs. First ID: ${firstId}. Total unique: ${eventIds.size}`);

      // Polite delay between pages - longer to avoid rate limits
      if (page < MAX_PAGES) {
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      }

    } catch (error) {
      console.error(`[Eventbrite Scraper] Error scraping page ${page}:`, error);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const uniqueEventIds = Array.from(eventIds);

  if (uniqueEventIds.length === 0) {
    console.log("[Eventbrite Scraper] No event IDs found, stopping.");
    return [];
  }

  console.log(`[Eventbrite Scraper] Fetching details for ${uniqueEventIds.length} events in batches of ${BATCH_SIZE}...`);

  // Step 2: Fetch event details via API (smaller batches, longer delays)
  const allEvents: ScrapedEvent[] = [];
  const totalBatches = Math.ceil(uniqueEventIds.length / BATCH_SIZE);

  for (let i = 0; i < uniqueEventIds.length; i += BATCH_SIZE) {
    const batch = uniqueEventIds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[Eventbrite Scraper] Fetching batch ${batchNum}/${totalBatches} (${batch.length} IDs)`);
    const apiUrl = `${API_BASE}?event_ids=${batch.join(",")}&page_size=${BATCH_SIZE}&expand=image,primary_venue,ticket_availability,primary_organizer`;

    try {
      const apiResponse = await fetchWithRetry(
        apiUrl,
        {
          headers: API_HEADERS,
        },
        { maxRetries: 2, baseDelay: 1000 }
      );

      const data = await apiResponse.json();

      if (data.events && Array.isArray(data.events)) {
        console.log(`[Eventbrite Scraper] Batch ${batchNum} received ${data.events.length} events`);
        const formatted = data.events.map((ev: EventbriteApiEvent) => formatEventbriteEvent(ev));
        allEvents.push(...formatted);
      } else {
        console.log(`[Eventbrite Scraper] Batch ${batchNum} received no events or invalid format.`);
      }

      // Polite delay between batches
      if (i + BATCH_SIZE < uniqueEventIds.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    } catch (error) {
      console.error(`[Eventbrite Scraper] Error fetching batch ${batchNum}:`, error);
      // On error, wait longer before continuing
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // Filter out non-NC events
  const ncEvents = allEvents.filter(ev => !isNonNCEvent(ev.title, ev.location));
  const filteredCount = allEvents.length - ncEvents.length;

  if (filteredCount > 0) {
    console.log(`[Eventbrite Scraper] Filtered out ${filteredCount} non-NC events`);
  }

  console.log(
    `[Eventbrite Scraper] Finished. Found ${ncEvents.length} NC events (${allEvents.length} total, ${filteredCount} filtered).`
  );
  return ncEvents;
}

function formatEventbriteEvent(ev: EventbriteApiEvent): ScrapedEvent {
  // Extract price (rounded to nearest dollar)
  let price = "Unknown";
  if (ev.ticket_availability?.is_free) {
    price = "Free";
  } else if (ev.ticket_availability?.minimum_ticket_price) {
    const minPrice = ev.ticket_availability.minimum_ticket_price;
    // Parse from display string (e.g., "$25.50") or use major_value
    const displayMatch = minPrice.display?.match(/\$?([\d.]+)/);
    const numericValue = displayMatch
      ? parseFloat(displayMatch[1])
      : parseFloat(minPrice.major_value || "0");
    price = formatPrice(numericValue);
  }

  // Extract organizer name (prefer primary_organizer, fallback to venue name)
  const organizerName = ev.primary_organizer?.name || ev.primary_venue?.name || "Unknown";

  // Extract city (for location display)
  const city = ev.primary_venue?.address?.city || "Online";

  // Extract venue name for display (separate from organizer)
  const venueName = ev.primary_venue?.name;

  // Extract image - prefer original quality
  const image = ev.image?.original?.url || ev.image?.url || "";

  // Build event URL
  const url = ev.url || `https://www.eventbrite.com/e/${ev.id}`;

  // Handle different API formats for name and summary
  const title = typeof ev.name === 'string' ? ev.name : ev.name?.text || "Untitled Event";
  const description = typeof ev.summary === 'string' ? ev.summary : ev.summary?.text || "";

  // Combine start_date and start_time into ISO-ish format
  let startDateStr = "";
  if (ev.start && ev.start.local) {
      startDateStr = ev.start.local;
  } else if (ev.start_date && ev.start_time) {
      startDateStr = `${ev.start_date}T${ev.start_time}`;
  } else if (ev.start_date) {
      startDateStr = ev.start_date;
  }

  // Validate date - use current date as fallback to avoid Invalid Date
  const parsedDate = new Date(startDateStr);
  const startDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  if (isNaN(parsedDate.getTime())) {
    console.warn(`[Eventbrite] Invalid date for event "${title}" (ID: ${ev.id}), using current date as fallback`);
  }

  // Use venue name if different from city, otherwise use organizer name
  // This gives us "SPWM @ The Orange Peel" type info when venue is meaningful
  const locationDisplay = venueName && venueName !== city ? `${city} @ ${venueName}` : city;

  return {
    sourceId: ev.id,
    source: 'EVENTBRITE',
    title: title,
    description: description,
    startDate: startDate,
    location: locationDisplay,
    organizer: organizerName,
    price: price,
    url: url,
    imageUrl: image,
  };
}
