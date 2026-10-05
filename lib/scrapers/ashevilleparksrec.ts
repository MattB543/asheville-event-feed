/**
 * City of Asheville Parks & Recreation scraper.
 *
 * Classes, camps, community-center programs and special events come from the
 * city's Vermont Systems WebTrac registration site (avlrec.com redirects there).
 * WebTrac has no feed or export, so this reads three server-rendered pages:
 *
 *   1. The activity search list, which needs at least one filter and has no
 *      "all" option. Neither filter covers everything - Therapeutic Recreation
 *      sessions have no location and the odd activity has no category - so it
 *      searches every location and every category and merges on FMID.
 *   2. The activity detail page (`iteminfo.html?FMID=`) for the description and
 *      the facility's address. It needs no session, so it is also the event URL.
 *   3. The "custom dates" popup, for the real session list of multi-session
 *      activities (it skips holidays the date range alone would include).
 *
 * The site sits behind Cloudflare, which 403s Node's own fetch, so requests go
 * through the Chrome-fingerprinted dispatcher from `./fetchAsChrome`, with a
 * real patchright browser as the fallback. No cookie or CSRF token is needed.
 *
 * One activity (FMID) becomes exactly one event, dated at its next upcoming
 * session, with the full schedule in the description. The URL is per FMID, so
 * each scrape moves the same row forward to the next session instead of adding one.
 */

import { type ScrapedEvent } from './types';
import { debugSave } from './base';
import {
  CHALLENGE_TITLE,
  CHROME_USER_AGENT,
  HTML_ACCEPT,
  createChromeDispatcher,
} from './fetchAsChrome';
import { decodeHtmlEntities, formatPrice } from '@/lib/utils/parsers';
import { DEFAULT_FETCH_TIMEOUT_MS } from '@/lib/utils/retry';
import { formatDateEastern, getTodayStringEastern, parseAsEastern } from '@/lib/utils/timezone';
import type { Browser } from 'patchright';
import type { Dispatcher } from 'undici';

const LABEL = 'Asheville Parks & Rec';
const WEBTRAC_BASE = 'https://ncashevilleweb.myvscloud.com/webtrac/web';
const SEARCH_URL = `${WEBTRAC_BASE}/search.html?module=AR&display=list&search=yes`;
const ORGANIZER = 'Asheville Parks & Recreation';

const REQUEST_DELAY_MS = 250;
const MAX_SEARCH_PAGES = 10; // WebTrac pages at 200 rows; the biggest search is ~350
const MAX_DAYS_AHEAD = 120;
const LISTED_SESSION_LIMIT = 12; // longer schedules are summarised by count
// Placeholder for a session with no listed time (flagged timeUnknown). Midday,
// so it is nowhere near the 2 AM DST switch.
const UNKNOWN_TIME_PLACEHOLDER = '12:00:00';
const HTTP_CHALLENGE_ATTEMPTS = 3;
const HTTP_CHALLENGE_RETRY_MS = 2000;
const BROWSER_NAV_TIMEOUT_MS = 60000;
const BROWSER_ATTEMPTS = 3;
const BROWSER_CHALLENGE_WAIT_MS = 6000;

// The user agent override is load-bearing: this site's Cloudflare rules block
// headless Chromium's default "HeadlessChrome" UA outright ("Sorry, you have
// been blocked"), while the same browser with a desktop Chrome UA is let in.
const BROWSER_CONTEXT_OPTIONS = {
  userAgent: CHROME_USER_AGENT,
  locale: 'en-US',
  timezoneId: 'America/New_York',
} as const;

// Not events: a running sports league is joined as a team for the season, and
// afterschool / teen-leadership enrollment is childcare. Checked against a
// year of the site's titles (650+) with no false positives. Camps are kept.
const EXCLUDED_TITLE_PATTERNS = [
  /\bleague\b/i,
  /\b\d{1,2}U\b/, // age-group teams: "10U Fall Baseball"
  /\bt-ball\b/i,
  /\b(?:softball|flag football)\b/i,
  /(?:^|\s)(?:upper|middle|lower)(?:\/(?:upper|middle|lower))?(?:\s|$)/i, // league divisions
  /\bafter ?school\b/i,
  /\bteen leadership\b/i,
  /\binclement weather care\b/i,
  /\bannual pass\b|\bdonations?\b|\bwait ?list\b/i,
];

