/**
 * North Carolina Stage Company scraper.
 *
 * Their ThunderTix box office sits behind Cloudflare, which 403s the shared
 * `fetchEventData` helper regardless of headers, so every request here goes
 * through the Chrome-fingerprinted dispatcher in `./fetchAsChrome`.
 */

import { type ScrapedEvent } from './types';
import { debugSave } from './base';
import { HTML_ACCEPT, createChromeDispatcher, fetchAsChrome } from './fetchAsChrome';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import { parseAsEastern } from '@/lib/utils/timezone';

const THUNDERTIX_BASE = 'https://northcarolinastagecompany.thundertix.com';
const NC_STAGE_BASE = 'https://www.ncstage.org';

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

/**
 * Parse ThunderTix date string like "Thursday, December 11, 2025 - 07:30 PM"
 * Returns a Date object in UTC
 */
function parseThunderTixDate(dateStr: string): Date | null {
  // Format: "Thursday, December 11, 2025 - 07:30 PM EST"
  // or: "Thursday, December 11, 2025 - 07:30 PM"
  const match = dateStr.match(/(\w+), (\w+) (\d+), (\d+) - (\d+):(\d+) (AM|PM)/i);

  if (!match) {
    console.warn(`[NC Stage] Could not parse date: ${dateStr}`);
    return null;
  }

  const [, , monthName, day, year, hour, minute, ampm] = match;

  const months: Record<string, number> = {
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
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

  return parseAsEastern(dateOnly, timeOnly);
}

/**
 * Extract event data from ThunderTix events page HTML
 */
function parseEventsPage(html: string): ThunderTixEvent[] {
  const events: ThunderTixEvent[] = [];

  // Match event boxes
  const eventBoxRegex =
    /<div class="panel panel-default event_box">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
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
    const descMatch = eventHtml.match(
      /<div class="[^"]*event_description[^"]*"[^>]*>([\s\S]*?)<\/div>/
    );
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
    const imgMatch = eventHtml.match(
      /src="([^"]+)" width="\d+" height="\d+"[^>]*class="event_image_tag"/
    );
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
        dateStr,
      });
      perfIndex++;
    }
  }

  return performances;
}

/**
 * Resolve ThunderTix event titles to real ncstage.org production URLs.
 *
 * The venue's slugs can't be derived from the box-office title - the site
 * rewrites titles ("Mike Wiley at the YMI - Changing Same" lives at
 * /productions/mike-wiley-presents-changing-same/) and appends -2 suffixes to
 * remounts. So read the real slugs off the productions index and match by
 * title instead of guessing.
 */
interface Production {
  title: string;
  url: string;
}

function parseProductionsPage(html: string): Production[] {
  const productions: Production[] = [];
  const boxRegex = /<div class="production-box[^"]*">([\s\S]*?)<\/div>/g;
  let match;

  while ((match = boxRegex.exec(html)) !== null) {
    const box = match[1];
    const title = box.match(/<h2 class="entry-title">([^<]+)<\/h2>/)?.[1];
    const url = box.match(/href=['"]([^'"]*\/productions\/[a-z0-9-]+\/?)['"]/)?.[1];
    if (title && url) {
      productions.push({ title: decodeHtmlEntities(title.trim()), url });
    }
  }

  return productions;
}

const TITLE_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'at',
  'of',
  'in',
  'on',
  'for',
  'with',
  'to',
  'presents',
  'present',
  'from',
  'by',
  'play',
  'music',
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/&[a-z]+;/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word && !TITLE_STOPWORDS.has(word))
  );
}

