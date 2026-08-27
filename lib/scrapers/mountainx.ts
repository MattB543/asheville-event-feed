/**
 * Mountain Xpress (mountainx.com) Scraper
 *
 * Every mountainx.com URL sits behind Cloudflare, which fingerprints the TLS
 * handshake and the ALPN offer together. Node's built-in fetch is served the
 * "Just a moment..." interstitial no matter what headers we send, which is what
 * took this source offline. An undici dispatcher that offers HTTP/2 with
 * Chrome's cipher order is let straight through - both halves matter, since h2
 * on Node's default ciphers and Chrome's ciphers over HTTP/1.1 are each still
 * challenged.
 *
 * Paths, in order:
 *   1. Tribe Events Calendar REST API - richest data, 50 events per request.
 *   2. Month-view HTML over the same dispatcher, read as JSON-LD.
 *   3. Month-view HTML through a real patchright browser, in case Cloudflare
 *      starts rejecting the handshake above as well.
 *
 * Nothing is evaluated inside the browser page. tsx transpiles this file with
 * esbuild, which wraps named inner functions in its `__name` helper, and a
 * closure carrying that helper throws `ReferenceError: __name is not defined`
 * as soon as Playwright serializes it into the browser context.
 */

import { type ScrapedEvent } from './types';
import { findJsonLdEvents } from './jsonld';
import { isNonNCEvent, getZipFromCity } from '@/lib/utils/geo';
import { decodeHtmlEntities } from '@/lib/utils/parsers';
import { DEFAULT_FETCH_TIMEOUT_MS } from '@/lib/utils/retry';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import type { Browser, Page } from 'patchright';
import type { Dispatcher } from 'undici';

const API_BASE = 'https://mountainx.com/wp-json/tribe/events/v1/events';
const MONTH_VIEW_ROOT = 'https://mountainx.com/events/month/';
const PER_PAGE = 50;
const MAX_PAGES = 40;
const MAX_EVENTS = PER_PAGE * MAX_PAGES;
const SCRAPE_WINDOW_DAYS = 56;
const API_DELAY_MS = 200;
const HTTP_ATTEMPTS = 4;
const HTTP_RETRY_BASE_MS = 2000;
const MONTH_DELAY_MS = 400;
const MONTH_NAV_TIMEOUT_MS = 60000;
const CHALLENGE_ATTEMPTS = 3;
const CHALLENGE_WAIT_MS = 6000;
const CHALLENGE_TITLE = /just a moment/i;

/** Chrome 122's TLS cipher order, in OpenSSL naming. */
const CHROME_TLS_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

const JSON_ACCEPT = 'application/json';
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const BROWSER_CONTEXT_OPTIONS = {
  userAgent: USER_AGENT,
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
}

