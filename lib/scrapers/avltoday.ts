import { type ScrapedEvent, type AvlTodayResponse } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { isNonNCEvent } from '@/lib/utils/geo';
import { formatPrice } from '@/lib/utils/parsers';
import { getZipFromCoords, getZipFromCity } from '@/lib/utils/geo';
import { tryExtractPrice } from '@/lib/utils/parsers';

// Common headers to avoid blocking
const API_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://avltoday.6amcity.com',
  Referer: 'https://avltoday.6amcity.com/',
};

export async function scrapeAvlToday(): Promise<ScrapedEvent[]> {
  const API_URL = 'https://portal.cityspark.com/v1/events/AVLT';
  // Get date in Asheville time (America/New_York) to avoid UTC date shift issues
  const startStr =
    new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    }) + 'T00:00';

  const allEvents: ScrapedEvent[] = [];
  let skip = 0;
  let hasMore = true;

  console.log('[AVL Scraper] Starting fetch...');

  while (hasMore) {
    try {
      console.log(`[AVL Scraper] Fetching page with skip=${skip}`);
      const payload = {
        ppid: 9219,
        start: startStr,
        end: null,
        skip: skip,
        sort: 'Time',
        defFilter: 'all',
        labels: [],
        pick: false,
        tps: null,
        sparks: false,
        distance: 10,
        lat: 35.5950581,
        lng: -82.5514869,
        search: '',
      };

      const response = await fetchWithRetry(
        API_URL,
        {
          method: 'POST',
          headers: API_HEADERS,
          body: JSON.stringify(payload),
          cache: 'no-store',
        },
        { maxRetries: 3, baseDelay: 1000 }
      );

      const data = (await response.json()) as AvlTodayResponse;
      console.log(`[AVL Scraper] Page response received. Items: ${data.Value?.length || 0}`);

      if (data.Value && Array.isArray(data.Value) && data.Value.length > 0) {
        const formatted = data.Value.map((ev) => formatAvlEvent(ev));
        allEvents.push(...formatted);
        skip += 25;

        if (skip >= 400) {
          console.log('[AVL Scraper] Reached safety limit of 400 items.');
          hasMore = false;
        }
        if (data.Value.length < 25) {
          console.log('[AVL Scraper] Received fewer than 25 items, assuming end of list.');
          hasMore = false;
        }
      } else {
        console.log('[AVL Scraper] No items in response, stopping.');
        hasMore = false;
      }

      await new Promise((r) => setTimeout(r, 200));
    } catch (error) {
      console.error('[AVL Scraper] Error in loop:', error);
      hasMore = false;
    }
  }

  // Filter out non-NC events
  const ncEvents = allEvents.filter((ev) => !isNonNCEvent(ev.title, ev.location));
  const filteredCount = allEvents.length - ncEvents.length;

  if (filteredCount > 0) {
    console.log(`[AVL Scraper] Filtered out ${filteredCount} non-NC events`);
  }

  console.log(
    `[AVL Scraper] Finished. Found ${ncEvents.length} NC events (${allEvents.length} total, ${filteredCount} filtered).`
  );
  return ncEvents;
}

function formatAvlEvent(ev: AvlTodayResponse['Value'][0]): ScrapedEvent {
  let finalUrl = '';
  if (ev.Links && ev.Links.length > 0) finalUrl = ev.Links[0].url;
  else if (ev.TicketUrl) finalUrl = ev.TicketUrl;
  else finalUrl = `https://avltoday.6amcity.com/events#${ev.Id}`;

  if (ev.Name.includes('Growing in Motion')) {
    console.log(
      `[AVL Scraper Debug] Found "Growing in Motion". Id: ${ev.Id}, PId: ${ev.PId}, Type of PId: ${typeof ev.PId}`
    );
  }

  // Format price (rounded to nearest dollar)
  // If API price is null/undefined, try to extract from description
  let price = formatPrice(ev.Price);
  if (price === 'Unknown') {
    price = tryExtractPrice(ev.Description, 'Unknown', ev.Venue);
  }

  // Generate unique sourceId - prefer PId, fallback to Id, then generate unique fallback
  const sourceId = ev.PId
    ? ev.PId.toString()
    : ev.Id || `avl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Parse the date and check if time is unknown (midnight in local time = date-only from source)
  const rawDate = new Date(ev.StartUTC || ev.DateStart);

  // Check if the time is midnight in Eastern time (indicates date-only)
  // Midnight EST = 05:00 UTC, Midnight EDT = 04:00 UTC
  const hours = rawDate.getUTCHours();
  const minutes = rawDate.getUTCMinutes();
  const isTimeUnknown = (hours === 4 || hours === 5) && minutes === 0;

  // If time is unknown, default to 9 AM Eastern (14:00 or 13:00 UTC)
  let startDate = rawDate;
  if (isTimeUnknown) {
    // Set to 9 AM Eastern - add 9 hours from midnight
    startDate = new Date(rawDate.getTime() + 9 * 60 * 60 * 1000);
  }

  // Build location string with address if available
  let location = ev.CityState || 'Asheville, NC';
  if (ev.Address && ev.Venue) {
    location = `${ev.Venue}, ${ev.Address}, ${ev.CityState || 'Asheville, NC'}`;
  } else if (ev.Venue) {
    location = `${ev.Venue}, ${ev.CityState || 'Asheville, NC'}`;
  }

  // Determine zip code with fallbacks
  let zip = ev.Zip || undefined;
  if (!zip) {
    // Try to get zip from coordinates
    zip = getZipFromCoords(ev.latitude, ev.longitude);
  }
  if (!zip) {
    // Try to get zip from city name (extract city from CityState like "Asheville, NC")
    const cityMatch = ev.CityState?.match(/^([^,]+)/);
    if (cityMatch) {
      zip = getZipFromCity(cityMatch[1]);
    }
  }
  if (!zip) {
    // City of Asheville government events default to downtown (28801)
    if (finalUrl.includes('ashevillenc.gov/event/')) {
      zip = '28801';
    }
    // Thrifty Thursday at Asheville Area Habitat ReStore (West Asheville)
    else if (ev.Name === 'Thrifty Thursday') {
      zip = '28806';
    }
  }

  // Use City Hall image for ashevillenc.gov events, otherwise use API image
  const isGovEvent = finalUrl.includes('ashevillenc.gov/event/');
  const imageUrl = isGovEvent ? '/City-Hall-spring-min.jpg' : ev.LargeImg || ev.MediumImg || '';

  return {
    sourceId,
    source: 'AVL_TODAY',
    title: ev.Name,
    description: ev.Description,
    startDate,
    location,
    zip,
    organizer: ev.Venue || 'AVL Today',
    price: price,
    url: finalUrl,
    imageUrl,
    timeUnknown: isTimeUnknown,
  };
}