// Nobody new can get in. The feed has no availability field, and the upsert
// keeps the longest description, so a "waitlist only" note would go stale.
const DROPPED_STATUSES = new Set([
  'cancelled',
  'canceled',
  'full',
  'closed',
  'waitlist',
  'wait list',
]);

/**
 * Friendlier names for the city's own rec centers - the names other sources
 * (AVL Today, Mountain Xpress) already use, so cross-source dedup can match -
 * plus a fallback address for when a detail page fails to load.
 */
const FACILITIES: Record<string, { name: string; street: string; zip: string }> = {
  'Grant Center': {
    name: 'Dr. Wesley Grant Sr. Southside Community Center',
    street: '285 Livingston Street',
    zip: '28801',
  },
  'Montford Complex': {
    name: 'Tempie Avery Montford Community Center',
    street: '34 Pearson Drive',
    zip: '28801',
  },
  'Harvest House': {
    name: 'Harvest House Community Center',
    street: '205 Kenilworth Road',
    zip: '28803',
  },
  'Burton St. Center': {
    name: 'Burton Street Community Center',
    street: '134 Burton Street',
    zip: '28806',
  },
  'Murphy-Oakley': {
    name: 'Murphy-Oakley Community Center',
    street: '749 Fairview Road',
    zip: '28803',
  },
  'Shiloh Center': {
    name: 'Linwood Crump Shiloh Community Center',
    street: '121 Shiloh Road',
    zip: '28803',
  },
  'Stephens-Lee Center': {
    name: 'Stephens-Lee Community Center',
    street: '30 George Washington Carver Ave',
    zip: '28801',
  },
  'Grove Street Center': { name: 'Grove Street Center', street: '36 Grove Street', zip: '28801' },
};

const WEEKDAY_ABBREVIATIONS: Record<string, number> = {
  Su: 0,
  M: 1,
  Tu: 2,
  W: 3,
  Th: 4,
  F: 5,
  Sa: 6,
};

interface SearchOption {
  param: 'location' | 'category';
  value: string;
  label: string;
}

interface ActivityRow {
  fmid: string;
  title: string;
  status: string;
  beginDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime?: string; // HH:MM:00
  timeRange?: string; // "6:00 pm - 9:00 pm"
  meetDays: number[];
  locationLabel: string;
  residentFee: number | null;
  nonResidentFee: number | null;
  ages: string;
  registrationNote?: string;
  category?: string;
}

interface ActivityDetail {
  description?: string;
  facility?: string;
  street?: string;
  zip?: string;
}

interface PageFetcher {
  get(url: string): Promise<string>;
  close(): Promise<void>;
}

/** Cloudflare served a challenge or block page instead of the site. */
class CloudflareChallengeError extends Error {}

export async function scrapeAshevilleParksRec(): Promise<ScrapedEvent[]> {
  console.log(`[${LABEL}] Starting scrape...`);
  const fetcher = await createPageFetcher();

  try {
    const rows = await fetchAllActivities(fetcher);
    const today = getTodayStringEastern();
    const candidates = rows.filter((row) => isCandidate(row, today));
    console.log(
      `[${LABEL}] ${rows.length} activities listed, ${candidates.length} not yet over after filters`
    );

    const events: ScrapedEvent[] = [];
    for (const row of candidates) {
      try {
        const event = await scrapeActivity(row, fetcher);
        if (event) events.push(event);
      } catch (error) {
        console.warn(`[${LABEL}] Skipped "${row.title}" (${row.fmid}): ${describeError(error)}`);
      }
    }

    events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    await debugSave('03-events.json', events, { label: LABEL });
    console.log(`[${LABEL}] Found ${events.length} upcoming events`);
    return events;
  } finally {
    await fetcher.close();
  }
}