interface MonthPage {
  monthKey: string;
  html: string;
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

/** Shape of the schema.org Event nodes Mountain Xpress embeds in month views. */
interface JsonLdEvent {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  url?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  location?: unknown;
  organizer?: unknown;
  offers?: unknown;
}

export async function scrapeMountainX(): Promise<ScrapedEvent[]> {
  console.log('[MountainX] Starting scrape...');

  const window = getScrapeWindow();
  const dispatcher = await createCloudflareDispatcher();
  let allEvents: ScrapedEvent[] = [];

  try {
    try {
      allEvents = await scrapeMountainXViaApi(window, dispatcher);
      console.log(`[MountainX] API path returned ${allEvents.length} events`);
    } catch (error) {
      console.warn(`[MountainX] API path failed: ${describeError(error)}`);
      console.warn('[MountainX] Falling back to month-view HTML scrape...');
      allEvents = await scrapeMountainXFromMonthViews(window, dispatcher);
    }
  } finally {
    await dispatcher.close();
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

async function createCloudflareDispatcher(): Promise<Dispatcher> {
  const { Agent } = await import('undici');
  return new Agent({ allowH2: true, connect: { ciphers: CHROME_TLS_CIPHERS } });
}

/**
 * Cloudflare's 403 here is a transient reputation check rather than a standing
 * block - the same URL and handshake that is challenged one second is served
 * the next - so every request gets a few spaced-out attempts before we give up
 * on this path.
 */
async function fetchAsChrome(url: string, accept: string, dispatcher: Dispatcher): Promise<string> {
  const { fetch: undiciFetch } = await import('undici');
  let lastStatus = 0;

  for (let attempt = 1; attempt <= HTTP_ATTEMPTS; attempt++) {
    const response = await undiciFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': ACCEPT_LANGUAGE },
      dispatcher,
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });

    const body = await response.text();

    if (response.status === 200 && !CHALLENGE_TITLE.test(readTitle(body))) {
      return body;
    }

    lastStatus = response.status;

    if (attempt < HTTP_ATTEMPTS) {
      console.warn(
        `[MountainX] Challenged (status=${lastStatus}, attempt ${attempt}/${HTTP_ATTEMPTS}): ${url}`
      );
      await sleep(HTTP_RETRY_BASE_MS * attempt);
    }
  }

  throw new Error(`HTTP ${lastStatus} for ${url}`);
}

async function scrapeMountainXViaApi(
  window: ScrapeWindow,
  dispatcher: Dispatcher
): Promise<ScrapedEvent[]> {
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

    const data = await fetchEventsPageWithHttp(url.toString(), dispatcher);
    const events = data.events || [];

    console.log(`[MountainX] API page ${page}/${data.total_pages}: ${events.length} events`);

    for (const event of events) {
      const formatted = formatApiEvent(event, window);
      if (formatted) {
        allEvents.push(formatted);
      }
    }

    // The API returns events in start-date order, so once a whole page lands
    // past the window there is nothing left worth paging through.
    if (events.length > 0 && events.every((event) => isApiEventPastWindow(event, window))) {
      console.log(`[MountainX] API page ${page} is past the ${SCRAPE_WINDOW_DAYS}-day window.`);
      break;
    }

    hasMore = !!data.next_rest_url && page < data.total_pages;
    page++;

    if (hasMore) {
      await sleep(API_DELAY_MS);
    }
  }

  return allEvents;
}

async function fetchEventsPageWithHttp(
  url: string,
  dispatcher: Dispatcher
): Promise<TribeEventsResponse> {
  return JSON.parse(await fetchAsChrome(url, JSON_ACCEPT, dispatcher)) as TribeEventsResponse;
}

async function scrapeMountainXFromMonthViews(
  window: ScrapeWindow,
  dispatcher: Dispatcher
): Promise<ScrapedEvent[]> {
  const monthTargets = buildMonthTargets(window);

  try {
    return collectMonthEvents(await fetchMonthPagesWithHttp(monthTargets, dispatcher), window);
  } catch (error) {
    console.warn(`[MountainX] Month-view HTTP fetch failed: ${describeError(error)}`);
    console.warn('[MountainX] Falling back to a real browser session...');
    return collectMonthEvents(await fetchMonthPagesWithBrowser(monthTargets), window);
  }
}

async function fetchMonthPagesWithHttp(
  targets: MonthTarget[],
  dispatcher: Dispatcher
): Promise<MonthPage[]> {
  const pages: MonthPage[] = [];

  for (const target of targets) {
    pages.push({
      monthKey: target.monthKey,
      html: await fetchAsChrome(target.targetUrl, HTML_ACCEPT, dispatcher),
    });
    await sleep(MONTH_DELAY_MS);
  }

  return pages;
}

async function fetchMonthPagesWithBrowser(targets: MonthTarget[]): Promise<MonthPage[]> {
  const browser = await launchBrowser();
  const pages: MonthPage[] = [];

  try {
    for (const target of targets) {
      // A fresh context per month, deliberately. Reusing one context carries
      // the first page's Cloudflare cookie into the next navigation, and every
      // request after that is challenged; a clean cookie jar is waved through.
      const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);

      try {
        const page = await context.newPage();
        pages.push({
          monthKey: target.monthKey,
          html: await fetchMonthHtmlWithBrowser(page, target),
        });
      } finally {
        await context.close();
      }

      await sleep(MONTH_DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  return pages;
}

function collectMonthEvents(pages: MonthPage[], window: ScrapeWindow): ScrapedEvent[] {
  const allEvents: ScrapedEvent[] = [];
  const seenUrls = new Set<string>();

  for (const { monthKey, html } of pages) {
    const rawEvents = extractMonthEvents(html, monthKey);
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
      `[MountainX] Month ${monthKey}: ${rawEvents.length} raw, ${addedThisMonth} after formatting/dedup`
    );
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
    });

    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
    index++;
  }

  return targets;
}

