/**
 * Static Age NC Scraper - Next.js Embedded Data
 *
 * Scrapes events from Static Age NC website using embedded __NEXT_DATA__ JSON.
 * Static Age is a record store and music venue in West Asheville.
 *
 * Venues:
 *   - Static Age Records: 713 Haywood Rd, Asheville, NC 28806
 *   - Static Age Loft: 713 Haywood Rd, Asheville, NC 28806 (upstairs)
 *
 * Data Source:
 *   - Events embedded in Next.js __NEXT_DATA__ script tag
 *   - Backend CMS: Sanity
 *   - Ticketing: Dice.fm
 *
 * Debug Mode:
 *   Set DEBUG_DIR env var to save raw data and validation reports
 */

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '../utils/retry';
import { decodeHtmlEntities } from '../utils/htmlEntities';

// Config
const EVENTS_URL = 'https://www.staticagenc.com/events';
const BASE_URL = 'https://www.staticagenc.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const VENUE_ADDRESS = '713 Haywood Rd, Asheville, NC';
const VENUE_ZIP = '28806';

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

async function debugSave(filename: string, data: unknown): Promise<void> {
  const debugDir = process.env.DEBUG_DIR;
  if (!debugDir) return;

  try {
    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const filepath = path.join(debugDir, filename);
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filepath, content);
    console.log(`[DEBUG] Saved: ${filepath}`);
  } catch (err) {
    console.warn(`[DEBUG] Failed to save ${filename}:`, err);
  }
}