/**
 * One FMID -> at most one event. Sessions and the detail page are both loaded
 * before the next session is chosen, because the description can narrow the
 * schedule ("2nd and 4th Wednesdays"); the choice is then made exactly once.
 */
async function scrapeActivity(
  row: ActivityRow,
  fetcher: PageFetcher
): Promise<ScrapedEvent | null> {
  const listedSessions = await loadSessions(row, fetcher);

  let detail: ActivityDetail = {};
  try {
    await sleep(REQUEST_DELAY_MS);
    detail = parseDetailPage(await fetcher.get(activityUrl(row.fmid)));
  } catch (error) {
    console.warn(
      `[${LABEL}] Detail page failed for "${row.title}" (${row.fmid}), using list data: ${describeError(error)}`
    );
  }

  const sessions = applyNthWeekdayRule(
    listedSessions,
    [row.title, detail.description].filter(Boolean).join('\n')
  );
  const startDate = pickNextSession(sessions, row);
  return startDate ? buildEvent(row, detail, sessions, startDate) : null;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Chrome-fingerprinted HTTP first. Only a confirmed Cloudflare challenge
 * switches the rest of the run to a real browser - a fresh context per page,
 * because a context that has been challenged keeps its Cloudflare cookie and
 * is challenged again (see mountainx.ts). Any other failure (timeout, 404,
 * 5xx) is thrown to the caller, which skips just that page.
 */
async function createPageFetcher(): Promise<PageFetcher> {
  const dispatcher = await createChromeDispatcher();
  let browserPromise: Promise<Browser> | null = null;
  let useBrowser = false;

  async function getWithBrowser(url: string): Promise<string> {
    browserPromise ??= launchBrowser();
    const browser = await browserPromise;
    const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);

    try {
      const page = await context.newPage();
      for (let attempt = 1; attempt <= BROWSER_ATTEMPTS; attempt++) {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: BROWSER_NAV_TIMEOUT_MS,
        });
        const status = response?.status() ?? 0;
        const challenged =
          isCloudflarePage(await page.title()) || !!response?.headers()['cf-mitigated'];
        if (!challenged) {
          if (status === 200) return await page.content();
          throw new Error(`HTTP ${status} for ${url}`);
        }
        console.warn(
          `[${LABEL}] Browser challenged (status=${status}, attempt ${attempt}/${BROWSER_ATTEMPTS}): ${url}`
        );
        // A "Just a moment" interstitial can clear itself in place; a block page can't.
        await page.waitForTimeout(BROWSER_CHALLENGE_WAIT_MS);
        if (!isCloudflarePage(await page.title())) {
          return await page.content();
        }
      }
      throw new CloudflareChallengeError(`Browser challenge persisted for ${url}`);
    } finally {
      await context.close();
    }
  }

  return {
    async get(url: string): Promise<string> {
      if (!useBrowser) {
        try {
          return await fetchHtml(url, dispatcher);
        } catch (error) {
          if (!(error instanceof CloudflareChallengeError)) throw error;
          console.warn(
            `[${LABEL}] ${error.message}; switching to a browser for the rest of the run`
          );
          useBrowser = true;
        }
      }
      return getWithBrowser(url);
    },
    async close(): Promise<void> {
      await dispatcher.close();
      if (browserPromise) {
        await (await browserPromise).close().catch(() => {});
      }
    },
  };
}

/**
 * Like `fetchAsChrome`, but tells a Cloudflare challenge (retried, then a
 * CloudflareChallengeError) apart from an ordinary failure (thrown at once),
 * so a 404 neither burns retries nor sends the whole run to the browser.
 */