async function fetchMonthHtmlWithBrowser(page: Page, target: MonthTarget): Promise<string> {
  for (let attempt = 1; attempt <= CHALLENGE_ATTEMPTS; attempt++) {
    const response = await page.goto(target.targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: MONTH_NAV_TIMEOUT_MS,
    });

    const status = response?.status() ?? 0;
    if (status === 200 && !CHALLENGE_TITLE.test(await page.title())) {
      return page.content();
    }

    console.warn(
      `[MountainX] Month ${target.monthKey} challenged (status=${status}, attempt ${attempt}/${CHALLENGE_ATTEMPTS}). Waiting for it to clear...`
    );

    // Cloudflare's interstitial solves itself in a real browser; give it time
    // before burning another navigation on the same URL.
    await page.waitForTimeout(CHALLENGE_WAIT_MS);

    if (!CHALLENGE_TITLE.test(await page.title())) {
      return page.content();
    }
  }

  throw new Error(
    `Month view challenge for ${target.monthKey} persisted after ${CHALLENGE_ATTEMPTS} attempts`
  );
}

function extractMonthEvents(html: string, monthKey: string): SerializedMonthEvent[] {
  const events: SerializedMonthEvent[] = [];

  for (const node of findJsonLdEvents<JsonLdEvent>(html)) {
    const serialized = serializeJsonLdEvent(node);

    // Month grids spill into the neighbouring months; each of those is fetched
    // on its own pass, so keep only the events this page is responsible for.
    if (serialized.url && serialized.startDate && serialized.startDate.slice(0, 7) === monthKey) {
      events.push(serialized);
    }
  }

  return events;
}

function serializeJsonLdEvent(event: JsonLdEvent): SerializedMonthEvent {
  const location = isPlainObject(event.location) ? event.location : {};
  const address = isPlainObject(location.address) ? location.address : {};
  const organizerList = toArray(event.organizer);
  const organizer = organizerList
    ? organizerList.find(isPlainObject)
    : isPlainObject(event.organizer)
      ? event.organizer
      : null;
  const offersList = toArray(event.offers);
  const offers = offersList && offersList.length > 0 ? offersList[0] : event.offers;
  const imageList = toArray(event.image);
  const imageUrl = imageList ? imageList.find((image) => typeof image === 'string') : event.image;

  return {
    title: toOptionalString(event.name),
    description: toOptionalString(event.description),
    imageUrl: toOptionalString(imageUrl),
    url: toOptionalString(event.url),
    startDate: toOptionalString(event.startDate),
    endDate: toOptionalString(event.endDate),
    locationName: toOptionalString(location.name),
    streetAddress: toOptionalString(address.streetAddress),
    city: toOptionalString(address.addressLocality),
    state: toOptionalString(address.addressRegion),
    postalCode: toOptionalString(address.postalCode),
    country: toOptionalString(address.addressCountry),
    organizer: organizer ? toOptionalString(organizer.name) : undefined,
    price: isPlainObject(offers) ? toOptionalString(offers.price) : undefined,
    priceCurrency: isPlainObject(offers) ? toOptionalString(offers.priceCurrency) : undefined,
  };
}

function toArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function readTitle(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      decodeHtmlEntities(event.organizer?.[0]?.organizer || venue?.venue || '') || undefined,
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

function isApiEventPastWindow(event: TribeEvent, window: ScrapeWindow): boolean {
  const startDate = new Date(`${event.utc_start_date.replace(' ', 'T')}Z`);
  return !Number.isNaN(startDate.getTime()) && startDate > window.end;
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