/** Jaccard overlap of the two token sets. */
function matchScore(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

const MATCH_THRESHOLD = 0.34;

/**
 * Best-matching production URL for a ThunderTix title, or null when nothing
 * scores high enough - the caller falls back to the ThunderTix event page,
 * which is always live because we just scraped it.
 */
function matchProductionUrl(title: string, productions: Production[]): string | null {
  const tokens = titleTokens(title);
  let best: { url: string; score: number } | null = null;

  for (const production of productions) {
    const score = matchScore(tokens, titleTokens(production.title));
    if (!best || score > best.score) {
      best = { url: production.url, score };
    }
  }

  return best && best.score >= MATCH_THRESHOLD ? best.url : null;
}

export async function scrapeNCStage(): Promise<ScrapedEvent[]> {
  console.log('[NC Stage] Starting scrape...');

  const allEvents: ScrapedEvent[] = [];
  const dispatcher = await createChromeDispatcher();

  try {
    // Step 1: Fetch ThunderTix events page
    console.log('[NC Stage] Fetching ThunderTix events...');
    const eventsHtml = await fetchAsChrome(
      `${THUNDERTIX_BASE}/events`,
      HTML_ACCEPT,
      dispatcher,
      'NC Stage'
    );
    await debugSave('01-thundertix-events.html', eventsHtml);

    const events = parseEventsPage(eventsHtml);
    console.log(`[NC Stage] Found ${events.length} events on ThunderTix`);
    await debugSave('02-parsed-events.json', events);

    // Step 2: Fetch the real production URLs off ncstage.org
    let productions: Production[] = [];
    try {
      const productionsHtml = await fetchAsChrome(
        `${NC_STAGE_BASE}/productions/`,
        HTML_ACCEPT,
        dispatcher,
        'NC Stage'
      );
      await debugSave('02b-productions.html', productionsHtml);
      productions = parseProductionsPage(productionsHtml);
      console.log(`[NC Stage] Found ${productions.length} productions on ncstage.org`);
      if (productions.length === 0) {
        console.warn(
          '[NC Stage] Productions index parsed to 0 entries - markup may have changed. ' +
            'Falling back to ThunderTix URLs.'
        );
      }
    } catch (err) {
      console.warn('[NC Stage] Could not load productions index, using ThunderTix URLs:', err);
    }

    // Step 3: For each event, fetch performances
    for (const event of events) {
      console.log(`[NC Stage] Fetching performances for: ${event.title}`);

      await new Promise((r) => setTimeout(r, 500)); // Rate limiting

      try {
        const perfHtml = await fetchAsChrome(
          `${THUNDERTIX_BASE}/events/${event.id}/performances`,
          HTML_ACCEPT,
          dispatcher,
          'NC Stage'
        );
        await debugSave(`03-performances-${event.id}.html`, perfHtml);

        const performances = parsePerformancesPage(perfHtml, event.id);
        console.log(`[NC Stage] Found ${performances.length} performances for ${event.title}`);

        // Create one ScrapedEvent per performance
        const productionUrl =
          matchProductionUrl(event.title, productions) ?? `${THUNDERTIX_BASE}/events/${event.id}`;

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
            zip: '28801',
            organizer: 'North Carolina Stage Company',
            price: 'Unknown', // Could scrape from event page if needed
            url: `${productionUrl}#${perf.dateTime.toISOString()}`,
            imageUrl: event.imageUrl || undefined,
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
    console.error(
      '[NC Stage] Scrape failed - ThunderTix unreachable after every retry, returning 0 events:',
      err
    );
    return [];
  } finally {
    await dispatcher.close();
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
      lines.push(
        `    Date: ${date.toISOString()} -> ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
      );
      lines.push(`    Issues: ${issues.join(', ')}`);
    }
  }

  lines.push('', '=== FIELD COMPLETENESS ===');
  const withImages = events.filter((e) => e.imageUrl).length;
  const withPrices = events.filter((e) => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter((e) => e.description).length;

  lines.push(
    `  With images: ${withImages}/${events.length} (${Math.round((withImages / events.length) * 100) || 0}%)`
  );
  lines.push(
    `  With prices: ${withPrices}/${events.length} (${Math.round((withPrices / events.length) * 100) || 0}%)`
  );
  lines.push(
    `  With descriptions: ${withDescriptions}/${events.length} (${Math.round((withDescriptions / events.length) * 100) || 0}%)`
  );

  lines.push('', '=== SAMPLE EVENTS ===');
  for (const event of events.slice(0, 5)) {
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC): ${event.startDate.toISOString()}`);
    lines.push(
      `  Date (ET): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
    lines.push(`  Location: ${event.location || 'N/A'}`);
    lines.push(`  Price: ${event.price || 'N/A'}`);
    lines.push(`  URL: ${event.url}`);
    lines.push('');
  }

  return lines.join('\n');
}