async function fetchHtml(url: string, dispatcher: Dispatcher): Promise<string> {
  const { fetch: undiciFetch } = await import('undici');
  let lastStatus = 0;

  for (let attempt = 1; attempt <= HTTP_CHALLENGE_ATTEMPTS; attempt++) {
    const response = await undiciFetch(url, {
      headers: {
        'User-Agent': CHROME_USER_AGENT,
        Accept: HTML_ACCEPT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      dispatcher,
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });
    const body = await response.text();
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const challenged = !!response.headers.get('cf-mitigated') || isCloudflarePage(title);

    if (!challenged) {
      if (response.status === 200) return body;
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    lastStatus = response.status;
    if (attempt < HTTP_CHALLENGE_ATTEMPTS) {
      // Usually a transient reputation check: the next attempt often goes through.
      await sleep(HTTP_CHALLENGE_RETRY_MS * attempt);
    }
  }

  throw new CloudflareChallengeError(`Cloudflare challenge (status=${lastStatus}) for ${url}`);
}

/** The "Just a moment..." interstitial, or the "Attention Required!" block page. */
function isCloudflarePage(title: string): boolean {
  return CHALLENGE_TITLE.test(title) || /attention required/i.test(title);
}

async function launchBrowser(): Promise<Browser> {
  try {
    const { chromium } = await import('patchright');
    return await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(
      `patchright is not available for the ${LABEL} browser fallback: ${describeError(error)}`
    );
  }
}

/**
 * Every location search plus every category search, merged on FMID. The filter
 * options are read off the search form itself so a new center or category is
 * picked up without a code change. A failed search (or later page) is skipped;
 * the two search kinds overlap heavily, so the rest usually cover for it.
 */
async function fetchAllActivities(fetcher: PageFetcher): Promise<ActivityRow[]> {
  const formHtml = await fetcher.get(SEARCH_URL);
  const options = [
    ...parseSelectOptions(formHtml, 'location'),
    ...parseSelectOptions(formHtml, 'category'),
  ];
  if (options.length === 0) {
    throw new Error('Search form had no location or category options - markup changed?');
  }

  const byFmid = new Map<string, ActivityRow>();
  let failedSearches = 0;

  for (const option of options) {
    for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
      await sleep(REQUEST_DELAY_MS);
      const url = `${SEARCH_URL}&${option.param}=${encodeURIComponent(option.value)}&page=${page}`;

      let html: string;
      try {
        html = await fetcher.get(url);
      } catch (error) {
        failedSearches++;
        console.warn(
          `[${LABEL}] Search ${option.param}=${option.value} page ${page} failed: ${describeError(error)}`
        );
        break;
      }

      if (page === 1) {
        const name = `01-search-${option.param}-${option.value.replace(/\W+/g, '_')}.html`;
        await debugSave(name, html, { label: LABEL });
      }

      for (const row of parseSearchRows(html)) {
        const existing = byFmid.get(row.fmid);
        if (existing) {
          if (option.param === 'category') existing.category ??= option.label;
        } else {
          if (option.param === 'category') row.category = option.label;
          byFmid.set(row.fmid, row);
        }
      }

      const paging = html.match(/Showing results \d+-(\d+) of (\d+)/);
      if (!paging || Number(paging[1]) >= Number(paging[2])) break;
    }
  }

  if (byFmid.size === 0) {
    throw new Error(
      `No activities from ${options.length} searches (${failedSearches} failed) - blocked or markup changed?`
    );
  }
  if (failedSearches > 0) {
    console.warn(`[${LABEL}] ${failedSearches} search page(s) failed; continuing with the rest`);
  }

  const rows = [...byFmid.values()];
  await debugSave('02-activities.json', rows, { label: LABEL });
  return rows;
}

function parseSelectOptions(html: string, name: 'location' | 'category'): SearchOption[] {
  const select = html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`));
  if (!select) return [];

  return [...select[1].matchAll(/<option[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/g)].map(
    (match) => ({
      param: name,
      value: decodeHtmlEntities(match[1]),
      label: decodeHtmlEntities(match[2]),
    })
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseSearchRows(html: string): ActivityRow[] {
  const tbody = html.match(
    /<table[^>]*id="arwebsearch_output_table[^"]*"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/
  );
  if (!tbody) return [];

  const rows: ActivityRow[] = [];
  for (const rowHtml of tbody[1].split(/<tr\b[^>]*>/).slice(1)) {
    const cells = new Map<string, string>();
    for (const cell of rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)) {
      const header = cell[1].match(/<span class="mobile-column-header"[^>]*>([\s\S]*?)<\/span>/);
      if (header) cells.set(decodeHtmlEntities(header[1]), cell[1]);
    }

    const fmid = (cells.get('Description') ?? '').match(/FMID=(\d+)/)?.[1];
    const dates = [...cellText(cells.get('Dates')).matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(
      ([, month, day, year]) => `${year}-${month}-${day}`
    );
    if (!fmid || dates.length === 0) continue;

    const times = parseTimes(cellText(cells.get('Times')));
    const [residentFee, nonResidentFee] = parseFees(
      cellText(cells.get([...cells.keys()].find((key) => key.startsWith('Res/NR')) ?? ''))
    );
    const tooltip = decodeHtmlEntities(
      decodeHtmlEntities(rowHtml.match(/data-tooltip="([^"]*)"/)?.[1] ?? '')
    );
    const registrationOpens = tooltip.match(/Registration Opens (.+?)(?: unless|\.|$)/i)?.[1];

    rows.push({
      fmid,
      title: cleanTitle(cellText(cells.get('Description'))),
      status: cellText(cells.get('Status')),
      beginDate: dates[0],
      endDate: dates[dates.length - 1],
      startTime: times?.start,
      timeRange: times?.range,
      meetDays: cellText(cells.get('Meet Days'))
        .split(/\s*,\s*/)
        .map((day) => WEEKDAY_ABBREVIATIONS[day])
        .filter((day): day is number => day !== undefined),
      locationLabel: cellText(cells.get('Locations')),
      residentFee,
      nonResidentFee,
      ages: cellText(cells.get('Ages')),
      registrationNote: registrationOpens ? `Registration opens ${registrationOpens}.` : undefined,
    });
  }

  return rows;
}

/** Text of a list cell with its mobile-only column header removed. */
function cellText(html: string | undefined): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<span class="mobile-column-header"[\s\S]*?<\/span>/, ''));
}

/**
 * "TR" is the city's shorthand for its Therapeutic Recreation category, which
 * residents won't recognise, so a standalone leading "TR" is spelled out:
 * "TR Bowling" -> "Therapeutic Rec: Bowling", "TR/OAKS Fun Day Out" ->
 * "Therapeutic Rec/OAKS Fun Day Out", and "TR Tots: Nature Club" ->
 * "Therapeutic Rec Tots: Nature Club" (no second colon).
 */
function cleanTitle(raw: string): string {
  const title = raw.replace(/^"(.*)"$/, '$1').trim();
  if (title.startsWith('TR/')) return `Therapeutic Rec${title.slice(2)}`;

  const rest = title.match(/^TR(?:\s*[-:]\s*|\s+)(.+)$/)?.[1];
  if (!rest) return title;
  return `Therapeutic Rec${rest.includes(':') ? ' ' : ': '}${rest}`;
}

function parseTimes(text: string): { start: string; range: string } | undefined {
  const times = [...text.matchAll(/(\d{1,2}):(\d{2})\s*([ap]m)/gi)];
  if (times.length === 0) return undefined;

  const [, hourText, minute, meridiem] = times[0];
  let hour = Number(hourText) % 12;
  if (meridiem.toLowerCase() === 'pm') hour += 12;

  return {
    start: `${String(hour).padStart(2, '0')}:${minute}:00`,
    range: times
      .map((time) => `${Number(time[1])}:${time[2]} ${time[3].toLowerCase()}`)
      .join(' - '),
  };
}

/** "$0.00/$10.00" -> [0, 10]; "Add To Cart For Price/..." -> [null, null]. */
function parseFees(text: string): [number | null, number | null] {
  const [resident, nonResident] = text.split('/').map((part) => {
    const amount = part.match(/\$\s*([\d,]+(?:\.\d+)?)/)?.[1];
    return amount === undefined ? null : Number(amount.replace(/,/g, ''));
  });
  return [resident ?? null, nonResident ?? null];
}

function parseDetailPage(html: string): ActivityDetail {
  const detail: ActivityDetail = {};

  // The description is the main column's only details block outside the Fees
  // section. Greedy, so markup inside the description can't end it early.
  const main = html.match(/<section class="item-info-main-content">([\s\S]*?)<\/section>/)?.[1];
  const descriptionHtml = main
    ?.split('<div class="item-info-additional"')[0]
    .match(/<div class="item-info__details-text">([\s\S]*)<\/div>\s*<\/div>/)?.[1];
  if (descriptionHtml) {
    const description = htmlToText(descriptionHtml);
    // Placeholders seen in the wild: ".", "avlrec".
    if (description.length >= 15) detail.description = description;
  }

  // Meeting Details lines: Date(s), Time, Days, facility, street, "City, NC, zip", phone, map.
  const meeting = html.match(/Meeting Details<\/h4>([\s\S]*?)<\/div>\s*<\/div>/)?.[1];
  if (meeting) {
    const lines = [...meeting.matchAll(/<div>([^<]*)<\/div>/g)]
      .map((match) => decodeHtmlEntities(match[1]))
      .filter((line) => line && !/^(Time|Days):/.test(line));
    const cityIndex = lines.findIndex((line) => /,\s*NC,?\s*\d{5}/.test(line));
    if (lines.length > 0 && !/^\(?\d{3}\)?/.test(lines[0])) detail.facility = lines[0];
    if (cityIndex >= 2) detail.street = lines[cityIndex - 1];
    if (cityIndex >= 0) detail.zip = lines[cityIndex].match(/(\d{5})/)?.[1];
  }

  return detail;
}

/** Session dates from the custom-dates popup ("Sun 01/11, Sun 01/18, ..."), years inferred. */
function parseSessionDates(html: string, beginDate: string): string[] {
  const text = decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '));
  const list = text.match(/Date\(s\):\s*((?:[A-Z][a-z]{2} \d{2}\/\d{2},?\s*)+)/)?.[1];
  if (!list) return [];

  let year = Number(beginDate.slice(0, 4));
  let previousMonth = 0;
  return [...list.matchAll(/(\d{2})\/(\d{2})/g)].map(([, month, day]) => {
    if (Number(month) < previousMonth) year++;
    previousMonth = Number(month);
    return `${year}-${month}-${day}`;
  });
}

/**
 * Turn a description fragment into plain text, keeping line breaks and
 * un-mangling the emails Cloudflare obfuscates ("[email protected]").
 */
function htmlToText(html: string): string {
  return html
    .replace(/<a[^>]*data-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/a>/gi, (_, hex: string) =>
      decodeCloudflareEmail(hex)
    )
    .replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, '\n')
    .split('\n')
    .map((line) => decodeHtmlEntities(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeCloudflareEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let email = '';
  for (let i = 2; i < hex.length; i += 2) {
    email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return email;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function isCandidate(row: ActivityRow, today: string): boolean {
  if (row.endDate < today) return false;
  if (DROPPED_STATUSES.has(row.status.toLowerCase())) return false;
  return !EXCLUDED_TITLE_PATTERNS.some((pattern) => pattern.test(row.title));
}

/** Every session date of the activity, past ones included (they go in the schedule text). */
async function loadSessions(row: ActivityRow, fetcher: PageFetcher): Promise<string[]> {
  if (row.beginDate === row.endDate) return [row.beginDate];

  let sessions: string[] = [];
  try {
    await sleep(REQUEST_DELAY_MS);
    const html = await fetcher.get(`${activityUrl(row.fmid)}&option=dates&mode=customdates`);
    sessions = parseSessionDates(html, row.beginDate);
  } catch (error) {
    console.warn(
      `[${LABEL}] Dates popup failed for "${row.title}" (${row.fmid}): ${describeError(error)}`
    );
  }
  // Some activities ("No Custom Dates To Display") only carry a range and meet days.
  return sessions.length > 0 ? sessions : sessionsFromMeetDays(row);
}

function sessionsFromMeetDays(row: ActivityRow): string[] {
  const sessions: string[] = [];
  const end = toUtcDate(row.endDate);
  for (let day = toUtcDate(row.beginDate); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (row.meetDays.length === 0 || row.meetDays.includes(day.getUTCDay())) {
      sessions.push(day.toISOString().slice(0, 10));
    }
  }
  return sessions;
}

/**
 * The start of the first session still ahead, or null when none is left or the
 * next one is past the horizon. An untimed session counts for its whole day.
 */
function pickNextSession(sessions: string[], row: ActivityRow): Date | null {
  const now = new Date();
  const today = getTodayStringEastern();
  const horizon = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);

  for (const session of sessions) {
    const startDate = parseAsEastern(session, row.startTime ?? UNKNOWN_TIME_PLACEHOLDER);
    const ahead = row.startTime ? startDate > now : session >= today;
    if (ahead) return startDate <= horizon ? startDate : null;
  }
  return null;
}

const ORDINALS: Record<string, number> = {
  '1st': 1,
  first: 1,
  '2nd': 2,
  second: 2,
  '3rd': 3,
  third: 3,
  '4th': 4,
  fourth: 4,
  '5th': 5,
  fifth: 5,
  last: -1,
};
const ORDINAL = '1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last';
const NTH_WEEKDAY = new RegExp(
  `\\b((?:${ORDINAL})(?:\\s*(?:,|and|&)\\s*(?:${ORDINAL}))*)\\s+(sun|mon|tues|wednes|thurs|fri|satur)days?\\b`,
  'i'
);
const WEEKDAY_STEMS = ['sun', 'mon', 'tues', 'wednes', 'thurs', 'fri', 'satur'];

/**
 * Some free drop-in groups are entered as "every Wednesday" while the text
 * says "2nd and 4th Wednesdays of the month"; trust the text. The result can
 * be empty, which means the activity has no real session left.
 *
 * Only for a recurring single-weekday schedule: a one-off FMID's date is
 * explicit, and a passing "first Monday" in the text of a Mon/Wed class must
 * not drop its Wednesdays.
 */
function applyNthWeekdayRule(sessions: string[], text: string): string[] {
  const match = text.match(NTH_WEEKDAY);
  if (!match || sessions.length < 2) return sessions;

  const weekday = WEEKDAY_STEMS.indexOf(match[2].toLowerCase());
  if (sessions.some((session) => toUtcDate(session).getUTCDay() !== weekday)) return sessions;

  const wanted = new Set(
    match[1]
      .toLowerCase()
      .split(/\s*(?:,|and|&)\s*/)
      .map((ordinal) => ORDINALS[ordinal])
  );

  return sessions.filter((session) => {
    const date = toUtcDate(session);
    const dayOfMonth = date.getUTCDate();
    const daysInMonth = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate();
    return (
      wanted.has(Math.ceil(dayOfMonth / 7)) || (wanted.has(-1) && dayOfMonth + 7 > daysInMonth)
    );
  });
}

// ---------------------------------------------------------------------------
// Event building
// ---------------------------------------------------------------------------

function buildEvent(
  row: ActivityRow,
  detail: ActivityDetail,
  sessions: string[],
  startDate: Date
): ScrapedEvent {
  const facilityLabel =
    detail.facility ?? (row.locationLabel && row.locationLabel !== 'N/A' ? row.locationLabel : '');
  const known = FACILITIES[facilityLabel];
  const isOffsite = /off ?site/i.test(facilityLabel);
  const street = detail.street ?? known?.street;
  const zip = isOffsite ? undefined : (detail.zip ?? known?.zip);
  const venueName = known?.name ?? (isOffsite ? '' : facilityLabel);

  const location = venueName
    ? [venueName, street, `Asheville, NC${zip ? ` ${zip}` : ''}`].filter(Boolean).join(', ')
    : 'Asheville, NC';

  return {
    sourceId: `avlparks-${row.fmid}`,
    source: 'ASHEVILLE_PARKS_REC',
    title: row.title,
    description: buildDescription(row, detail, sessions),
    startDate,
    location,
    zip,
    organizer: known?.name ?? ORGANIZER,
    price: row.residentFee === null ? 'Unknown' : formatPrice(row.residentFee),
    url: activityUrl(row.fmid),
    timeUnknown: !row.startTime,
  };
}

/**
 * Only stable facts go in here. The scrape upsert keeps whichever description
 * is longer, so anything volatile (Open / Almost Full / next session) would stick.
 */
function buildDescription(row: ActivityRow, detail: ActivityDetail, sessions: string[]): string {
  const lines: string[] = [];
  if (detail.description) lines.push(detail.description, '');

  if (/^TR\b|therapeutic/i.test(row.title) || /therapeutic/i.test(row.category ?? '')) {
    lines.push(
      'A Therapeutic Recreation program (adaptive recreation for people with disabilities).'
    );
  }

  lines.push(describeSchedule(row, sessions));

  const ages = formatAges(row.ages);
  if (ages) lines.push(`Ages: ${ages}.`);

  const fee = describeFee(row.residentFee, row.nonResidentFee);
  if (fee) lines.push(`Fee: ${fee}.`);

  lines.push(
    `Registration through City of Asheville Parks & Recreation.${row.registrationNote ? ` ${row.registrationNote}` : ''}`
  );
  if (row.category) lines.push(`Program type: ${row.category}.`);

  return lines.join('\n').trim();
}

function describeSchedule(row: ActivityRow, sessions: string[]): string {
  const time = row.timeRange ? `, ${row.timeRange}` : '';

  if (sessions.length === 1) {
    const [date] = sessions;
    return `When: ${formatSessionDate(date, { weekday: 'short' })}, ${formatDate(date, true)}${time}.`;
  }

  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const range = `${formatDate(first, !sameYear)} - ${formatDate(last, true)}`;
  // One sample session per weekday, Monday first.
  const weekdays = [...new Map(sessions.map((s) => [toUtcDate(s).getUTCDay(), s])).entries()]
    .sort(([a], [b]) => ((a + 6) % 7) - ((b + 6) % 7))
    .map(([, session]) => formatSessionDate(session, { weekday: 'short' }));
  const days = weekdays.length <= 3 ? `${weekdays.join('/')}, ` : '';
  const listed =
    sessions.length <= LISTED_SESSION_LIMIT
      ? `: ${sessions.map((session) => formatDate(session, false)).join(', ')}`
      : '';

  return `Schedule: ${days}${range}${time} (${sessions.length} sessions${listed}).`;
}

/** "2-5.99" -> "2-5", "18-99" -> "18+", "0-100" -> "all ages". */
function formatAges(ages: string): string | undefined {
  const match = ages.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
  if (!match) return undefined;

  const low = Number(match[1]);
  const high = Number(match[2]);
  const lowText = low < 1 ? `${Math.round(low * 12)} months` : String(Math.floor(low));
  if (high >= 99) return low <= 0 ? 'all ages' : `${lowText}+`;
  return `${lowText}-${Math.floor(high)}`;
}

function describeFee(resident: number | null, nonResident: number | null): string | undefined {
  if (resident === null) return undefined;
  if (nonResident === null || nonResident === resident) {
    return resident === 0 ? 'Free' : formatMoney(resident);
  }
  const residentText = resident === 0 ? 'Free' : formatMoney(resident);
  return `${residentText} for City of Asheville residents, ${formatMoney(nonResident)} for non-residents`;
}

function formatMoney(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** "Oct 6" or "Oct 6, 2026". */
function formatDate(date: string, withYear: boolean): string {
  return formatSessionDate(date, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** Format a YYYY-MM-DD session date in Eastern time; anchored at noon, clear of the DST switch. */
function formatSessionDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return formatDateEastern(parseAsEastern(date, '12:00:00'), options);
}

function activityUrl(fmid: string): string {
  return `${WEBTRAC_BASE}/iteminfo.html?Module=AR&FMID=${fmid}`;
}

function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
