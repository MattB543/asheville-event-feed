import { ScrapedEvent, EventbriteApiEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { isNonNCEvent } from '@/lib/utils/locationFilter';
import { formatPrice } from '@/lib/utils/formatPrice';

export async function scrapeEventbrite(maxPages: number = 3): Promise<ScrapedEvent[]> {
  const BROWSE_URL = "https://www.eventbrite.com/d/nc--asheville/all-events/";
  const API_BASE = "https://www.eventbrite.com/api/v3/destination/events/";

  console.log(`[Eventbrite Scraper] Starting fetch (max ${maxPages} pages)...`);

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
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          },
          { maxRetries: 2, baseDelay: 500 }
        );
      } catch (err) {
        console.error(`[Eventbrite Scraper] Browse page ${page} failed after retries:`, err);
        continue; // Skip to next page on error
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

      // Polite delay between pages
      await new Promise((r) => setTimeout(r, 500));

    } catch (error) {
      console.error(`[Eventbrite Scraper] Error scraping page ${page}:`, error);
    }
  }

  const uniqueEventIds = Array.from(eventIds);

  if (uniqueEventIds.length === 0) {
    console.log("[Eventbrite Scraper] No event IDs found, stopping.");
    return [];
  }

  // Step 2: Fetch event details via API (batches of 20)
  const allEvents: ScrapedEvent[] = [];
  const batchSize = 20;

  for (let i = 0; i < uniqueEventIds.length; i += batchSize) {
    const batch = uniqueEventIds.slice(i, i + batchSize);
    console.log(`[Eventbrite Scraper] Fetching batch ${i / batchSize + 1} (IDs: ${batch.length})`);
    const apiUrl = `${API_BASE}?event_ids=${batch.join(",")}&page_size=${batchSize}&expand=image,primary_venue,ticket_availability,primary_organizer`;

    try {
      const apiResponse = await fetchWithRetry(
        apiUrl,
        undefined,
        { maxRetries: 2, baseDelay: 500 }
      );

      const data = await apiResponse.json();
      
      if (data.events && Array.isArray(data.events)) {
        console.log(`[Eventbrite Scraper] Batch received ${data.events.length} events`);
        const formatted = data.events.map((ev: EventbriteApiEvent) => formatEventbriteEvent(ev));
        allEvents.push(...formatted);
      } else {
        console.log(`[Eventbrite Scraper] Batch received no events or invalid format.`);
      }

      // Polite delay between batches
      if (i + batchSize < uniqueEventIds.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (error) {
      console.error(
        `[Eventbrite Scraper] Error fetching batch ${i / batchSize + 1}:`,
        error
      );
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
