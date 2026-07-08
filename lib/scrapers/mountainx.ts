/**
 * Mountain Xpress (mountainx.com) Scraper
 *
 * Primary path: Tribe Events Calendar REST API when it is available.
 * Fallback path: month-view HTML in a real browser session. Cloudflare is
 * currently blocking both direct HTTP requests and browser fetches to the
 * REST API, but same-origin HTML fetches for month pages still work after
 * bootstrapping a browser session on the current month view.
 */

import { type ScrapedEvent } from './types';
import { isNonNCEvent, getZipFromCity } from '@/lib/utils/geo';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import { fetchWithRetry } from '@/lib/utils/retry';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import type { Browser } from 'patchright';

const API_BASE = 'https://mountainx.com/wp-json/tribe/events/v1/events';
const MONTH_VIEW_ROOT = 'https://mountainx.com/events/month/';
const PER_PAGE = 50;
const MAX_PAGES = 40;
const MAX_EVENTS = PER_PAGE * MAX_PAGES;
const SCRAPE_WINDOW_DAYS = 56;
const API_DELAY_MS = 200;
const MONTH_DELAY_MS = 400;

const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

const HTML_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const BROWSER_CONTEXT_OPTIONS = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'America/New_York',
} as const;

interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  website?: string;
  geo_lat?: number;
  geo_lng?: number;
}

interface TribeOrganizer {
  organizer?: string;
  website?: string;
  email?: string;
}

interface TribeImage {
  url?: string;
  id?: number;
  extension?: string;
  width?: number;
  height?: number;
  sizes?: {
    medium?: { url: string };
    large?: { url: string };
    full?: { url: string };
  };
}

interface TribeEvent {
  id: number;
  title: string;
  description?: string;
  excerpt?: string;
  url: string;
  utc_start_date: string;
  utc_end_date?: string;
  all_day: boolean;
  cost?: string;
  venue?: TribeVenue;
  organizer?: TribeOrganizer[];
  image?: TribeImage;
}

interface TribeEventsResponse {
  events: TribeEvent[];
  next_rest_url?: string;
  total: number;
  total_pages: number;
}

interface MonthTarget {
  monthKey: string;
  targetUrl: string;
  useCurrentDocument: boolean;
}

interface ScrapeWindow {
  start: Date;
  end: Date;
}

interface SerializedMonthEvent {
  title?: string;
  description?: string;
  imageUrl?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  locationName?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  organizer?: string;
  price?: string;
  priceCurrency?: string;
}

interface MonthFetchResult {
  status: number;
  title: string;
  events: SerializedMonthEvent[];
}

