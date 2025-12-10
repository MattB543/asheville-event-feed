import { ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';

const THUNDERTIX_BASE = 'https://northcarolinastagecompany.thundertix.com';
const NC_STAGE_BASE = 'https://www.ncstage.org';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface ThunderTixEvent {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  dateRange: string;
}

interface Performance {
  id: string;
  dateTime: Date;
  dateStr: string;
}

// Debug helper - only works when DEBUG_DIR is set (local testing only)
async function debugSave(filename: string, data: unknown): Promise<void> {
  const debugDir = process.env.DEBUG_DIR;
  if (!debugDir) return;

  // Dynamic import to avoid bundling fs/path in serverless
  const fs = await import('fs');
  const path = await import('path');

  const filepath = path.join(debugDir, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content);
  console.log(`[DEBUG] Saved: ${filepath}`);
}

/**
 * Parse ThunderTix date string like "Thursday, December 11, 2025 - 07:30 PM"
 * Returns a Date object in UTC
 */
function parseThunderTixDate(dateStr: string): Date | null {
  // Format: "Thursday, December 11, 2025 - 07:30 PM EST"
  // or: "Thursday, December 11, 2025 - 07:30 PM"
  const match = dateStr.match(
    /(\w+), (\w+) (\d+), (\d+) - (\d+):(\d+) (AM|PM)/i
  );

  if (!match) {
    console.warn(`[NC Stage] Could not parse date: ${dateStr}`);
    return null;
  }

  const [, , monthName, day, year, hour, minute, ampm] = match;

  const months: Record<string, number> = {
    January: 0, February: 1, March: 2, April: 3,
    May: 4, June: 5, July: 6, August: 7,
    September: 8, October: 9, November: 10, December: 11
  };

  const month = months[monthName];
  if (month === undefined) {
    console.warn(`[NC Stage] Unknown month: ${monthName}`);
    return null;
  }

  let hours = parseInt(hour);
  if (ampm.toUpperCase() === 'PM' && hours !== 12) {
    hours += 12;
  } else if (ampm.toUpperCase() === 'AM' && hours === 12) {
    hours = 0;
  }

  // Create date string in YYYY-MM-DD format
  const dateOnly = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeOnly = `${String(hours).padStart(2, '0')}:${minute}:00`;

  // Determine Eastern offset for this date (handles DST)
  const testDate = new Date(`${dateOnly}T12:00:00`);
  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset'
  }).formatToParts(testDate).find(p => p.type === 'timeZoneName')?.value;

  const offset = offsetPart?.includes('-4') ? '-04:00' : '-05:00';

  return new Date(`${dateOnly}T${timeOnly}${offset}`);
}

/**
 * Extract event data from ThunderTix events page HTML
 */
function parseEventsPage(html: string): ThunderTixEvent[] {
  const events: ThunderTixEvent[] = [];

  // Match event boxes
  const eventBoxRegex = /<div class="panel panel-default event_box">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let match;

  while ((match = eventBoxRegex.exec(html)) !== null) {
    const eventHtml = match[1];

    // Extract event ID from href
    const idMatch = eventHtml.match(/href="\/events\/(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];

    // Extract title
    const titleMatch = eventHtml.match(/<h1>([^<]+)<\/h1>/);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : '';

    // Extract description
    const descMatch = eventHtml.match(/<div class="[^"]*event_description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    let description = '';
    if (descMatch) {
      description = descMatch[1]
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      description = decodeHtmlEntities(description);
    }

    // Extract image URL
    const imgMatch = eventHtml.match(/src="([^"]+)" width="\d+" height="\d+"[^>]*class="event_image_tag"/);
    const imageUrl = imgMatch ? imgMatch[1] : '';

    // Extract date range
    const dateMatch = eventHtml.match(/<div class="event_date">\s*([^<]+)\s*<\/div>/);
    const dateRange = dateMatch ? dateMatch[1].trim() : '';

    if (id && title) {
      events.push({ id, title, description, imageUrl, dateRange });
    }
  }

  return events;
}

/**
 * Extract performance dates from ThunderTix performances page HTML
 */
function parsePerformancesPage(html: string, eventId: string): Performance[] {
  const performances: Performance[] = [];

  // Match performance date strings like "Thursday, December 11, 2025 - 07:30 PM EST"
  const dateRegex = /(\w+, \w+ \d+, \d+ - \d+:\d+ [AP]M)/gi;
  const matches = html.matchAll(dateRegex);

  let perfIndex = 0;
  for (const match of matches) {
    const dateStr = match[1];
    const dateTime = parseThunderTixDate(dateStr);

    if (dateTime) {
      performances.push({
        id: `${eventId}-${perfIndex}`,
        dateTime,
        dateStr
      });
      perfIndex++;
    }
  }

  return performances;
}

/**
 * Map ThunderTix event title to NC Stage production URL slug
 */