function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    'VALIDATION REPORT - Static Age NC',
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
  ];

  // Date validation
  lines.push('='.repeat(60));
  lines.push('DATE VALIDATION');
  lines.push('='.repeat(60));

  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  let dateIssues = 0;

  for (const event of events) {
    const date = event.startDate;
    const issues: string[] = [];

    if (isNaN(date.getTime())) {
      issues.push('INVALID DATE');
    } else if (date < now) {
      issues.push('IN PAST');
    } else if (date > oneYearFromNow) {
      issues.push('TOO FAR FUTURE');
    }

    const etDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (etDate.getHours() === 0 && etDate.getMinutes() === 0) {
      issues.push('MIDNIGHT (missing time?)');
    }

    if (issues.length > 0) {
      dateIssues++;
      lines.push('');
      lines.push(`  "${event.title.slice(0, 50)}"`);
      lines.push(`    UTC:     ${date.toISOString()}`);
      lines.push(`    Eastern: ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
      lines.push(`    Issues:  ${issues.join(', ')}`);
    }
  }

  if (dateIssues === 0) {
    lines.push('  All dates valid');
  } else {
    lines.push('');
    lines.push(`  ${dateIssues} events have date issues`);
  }

  // Field completeness
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('FIELD COMPLETENESS');
  lines.push('='.repeat(60));

  const total = events.length;
  const withImages = events.filter(e => e.imageUrl).length;
  const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter(e => e.description).length;

  const pct = (n: number) => total === 0 ? '0' : Math.round((n / total) * 100).toString();

  lines.push(`  Images:       ${withImages}/${total} (${pct(withImages)}%)`);
  lines.push(`  Prices:       ${withPrices}/${total} (${pct(withPrices)}%)`);
  lines.push(`  Descriptions: ${withDescriptions}/${total} (${pct(withDescriptions)}%)`);

  // Price distribution
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('PRICE DISTRIBUTION');
  lines.push('='.repeat(60));

  const priceCounts: Record<string, number> = {};
  for (const event of events) {
    const price = event.price || 'Unknown';
    priceCounts[price] = (priceCounts[price] || 0) + 1;
  }

  const sortedPrices = Object.entries(priceCounts).sort((a, b) => b[1] - a[1]);
  for (const [price, count] of sortedPrices.slice(0, 10)) {
    lines.push(`  ${count.toString().padStart(4)} - ${price}`);
  }

  // Sample events
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('SAMPLE EVENTS (first 5)');
  lines.push('='.repeat(60));

  for (const event of events.slice(0, 5)) {
    lines.push('');
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC):     ${event.startDate.toISOString()}`);
    lines.push(`  Date (Eastern): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    lines.push(`  Location:  ${event.location || 'N/A'}`);
    lines.push(`  Price:     ${event.price || 'N/A'}`);
    lines.push(`  URL:       ${event.url}`);
    if (event.imageUrl) {
      lines.push(`  Image:     ${event.imageUrl.substring(0, 60)}...`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SanityImage {
  __typename?: string;
  asset?: {
    url?: string;
    metadata?: {
      dimensions?: {
        width: number;
        height: number;
        aspectRatio: number;
      };
    };
  };
}

interface SanityBand {
  __typename?: string;
  _id?: string;
  name?: string;
  photo?: SanityImage;
}

interface SanityVenue {
  __typename?: string;
  _id?: string;
  name?: string;
}

interface SanityTextBlock {
  _type?: string;
  _key?: string;
  children?: Array<{
    _type?: string;
    text?: string;
  }>;
}

interface StaticAgeEvent {
  __typename?: string;
  _id: string;
  isDev?: boolean | null;
  slug?: { current: string };
  title: string;
  useTitleInCalendar?: boolean;
  isFeatured?: boolean;
  isJustAnnounced?: boolean;
  date: string; // ISO-8601 UTC
  showTime?: string; // "8:45 PM"
  venue?: SanityVenue;
  presale?: boolean;
  presaleLink?: string;
  price?: number | null;
  dayOfPrice?: number | null;
  description?: SanityTextBlock[];
  headerImage?: SanityImage;
  flyer?: SanityImage;
  headliner?: string;
  bands?: SanityBand[];
  isReoccurring?: boolean;
}

interface NextDataPageProps {
  events?: StaticAgeEvent[];
}

interface NextData {
  props?: {
    pageProps?: NextDataPageProps;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract text from Sanity block content
 */
function extractDescriptionText(blocks?: SanityTextBlock[]): string | undefined {
  if (!blocks || !Array.isArray(blocks)) return undefined;

  const textParts: string[] = [];
  for (const block of blocks) {
    if (block.children && Array.isArray(block.children)) {
      for (const child of block.children) {
        if (child.text) {
          textParts.push(child.text);
        }
      }
    }
  }

  const text = textParts.join(' ').trim();
  return text.length > 0 ? decodeHtmlEntities(text) : undefined;
}

/**
 * Get best image URL from event
 */
function getImageUrl(event: StaticAgeEvent): string | undefined {
  // Prefer headerImage, then flyer
  const image = event.headerImage || event.flyer;
  if (image?.asset?.url) {
    return image.asset.url;
  }

  // Try first band photo as fallback
  if (event.bands && event.bands.length > 0) {
    for (const band of event.bands) {
      if (band.photo?.asset?.url) {
        return band.photo.asset.url;
      }
    }
  }

  return undefined;
}

/**
 * Format price from API values
 */
function formatPrice(price?: number | null, dayOfPrice?: number | null): string {
  // Handle free events (explicit 0 or both undefined/null)
  if (price === 0 || dayOfPrice === 0) {
    return 'Free';
  }

  // If both undefined/null, assume free (common for recurring events)
  if ((price === undefined || price === null) && (dayOfPrice === undefined || dayOfPrice === null)) {
    return 'Free';
  }

  // If both advance and door price
  if (price != null && dayOfPrice != null && price !== dayOfPrice) {
    return `$${price} - $${dayOfPrice}`;
  }

  // Just advance price
  if (price != null) {
    return `$${price}`;
  }

  // Just door price
  if (dayOfPrice != null) {
    return `$${dayOfPrice}`;
  }

  return 'Free';
}

/**
 * Build full location string
 */
function buildLocation(venue?: SanityVenue): string {
  if (venue?.name) {
    return `${venue.name}, ${VENUE_ADDRESS}`;
  }
  return `Static Age, ${VENUE_ADDRESS}`;
}

/**
 * Format event as ScrapedEvent
 */
function formatEvent(event: StaticAgeEvent): ScrapedEvent | null {
  // Skip dev events
  if (event.isDev) {
    return null;
  }

  // Parse date (already in UTC ISO-8601 format)
  const startDate = new Date(event.date);
  if (isNaN(startDate.getTime())) {
    console.warn(`[StaticAge] Invalid date for: ${event.title}`);
    return null;
  }

  // Skip past events
  if (startDate < new Date()) {
    return null;
  }

  // Build event URL
  const slug = event.slug?.current || event._id;
  const url = `${BASE_URL}/events/${slug}`;

  // Build title - include bands if no main title or useTitleInCalendar is false
  let title = decodeHtmlEntities(event.title);

  // If we have bands, could add them to description
  const bandNames = event.bands?.map(b => b.name).filter(Boolean) || [];

  // Build description - include bands list if available
  let description = extractDescriptionText(event.description);
  if (bandNames.length > 0 && !title.includes(bandNames[0] || '')) {
    const bandList = `Featuring: ${bandNames.join(', ')}`;
    description = description ? `${bandList}. ${description}` : bandList;
  }

  return {
    sourceId: `static-${event._id}`,
    source: 'STATIC_AGE',
    title,
    description,
    startDate,
    location: buildLocation(event.venue),
    zip: VENUE_ZIP,
    organizer: event.venue?.name || 'Static Age',
    price: formatPrice(event.price, event.dayOfPrice),
    url,
    imageUrl: getImageUrl(event),
    recurringType: event.isReoccurring ? 'daily' : undefined,
  };
}

// ============================================================================
// MAIN SCRAPER FUNCTION
// ============================================================================

/**
 * Scrape events from Static Age NC
 */
export async function scrapeStaticAge(): Promise<ScrapedEvent[]> {
  console.log('[StaticAge] Starting scrape...');

  try {
    // Fetch the events page
    const response = await fetchWithRetry(
      EVENTS_URL,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      },
      { maxRetries: 3, baseDelay: 1000 }
    );

    const html = await response.text();

    // Extract __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      console.error('[StaticAge] Could not find __NEXT_DATA__ script tag');
      return [];
    }

    let nextData: NextData;
    try {
      nextData = JSON.parse(nextDataMatch[1]);
    } catch (parseError) {
      console.error('[StaticAge] Failed to parse __NEXT_DATA__:', parseError);
      return [];
    }

    await debugSave('01-raw-next-data.json', nextData);

    // Extract events from page props
    const rawEvents = nextData.props?.pageProps?.events || [];
    console.log(`[StaticAge] Found ${rawEvents.length} events in page data`);

    await debugSave('02-raw-events.json', rawEvents);

    // Format events
    const events: ScrapedEvent[] = [];
    let skipped = 0;

    for (const rawEvent of rawEvents) {
      const formatted = formatEvent(rawEvent);
      if (formatted) {
        events.push(formatted);
      } else {
        skipped++;
      }
    }

    // Sort by date
    events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    await debugSave('03-formatted-events.json', events);

    // Generate validation report
    const report = generateValidationReport(events);
    await debugSave('04-validation-report.txt', report);

    console.log(`[StaticAge] Returning ${events.length} events (${skipped} skipped)`);

    return events;
  } catch (error) {
    console.error('[StaticAge] Scrape failed:', error);
    return [];
  }
}

// Export for testing
export { formatEvent, formatPrice, buildLocation, extractDescriptionText };