export async function scrapeMountainX(): Promise<ScrapedEvent[]> {
  console.log('[MountainX] Starting scrape...');

  let allEvents: ScrapedEvent[] = [];
  const window = getScrapeWindow();

  try {
    allEvents = await scrapeMountainXViaApi(window);
    console.log(`[MountainX] API path returned ${allEvents.length} events`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[MountainX] API path failed: ${message}`);
    console.warn('[MountainX] Falling back to browser month-view HTML scrape...');
    allEvents = await scrapeMountainXFromMonthViews(window);
  }

  const deduped = dedupeByUrl(allEvents);
  const ncEvents = deduped.filter((event) => !isNonNCEvent(event.title, event.location));
  const filteredCount = deduped.length - ncEvents.length;

  if (deduped.length !== allEvents.length) {
    console.log(`[MountainX] Removed ${allEvents.length - deduped.length} duplicate URLs`);
  }

  if (filteredCount > 0) {
    console.log(`[MountainX] Filtered out ${filteredCount} non-NC events`);
  }

  console.log(`[MountainX] Finished. Found ${ncEvents.length} NC events (${deduped.length} total)`);

  return ncEvents;
}

async function scrapeMountainXViaApi(window: ScrapeWindow): Promise<ScrapedEvent[]> {
  console.log('[MountainX] Trying Tribe REST API...');

  const allEvents: ScrapedEvent[] = [];
  const today = getTodayStringEastern();
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    const url = new URL(API_BASE);
    url.searchParams.set('start_date', today);
    url.searchParams.set('per_page', PER_PAGE.toString());
    url.searchParams.set('page', page.toString());

    console.log(`[MountainX] API page ${page}...`);

    const data = await fetchEventsPageWithHttp(url.toString());
    const events = data.events || [];

    console.log(`[MountainX] API page ${page}: ${events.length} events (total: ${data.total})`);

    for (const event of events) {
      const formatted = formatApiEvent(event, window);
      if (formatted) {
        allEvents.push(formatted);
      }
    }

    hasMore = !!data.next_rest_url && page < data.total_pages;
    page++;

    if (hasMore) {
      await sleep(API_DELAY_MS);
    }
  }

  return allEvents;
}

async function fetchEventsPageWithHttp(url: string): Promise<TribeEventsResponse> {
  const initialResponse = await fetch(url, {
    headers: API_HEADERS,
    cache: 'no-store',
  });

  if (initialResponse.status === 403) {
    throw new Error('HTTP 403: Forbidden');
  }

  if (!initialResponse.ok) {
    const retriedResponse = await fetchWithRetry(
      url,
      { headers: API_HEADERS, cache: 'no-store' },
      { maxRetries: 2, baseDelay: 1000 }
    );
    return (await retriedResponse.json()) as TribeEventsResponse;
  }

  return (await initialResponse.json()) as TribeEventsResponse;
}

async function scrapeMountainXFromMonthViews(window: ScrapeWindow): Promise<ScrapedEvent[]> {
  const browser = await launchBrowser();
  const monthTargets = buildMonthTargets(window);
  const allEvents: ScrapedEvent[] = [];
  const seenUrls = new Set<string>();

  try {
    for (const target of monthTargets) {
      const rawEvents = await fetchMonthEventsWithBrowser(browser, target);
      let addedThisMonth = 0;

      for (const rawEvent of rawEvents) {
        const formatted = formatMonthEvent(rawEvent, window);
        if (!formatted || seenUrls.has(formatted.url)) {
          continue;
        }

        seenUrls.add(formatted.url);
        allEvents.push(formatted);
        addedThisMonth++;
      }

      console.log(
        `[MountainX] Month ${target.monthKey}: ${addedThisMonth} events after formatting/dedup`
      );

      if (allEvents.length >= MAX_EVENTS) {
        console.log(`[MountainX] Reached event cap (${MAX_EVENTS}). Stopping month scan.`);
        break;
      }

      await sleep(MONTH_DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  if (allEvents.length > MAX_EVENTS) {
    console.log(`[MountainX] Capping month-view results at ${MAX_EVENTS} events`);
    return allEvents.slice(0, MAX_EVENTS);
  }

  return allEvents;
}

async function launchBrowser(): Promise<Browser> {
  let chromium;

  try {
    const patchright = await import('patchright');
    chromium = patchright.chromium;
  } catch {
    throw new Error(
      'patchright is not available. Install it as a dev dependency to use MountainX browser fallback.'
    );
  }

  return chromium.launch({ headless: true });
}

function buildMonthTargets(window: ScrapeWindow): MonthTarget[] {
  const startMonth = new Date(
    Date.UTC(window.start.getUTCFullYear(), window.start.getUTCMonth(), 1)
  );
  const endMonth = new Date(Date.UTC(window.end.getUTCFullYear(), window.end.getUTCMonth(), 1));

  const targets: MonthTarget[] = [];
  let current = new Date(startMonth);
  let index = 0;

  while (current <= endMonth) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`;

    targets.push({
      monthKey,
      targetUrl: index === 0 ? MONTH_VIEW_ROOT : `${MONTH_VIEW_ROOT}${monthKey}/`,
      useCurrentDocument: index === 0,
    });

    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
    index++;
  }

  return targets;
}

async function fetchMonthEventsWithBrowser(
  browser: Browser,
  target: MonthTarget
): Promise<SerializedMonthEvent[]> {
  const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
  const page = await context.newPage();

  try {
    const bootstrap = await page.goto(MONTH_VIEW_ROOT, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    if (!bootstrap || !bootstrap.ok()) {
      throw new Error(`Failed to open Mountain X month view (status ${bootstrap?.status() ?? 0})`);
    }

    const result = await page.evaluate(
      async ({ targetUrl, monthKey, useCurrentDocument, acceptHeader }) => {
        let html = document.documentElement.outerHTML;
        let status = 200;

        if (!useCurrentDocument) {
          const response = await fetch(targetUrl, {
            credentials: 'include',
            headers: { Accept: acceptHeader },
          });
          status = response.status;
          html = await response.text();
        }

        const parsedDoc = new DOMParser().parseFromString(html, 'text/html');
        const jsonLdBlocks = Array.from(
          parsedDoc.querySelectorAll('script[type="application/ld+json"]')
        )
          .map((script) => script.textContent || '')
          .filter(Boolean);

        const isPlainObject = (value: unknown): value is Record<string, unknown> =>
          typeof value === 'object' && value !== null;

        const toStringValue = (value: unknown): string =>
          typeof value === 'string' || typeof value === 'number' ? String(value) : '';

        const parsed: Record<string, unknown>[] = [];
        for (const block of jsonLdBlocks) {
          try {
            const json: unknown = JSON.parse(block);
            if (Array.isArray(json)) {
              for (const entry of json) {
                if (isPlainObject(entry)) {
                  parsed.push(entry);
                }
              }
            } else if (isPlainObject(json)) {
              parsed.push(json);
            }
          } catch {
            // ignore malformed JSON-LD blocks
          }
        }

        const events: SerializedMonthEvent[] = [];
        for (const item of parsed) {
          if (item['@type'] !== 'Event') {
            continue;
          }

          const event = item;
          const location =
            event.location && typeof event.location === 'object'
              ? (event.location as Record<string, unknown>)
              : {};
          const address =
            location.address && typeof location.address === 'object'
              ? (location.address as Record<string, unknown>)
              : {};
          const organizer = Array.isArray(event.organizer)
            ? (event.organizer as unknown[]).find(isPlainObject)
            : isPlainObject(event.organizer)
              ? event.organizer
              : null;
          const offersList = Array.isArray(event.offers) ? (event.offers as unknown[]) : null;
          const offers: unknown =
            offersList && offersList.length > 0 ? offersList[0] : event.offers;
          const imageUrl =
            Array.isArray(event.image) && event.image.length > 0
              ? event.image.find((image) => typeof image === 'string')
              : typeof event.image === 'string'
                ? event.image
                : undefined;

          const serialized = {
            title: typeof event.name === 'string' ? event.name : undefined,
            description: typeof event.description === 'string' ? event.description : undefined,
            imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
            url: typeof event.url === 'string' ? event.url : undefined,
            startDate: typeof event.startDate === 'string' ? event.startDate : undefined,
            endDate: typeof event.endDate === 'string' ? event.endDate : undefined,
            locationName: typeof location.name === 'string' ? location.name : undefined,
            streetAddress:
              typeof address.streetAddress === 'string' ? address.streetAddress : undefined,
            city: typeof address.addressLocality === 'string' ? address.addressLocality : undefined,
            state: typeof address.addressRegion === 'string' ? address.addressRegion : undefined,
            postalCode: typeof address.postalCode === 'string' ? address.postalCode : undefined,
            country:
              typeof address.addressCountry === 'string' ? address.addressCountry : undefined,
            organizer:
              organizer && isPlainObject(organizer) && 'name' in organizer
                ? toStringValue(organizer.name) || undefined
                : undefined,
            price:
              offers && isPlainObject(offers) && 'price' in offers
                ? toStringValue(offers.price) || undefined
                : undefined,
            priceCurrency:
              offers && isPlainObject(offers) && 'priceCurrency' in offers
                ? toStringValue(offers.priceCurrency) || undefined
                : undefined,
          } satisfies SerializedMonthEvent;

          if (
            serialized.url &&
            serialized.startDate &&
            serialized.startDate.slice(0, 7) === monthKey
          ) {
            events.push(serialized);
          }
        }

        return {
          status,
          title: parsedDoc.title,
          events,
        } satisfies MonthFetchResult;
      },
      {
        targetUrl: target.targetUrl,
        monthKey: target.monthKey,
        useCurrentDocument: target.useCurrentDocument,
        acceptHeader: HTML_HEADERS.Accept,
      }
    );

    if (result.status !== 200 || /just a moment/i.test(result.title)) {
      throw new Error(
        `Month view challenge for ${target.monthKey} (status=${result.status}, title="${result.title}")`
      );
    }

    console.log(`[MountainX] Month ${target.monthKey}: fetched ${result.events.length} raw events`);

    return result.events;
  } finally {
    await context.close();
  }
}

function dedupeByUrl(events: ScrapedEvent[]): ScrapedEvent[] {
  const seenUrls = new Set<string>();
  const deduped: ScrapedEvent[] = [];

  for (const event of events) {
    if (seenUrls.has(event.url)) {
      continue;
    }

    seenUrls.add(event.url);
    deduped.push(event);
  }

  return deduped;
}

function formatApiEvent(event: TribeEvent, window: ScrapeWindow): ScrapedEvent | null {
  const utcDateStr = `${event.utc_start_date.replace(' ', 'T')}Z`;
  const startDate = new Date(utcDateStr);

  if (Number.isNaN(startDate.getTime()) || !isDateInWindow(startDate, window)) {
    return null;
  }

  const venue = event.venue;
  let location: string | undefined;

  if (venue?.venue) {
    const venueName = decodeHtmlEntities(venue.venue);
    const parts = [venueName];
    if (venue.address) parts.push(decodeHtmlEntities(venue.address));
    if (venue.city && !venue.address?.includes(venue.city)) {
      parts.push(venue.city);
    }
    if (venue.state) parts.push(venue.state);
    location = parts.join(', ');
  }

  let price = event.cost || 'Unknown';
  if (price.toLowerCase() === 'free' || price === '$0' || price === '0') {
    price = 'Free';
  }

  return {
    sourceId: `mx-${event.id}`,
    source: 'MOUNTAIN_X',
    title: decodeHtmlEntities(event.title),
    description: event.description
      ? decodeHtmlEntities(event.description).slice(0, 2000)
      : event.excerpt
        ? decodeHtmlEntities(event.excerpt).slice(0, 2000)
        : undefined,
    startDate,
    location,
    zip: venue?.zip || (venue?.city ? getZipFromCity(venue.city) : undefined),
    organizer:
      event.organizer?.[0]?.organizer ||
      (venue?.venue ? decodeHtmlEntities(venue.venue) : undefined),
    price,
    url: event.url,
    imageUrl:
      event.image?.sizes?.large?.url ||
      event.image?.sizes?.medium?.url ||
      event.image?.url ||
      undefined,
    timeUnknown: event.all_day,
  };
}

function formatMonthEvent(event: SerializedMonthEvent, window: ScrapeWindow): ScrapedEvent | null {
  if (!event.url || !event.startDate || !event.title) {
    return null;
  }

  const startDate = new Date(event.startDate);
  if (Number.isNaN(startDate.getTime()) || !isDateInWindow(startDate, window)) {
    return null;
  }

  const location = buildLocationString(event);
  const organizer = event.organizer || event.locationName;
  const price = normalizePrice(event.price, event.priceCurrency);
  const description = event.description
    ? decodeHtmlEntities(event.description).slice(0, 2000)
    : undefined;

  return {
    sourceId: buildSourceId(event.url),
    source: 'MOUNTAIN_X',
    title: decodeHtmlEntities(event.title),
    description,
    startDate,
    location,
    zip: event.postalCode || (event.city ? getZipFromCity(event.city) : undefined),
    organizer: organizer ? decodeHtmlEntities(organizer) : undefined,
    price,
    url: event.url,
    imageUrl: event.imageUrl,
    timeUnknown: isLikelyAllDay(event.startDate, event.endDate),
  };
}

function buildLocationString(event: SerializedMonthEvent): string | undefined {
  const parts: string[] = [];

  if (event.locationName) {
    parts.push(decodeHtmlEntities(event.locationName));
  }
  if (event.streetAddress) {
    parts.push(decodeHtmlEntities(event.streetAddress));
  }
  if (event.city) {
    parts.push(event.city);
  }
  if (event.state) {
    parts.push(event.state);
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
}

function normalizePrice(rawPrice: string | undefined, currency: string | undefined): string {
  if (!rawPrice || rawPrice.trim().length === 0) {
    return 'Unknown';
  }

  const price = rawPrice.trim();

  if (/^free$/i.test(price) || /^0(?:\.0+)?$/i.test(price)) {
    return 'Free';
  }

  if (currency === 'USD') {
    const rangeMatch = price.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      return `$${rangeMatch[1]} - $${rangeMatch[2]}`;
    }

    if (/^\d+(?:\.\d+)?$/.test(price)) {
      return `$${price}`;
    }
  }

  return price;
}

function buildSourceId(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/^\/|\/$/g, '').replace(/\//g, '::');
    return `mx-${pathname}`;
  } catch {
    return `mx-${url}`;
  }
}

function isLikelyAllDay(startDateText: string, endDateText: string | undefined): boolean {
  const startMatch = startDateText.match(/T(\d{2}):(\d{2})/);
  const endMatch = endDateText?.match(/T(\d{2}):(\d{2})/);

  if (!startMatch) {
    return true;
  }

  if (startMatch[1] === '00' && startMatch[2] === '00') {
    return !endMatch || (endMatch[1] === '00' && endMatch[2] === '00');
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getScrapeWindow(): ScrapeWindow {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + SCRAPE_WINDOW_DAYS);
  return { start, end };
}

function isDateInWindow(date: Date, window: ScrapeWindow): boolean {
  return date >= window.start && date <= window.end;
}

if (require.main === module) {
  scrapeMountainX()
    .then((events) => {
      console.log('\n' + '='.repeat(60));
      console.log('SCRAPE RESULTS');
      console.log('='.repeat(60));
      console.log(`Total events: ${events.length}`);

      console.log('\nSample events (first 15):');
      console.log('-'.repeat(60));
      for (const event of events.slice(0, 15)) {
        console.log(`\n${event.title}`);
        console.log(`  Date (UTC): ${event.startDate.toISOString()}`);
        console.log(
          `  Date (ET):  ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
        );
        console.log(`  Location: ${event.location || 'N/A'}`);
        console.log(`  Zip: ${event.zip || 'N/A'}`);
        console.log(`  Price: ${event.price || 'N/A'}`);
        console.log(`  URL: ${event.url}`);
        if (event.timeUnknown) {
          console.log('  Time: All day / unknown');
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('Field Completeness:');
      const withImages = events.filter((event) => event.imageUrl).length;
      const withPrices = events.filter((event) => event.price && event.price !== 'Unknown').length;
      const withDescriptions = events.filter((event) => event.description).length;
      const withZips = events.filter((event) => event.zip).length;
      console.log(
        `  With images: ${withImages}/${events.length} (${Math.round((withImages / events.length) * 100)}%)`
      );
      console.log(
        `  With prices: ${withPrices}/${events.length} (${Math.round((withPrices / events.length) * 100)}%)`
      );
      console.log(
        `  With descriptions: ${withDescriptions}/${events.length} (${Math.round((withDescriptions / events.length) * 100)}%)`
      );
      console.log(
        `  With zip codes: ${withZips}/${events.length} (${Math.round((withZips / events.length) * 100)}%)`
      );
      console.log('='.repeat(60));
    })
    .catch((error) => {
      console.error('Scrape failed:', error);
      process.exit(1);
    });
}