function getProductionUrl(title: string): string {
  // Clean up title for URL matching
  const cleanTitle = title
    .toLowerCase()
    .replace(/^from random act productions:\s*/i, '')
    .replace(/,?\s*a play with music$/i, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();

  // Known mappings (from exploration)
  const mappings: Record<string, string> = {
    'a-christmas-carol': 'art-anvil-entertainment-presents-charles-dickens-a-christmas-carol-a-play-with-music',
    'jeeves-in-bloom': 'jeeves-in-bloom-2',
    'tiny-beautiful-things': 'tiny-beautiful-things',
    'no-child': 'no-child',
  };

  const slug = mappings[cleanTitle] || cleanTitle;
  return `${NC_STAGE_BASE}/productions/${slug}/`;
}

export async function scrapeNCStage(): Promise<ScrapedEvent[]> {
  console.log('[NC Stage] Starting scrape...');

  const allEvents: ScrapedEvent[] = [];

  try {
    // Step 1: Fetch ThunderTix events page
    console.log('[NC Stage] Fetching ThunderTix events...');
    const eventsResponse = await fetchWithRetry(`${THUNDERTIX_BASE}/events`, {
      headers: BROWSER_HEADERS
    });

    if (!eventsResponse.ok) {
      console.error(`[NC Stage] ThunderTix events page returned ${eventsResponse.status}`);
      return [];
    }

    const eventsHtml = await eventsResponse.text();
    await debugSave('01-thundertix-events.html', eventsHtml);

    const events = parseEventsPage(eventsHtml);
    console.log(`[NC Stage] Found ${events.length} events on ThunderTix`);
    await debugSave('02-parsed-events.json', events);

    // Step 2: For each event, fetch performances
    for (const event of events) {
      console.log(`[NC Stage] Fetching performances for: ${event.title}`);

      await new Promise(r => setTimeout(r, 500)); // Rate limiting

      try {
        const perfResponse = await fetchWithRetry(
          `${THUNDERTIX_BASE}/events/${event.id}/performances`,
          { headers: BROWSER_HEADERS }
        );

        if (!perfResponse.ok) {
          console.warn(`[NC Stage] Could not fetch performances for ${event.title}`);
          continue;
        }

        const perfHtml = await perfResponse.text();
        await debugSave(`03-performances-${event.id}.html`, perfHtml);

        const performances = parsePerformancesPage(perfHtml, event.id);
        console.log(`[NC Stage] Found ${performances.length} performances for ${event.title}`);

        // Create one ScrapedEvent per performance
        const productionUrl = getProductionUrl(event.title);

        for (const perf of performances) {
          // Filter out past events
          if (perf.dateTime < new Date()) {
            continue;
          }

          const scrapedEvent: ScrapedEvent = {
            sourceId: `ncstage-${perf.id}`,
            source: 'NC_STAGE',
            title: event.title,
            description: event.description,
            startDate: perf.dateTime,
            location: 'North Carolina Stage Company, 15 Stage Lane, Asheville, NC',
            organizer: 'North Carolina Stage Company',
            price: 'Unknown', // Could scrape from event page if needed
            url: `${productionUrl}#${perf.dateTime.toISOString()}`,
            imageUrl: event.imageUrl || undefined
          };

          allEvents.push(scrapedEvent);
        }
      } catch (err) {
        console.error(`[NC Stage] Error fetching performances for ${event.title}:`, err);
      }
    }

    console.log(`[NC Stage] Total events scraped: ${allEvents.length}`);
    await debugSave('04-final-events.json', allEvents);

    // Generate validation report
    if (process.env.DEBUG_DIR) {
      const report = generateValidationReport(allEvents);
      await debugSave('05-validation-report.txt', report);
    }

    return allEvents;

  } catch (err) {
    console.error('[NC Stage] Scrape failed:', err);
    return [];
  }
}

function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - NC Stage`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    '=== DATE VALIDATION ===',
  ];

  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  for (const event of events) {
    const date = event.startDate;
    const issues: string[] = [];

    if (isNaN(date.getTime())) {
      issues.push('INVALID DATE');
    } else if (date > oneYearFromNow) {
      issues.push('TOO FAR FUTURE');
    }

    const hours = date.getHours();
    const mins = date.getMinutes();
    if (hours === 0 && mins === 0) {
      issues.push('MIDNIGHT (missing time?)');
    }

    if (issues.length > 0) {
      lines.push(`  ${event.title.slice(0, 50)}`);
      lines.push(`    Date: ${date.toISOString()} -> ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
      lines.push(`    Issues: ${issues.join(', ')}`);
    }
  }

  lines.push('', '=== FIELD COMPLETENESS ===');
  const withImages = events.filter(e => e.imageUrl).length;
  const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter(e => e.description).length;

  lines.push(`  With images: ${withImages}/${events.length} (${Math.round(withImages / events.length * 100) || 0}%)`);
  lines.push(`  With prices: ${withPrices}/${events.length} (${Math.round(withPrices / events.length * 100) || 0}%)`);
  lines.push(`  With descriptions: ${withDescriptions}/${events.length} (${Math.round(withDescriptions / events.length * 100) || 0}%)`);

  lines.push('', '=== SAMPLE EVENTS ===');
  for (const event of events.slice(0, 5)) {
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC): ${event.startDate.toISOString()}`);
    lines.push(`  Date (ET): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    lines.push(`  Location: ${event.location || 'N/A'}`);
    lines.push(`  Price: ${event.price || 'N/A'}`);
    lines.push(`  URL: ${event.url}`);
    lines.push('');
  }

  return lines.join('\n');
}
