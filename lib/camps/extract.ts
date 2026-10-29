/**
 * Extraction v2 (docs/camps/04-v2-plan.md): Sol + web_search reads a provider's official pages and
 * returns one card per program, with sites, weeks, age bands and price tiers as rows inside it.
 *
 * Nothing re-checks Sol's facts. It rates its own confidence per card and per registration date;
 * the light format check below only lowers a card's confidence, never drops data.
 */

import { createHash } from 'node:crypto';
import type { CampCard, Provider, ProviderExtraction } from './contract';
import { EXTRACTION_SCHEMA } from './extractionSchema';
import { FetchPageError, type PageTextFetcher } from './fetchPageText';
import { isSocialUrl, platformOf, registrableDomain } from './platforms';
import { createResponse, type ResponsesResult } from './responses';

export interface BundlePage {
  url: string;
  text: string;
}

export interface BundleLogEntry {
  url: string;
  chars: number;
  method?: string;
  error?: string;
}

export interface SourceBundle {
  pages: BundlePage[];
  log: BundleLogEntry[];
  /** sha256 of the fetched text, so a refresh can tell when a provider's pages changed. */
  sourceHash: string | null;
}

export interface ExtractionRun {
  extraction: ProviderExtraction;
  response: Omit<ResponsesResult, 'text' | 'citations'> & { attempts: number };
  bundle: BundleLogEntry[];
  sourceHash: string | null;
}

/** One provider's file in data/camps/extractions/<key>.json. */
export interface SavedExtraction {
  provider: Provider;
  extractedAt: string;
  /** `EXTRACTION_FINGERPRINT` when it was made; "webtrac:<catalog readAt>" for the catalog path. */
  fingerprint: string;
  sourceHash: string | null;
  /** Null for the WebTrac catalog path, which makes no model call. */
  response: ExtractionRun['response'] | null;
  bundle: BundleLogEntry[] | null;
  extraction: ProviderExtraction;
}

// YMCA's four program pages are its seeds; with three, Explorer Camp was seen only via search.
const BUNDLE_SEEDS = 4;
const BUNDLE_MAX_PAGES = 8;
// Seed pages run to ~27k characters (Lutheridge's brochure, the Arboretum's camp page; 2026-10-28).
const BUNDLE_PAGE_CHARS = 30000;
const BUNDLE_TOTAL_CHARS = 80000;
const RELEVANT_LINK =
  /camp|summer|dates|rates|tuition|fees|register|registration|enroll|faq|schedule|\.pdf(?:$|\?)/i;
const PREFERRED_LINK = /dates|rates|tuition|fees|register|registration|2027/i;
const PDF_LINK = /\.pdf(?:$|\?)/i;
// Pages that never hold camp facts: accounts, carts, legal and contact pages, site-wide alerts,
// staff hiring (Rockmont's "Camp Jobs" page took a bundle slot, 2026-10-28).
const SKIP_LINK =
  /\b(?:log[- ]?in|sign[- ]?in|my[- ]?account|cart|checkout|privacy|terms|cookies?|contact|alerts?|jobs?|careers?|employment|staff)\b/i;

/**
 * A bounded source bundle: the seed pages, then the most promising same-site (or registration
 * platform) links from them, best first: PDFs and pages about dates, rates, tuition or registration
 * ahead of other camp pages, then the site's home page. Pages found that way are read for PDF links
 * once more, since a rates page often links the brochure. Web search covers everything else.
 */
export async function buildSourceBundle(
  provider: Provider,
  fetcher: PageTextFetcher
): Promise<SourceBundle> {
  const pages: BundlePage[] = [];
  const log: BundleLogEntry[] = [];
  const seen = new Set<string>();
  const seedDomains = new Set(provider.urls.map((url) => registrableDomain(url)).filter(Boolean));
  const queue: Array<{ url: string; hop: number; score: number }> = [];
  let total = 0;

  const read = async (url: string, hop: number) => {
    if (seen.has(url) || pages.length >= BUNDLE_MAX_PAGES || total >= BUNDLE_TOTAL_CHARS) return;
    seen.add(url);
    if (isSocialUrl(url)) {
      log.push({ url, chars: 0, error: 'social page: not fetched (login wall)' });
      return;
    }
    try {
      const page = await fetcher.get(url);
      seen.add(page.finalUrl);
      const text = page.text.slice(0, Math.min(BUNDLE_PAGE_CHARS, BUNDLE_TOTAL_CHARS - total));
      pages.push({ url: page.finalUrl, text });
      total += text.length;
      log.push({ url, chars: text.length, method: page.method });
      if (hop >= 2) return;
      for (const link of page.links) {
        const href = link.href.split('#')[0];
        const domain = registrableDomain(href);
        const sameSite =
          domain !== null &&
          (seedDomains.has(domain) || domain === registrableDomain(page.finalUrl));
        if (seen.has(href) || (!sameSite && !platformOf(href))) continue;
        const label = `${href} ${link.text}`;
        if (SKIP_LINK.test(label) || !RELEVANT_LINK.test(label)) continue;
        const pdf = PDF_LINK.test(href);
        if (hop === 1 && !pdf) continue;
        queue.push({
          url: href,
          hop: hop + 1,
          score: 1 + (pdf ? 2 : 0) + (PREFERRED_LINK.test(label) ? 2 : 0),
        });
      }
    } catch (error) {
      log.push({
        url,
        chars: 0,
        error: error instanceof FetchPageError ? error.attempts.join('; ') : String(error),
      });
    }
  };

  const seeds = provider.urls.slice(0, BUNDLE_SEEDS);
  for (const url of seeds) await read(url, 0);
  // The home page often carries next summer's headline dates (LEAF's "June 14 - August 13", 2027),
  // so it gets the last slot when nothing better is left.
  for (const url of seeds) {
    if (!registrableDomain(url) || platformOf(url) || isSocialUrl(url)) continue;
    queue.push({ url: `${new URL(url).origin}/`, hop: 1, score: 0 });
  }
  while (queue.length > 0 && pages.length < BUNDLE_MAX_PAGES && total < BUNDLE_TOTAL_CHARS) {
    // Best first; the sort is stable, so ties keep page order.
    queue.sort((a, b) => b.score - a.score);
    const next = queue.shift()!;
    await read(next.url, next.hop);
  }
  return { pages, log, sourceHash: hashPages(pages) };
}

/** Prefix of hashes made by `hashPages`; a stored hash without it predates the boilerplate rule. */
export const SOURCE_HASH_VERSION = 'v2:';

/**
 * The bundle's text minus lines that repeat on two or more of its pages (header, menu, footer, a
 * site-wide alert banner), so a new banner doesn't count as the camp's pages changing. A refresh
 * re-extracts on every hash change, and each re-extraction can send a confirmed camp back to review.
 */
function hashPages(pages: BundlePage[]): string | null {
  if (pages.length === 0) return null;
  const linesOf = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const pagesWithLine = new Map<string, number>();
  for (const page of pages) {
    for (const line of new Set(linesOf(page.text))) {
      pagesWithLine.set(line, (pagesWithLine.get(line) ?? 0) + 1);
    }
  }
  const hash = createHash('sha256');
  for (const page of [...pages].sort((a, b) => a.url.localeCompare(b.url))) {
    const own = linesOf(page.text).filter(
      (line) => pages.length === 1 || pagesWithLine.get(line) === 1
    );
    hash.update(`${page.url}\n${own.join('\n')}\n`);
  }
  return SOURCE_HASH_VERSION + hash.digest('hex');
}

/** The camp rule, card rule, year and registration rules and the confidence scale, for every call. */
export function extractionInstructions(today: string): string {
  return `You research kids' summer camps near Asheville, NC for AVLGO, a free local directory. Parents use it to compare camps and not miss registration dates, so a wrong fact is worse than a missing one. Today is ${today}.

Task: for the provider below, read its official pages (the text we fetched is included; search the web for anything it lacks, PDFs included) and return its summer camp programs as cards.

WHAT COUNTS AS A CAMP. Include finite, supervised youth programs in summer: day camps, half-day camps, overnight camps, evening programs, summer-only childcare programs, Vacation Bible School, short sports or skill clinics (even one day), teen pre-college programs. Exclude, and list in "excluded" with the reason: year-round classes or childcare, sports leagues or team seasons, job or employment programs, adult-only or family-only retreats, and programs outside the summer (spring break, winter break, teacher workdays).

ONE CARD PER PROGRAM. A program is what the camp itself names and describes as one offering ("Adventure Camp", "Discovery Camp"). What varies inside a program is rows, not new cards: its sites ("sites", and "site" on each row), its weeks or themes ("sessions"), its age or grade bands (rows with their own ages or grades), its price tiers ("prices": member / non-member, resident / non-resident, early bird, half day / full day, per age band). Weeks with different themes are rows of one card even when each theme has its own name, description, ages and registration link (a theater camp's "Witches of Oz" week and "Harry Potter" week), and so are the session lengths of one overnight camp (one-week, two-week, four-week sessions). Make a new card only for a different program (a different kind of activity or format: a leadership or counselor-in-training program, a dance intensive at a theater camp) or a different camp type (a day camp and an overnight camp are two cards; a half-day option of a full-day camp is a price tier). When unsure, use one card with rows. A provider with one program is one card.

ROWS. "sessions" lists each week, theme or session as the camp lists it: one row per week, or per week and site when each site lists its own weeks, or per week and age band when the bands run separately. Give a row "site" when the card has more than one site. Give a row its own ages, grades, hours, price or status only when they differ from the card's or the page states them for that row; otherwise null. The card's ages and grades span every row. When the camp lists age bands or sites but no separate weeks, give one row per band or site spanning the season's dates. When it lists none of these, "sessions" is [] and "season" holds the dates.

SITES. Each place campers are dropped off (not field-trip destinations): its name, street address, town and two-letter state. A venue name alone isn't enough for a map, so give every site's street address: the address the venue itself publishes as its location (the school's, church's, park's or the provider's own contact page or footer). When the camp's pages don't print it, search the web for it; search for the town and state too when a page omits them, and always give both with an address. When sources disagree on a venue's address, use the one the venue publishes as its location and note the other in review_notes. When the pages don't say where camp meets, "sites" is [].

PROGRAM NAMES. Parents read them: the camp's own name for the program, without the site, age band or year, and never a note to a reviewer. When the input lists "Existing programs", reuse a name exactly, character for character, for the same program, even if this year's page words it a little differently; give a new name only to a new program.

YEARS. AVLGO wants summer 2027. Use 2027 facts wherever the provider has posted them. When a field has no 2027 information, give the 2026 fact with year 2026 instead. Never relabel a 2026 fact as 2027 or project last year's dates forward. Each "year" is the summer the fact describes. When a page prints dates without a year, take the year from the page itself (its heading, the brochure's title) and say so in review_notes. When the provider has posted its 2027 program list, a program found only in its 2026 materials (an old brochure or page) is no longer offered: leave it out and mention it in notes.

SEASON. "season.year" is the summer the card's dates describe; "start" and "end" span its rows. "season.status" says whether this program's 2027 information is out: "posted" (2027 dates are on the official pages), "coming_soon" (the provider says 2027 information is coming; put its words in "season.text", e.g. "2027 dates will be posted in January"), "not_posted" (nothing about 2027 yet).

REGISTRATION. Only when the provider's own website, its registration platform, or (for a church's Vacation Bible School only) the church's own Facebook or Instagram states the date; an official page you saw only through search results counts. Never from a third-party listing, and never inferred from last year, a recurring pattern or a copyright year. Separate audiences: public, member, returning families, lottery, residents, early bird. Give "time" only when the page states a time. Use precision "month" when only a month is stated (date = the 1st of that month). certainty is "expected" for a date the provider hasn't committed to ("registration expected mid-December", "tentatively January 10"), otherwise "announced". "text" is the sentence as the page states it and "url" the page. A milestone's "year" is the summer (2027) while its "date" is the calendar date, which may fall in 2026. The 2026 season's opening (e.g. "registration opened January 12, 2026") goes in last_year_registration_opened, not in "registration".

AVAILABILITY. Only as the official site or registration platform states it now: available, mixed (some sessions full), waitlist, full, closed. Null when not stated. A row's "status" only when the page gives that row's own status.

UNKNOWN IS UNKNOWN. Do not guess, and don't fill a fact from another program or another year. Financial aid, special-needs support, lunch, transportation and extended care stay null unless a page addresses them; when one does, "value" is yes, case_by_case or no and "text" is the camp's own wording. Give ages and grades exactly as stated (both when both are stated); never convert grades to ages.

CONFIDENCE. Rate each card, and each registration milestone on its own:
- high: every key fact you give (dates, ages or grades, price, any registration date) is stated plainly on official pages for the year you label it with, and nothing conflicts.
- medium: something is inferred or only partly stated, comes from a third party or only a search snippet, or conflicts (two official pages disagree; a year not printed with the dates).
- low: mostly unclear, or the pages couldn't be read.
A fact the provider simply hasn't posted, left null, doesn't lower confidence. "review_notes" says exactly what a reviewer should check and where ("The PDF says June 8, the camp page June 15"); null when confidence is high.

DESCRIPTION. One or two plain sentences on what campers do, from the official pages. No praise, no marketing language.

FORMATS. Dates YYYY-MM-DD. Times 24-hour HH:MM, Eastern. Prices in dollars per the stated unit; a starting price ("from $798", "starting at $300") is still a price, labeled "from". Ages in years; grades as numbers (pre-K -1, kindergarten 0, 1st grade 1 ... 12th grade 12). Plain text in every field: no citation links or markdown. "sources" lists the official pages the card was read from.`;
}

/** Identifies the prompt and schema a file was made with; a change re-extracts on the next run. */
export const EXTRACTION_FINGERPRINT = createHash('sha256')
  .update(extractionInstructions('{today}'))
  .update(JSON.stringify(EXTRACTION_SCHEMA))
  .digest('hex');

export function extractionInput(
  provider: Provider,
  bundle: BundlePage[],
  existingPrograms: string[]
): string {
  const lines = [`Provider: ${provider.name}`];
  if (provider.urls.length > 0)
    lines.push(`Known pages:\n${provider.urls.map((url) => `- ${url}`).join('\n')}`);
  lines.push(`Area: ${provider.area ?? 'Asheville, NC area'}`);
  if (provider.hint) lines.push(`Note: ${provider.hint}`);
  if (existingPrograms.length > 0) {
    lines.push(
      `Existing programs (from our last extraction):\n${existingPrograms.map((name) => `- ${name}`).join('\n')}`
    );
  }
  if (bundle.length > 0) {
    lines.push(
      "PAGES WE FETCHED. The current text of these official pages, read by our own crawler; you don't need to open them again. Search the web for anything they lack (other pages, PDFs, 2027 updates, site addresses)."
    );
    for (const page of bundle) lines.push(`----- ${page.url}\n${page.text}`);
    lines.push('----- end of fetched pages');
  }
  return lines.join('\n');
}

export async function extractProvider(
  provider: Provider,
  today: string,
  options: { fetcher: PageTextFetcher; existingPrograms?: string[] }
): Promise<ExtractionRun> {
  const bundle = await buildSourceBundle(provider, options.fetcher);
  const input = extractionInput(provider, bundle.pages, options.existingPrograms ?? []);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await createResponse({
      instructions: extractionInstructions(today),
      input,
      webSearch: true,
      effort: 'low',
      jsonSchema: { name: 'camp_extraction', schema: EXTRACTION_SCHEMA },
      maxOutputTokens: 50000,
    });
    try {
      if (result.status !== 'completed') throw new Error(`response status ${result.status}`);
      const parsed = JSON.parse(result.text) as ProviderExtraction;
      const { text: _text, citations: _citations, ...response } = result;
      void _text;
      void _citations;
      return {
        extraction: checkExtraction(cleanExtraction(parsed)),
        response: { ...response, attempts: attempt },
        bundle: bundle.log,
        sourceHash: bundle.sourceHash,
      };
    } catch (error) {
      lastError = new Error(
        `Unparseable extraction (${result.status}, ${result.text.length} chars): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Format check: a malformed date or time, a range upside down, an age outside 2-19 or a row at a
// site the card doesn't list. Nothing is dropped; the card goes to review with a note.
// ---------------------------------------------------------------------------

const MAX_LISTED_PROBLEMS = 5;

export function checkExtraction(extraction: ProviderExtraction): ProviderExtraction {
  return { ...extraction, cards: extraction.cards.map(checkCard) };
}

function checkCard(card: CampCard): CampCard {
  const problems = cardProblems(card);
  if (problems.length === 0) return card;
  const listed = problems.slice(0, MAX_LISTED_PROBLEMS).join('; ');
  const more = problems.length - MAX_LISTED_PROBLEMS;
  const note = `Format check: ${listed}${more > 0 ? ` (and ${more} more)` : ''}.`;
  return {
    ...card,
    confidence: card.confidence === 'high' ? 'medium' : card.confidence,
    review_notes: card.review_notes ? `${card.review_notes} ${note}` : note,
  };
}

function cardProblems(card: CampCard): string[] {
  const problems: string[] = [];
  const date = (value: string | null | undefined, field: string) => {
    if (value != null && !isCalendarDate(value)) problems.push(`${field} "${value}" isn't a date`);
  };
  const time = (value: string | null | undefined, field: string) => {
    if (value != null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
      problems.push(`${field} "${value}" isn't HH:MM`);
  };
  const span = (start: string | null, end: string | null, field: string) => {
    if (start && end && isCalendarDate(start) && isCalendarDate(end) && start > end)
      problems.push(`${field} ends before it starts`);
  };
  const range = (
    value: { min: number | null; max: number | null } | null,
    field: string,
    low: number,
    high: number
  ) => {
    if (!value) return;
    const { min, max } = value;
    if (min !== null && max !== null && min > max) problems.push(`${field} ${min}-${max} reversed`);
    for (const bound of [min, max]) {
      if (bound !== null && (bound < low || bound > high))
        problems.push(`${field} ${bound} outside ${low}-${high}`);
    }
  };

  date(card.season.start, 'season start');
  date(card.season.end, 'season end');
  span(card.season.start, card.season.end, 'season');
  range(card.ages, 'ages', 2, 19);
  range(card.grades, 'grades', -1, 12);
  time(card.hours?.start, 'hours start');
  time(card.hours?.end, 'hours end');
  time(card.extended_care?.early_dropoff_start, 'early drop-off');
  time(card.extended_care?.late_pickup_end, 'late pickup');

  const siteNames = new Set(card.sites.map((site) => site.name));
  card.sessions.forEach((row, index) => {
    const field = `row ${index + 1}${row.label ? ` (${row.label})` : ''}`;
    date(row.start, `${field} start`);
    date(row.end, `${field} end`);
    span(row.start, row.end, field);
    range(row.ages, `${field} ages`, 2, 19);
    range(row.grades, `${field} grades`, -1, 12);
    time(row.hours?.start, `${field} start time`);
    time(row.hours?.end, `${field} end time`);
    if (row.site !== null && !siteNames.has(row.site))
      problems.push(`${field} site "${row.site}" isn't one of the card's sites`);
  });

  for (const milestone of card.registration) {
    const field = `${milestone.audience} ${milestone.kind}`;
    date(milestone.date, `${field} date`);
    time(milestone.time, `${field} time`);
  }
  date(card.last_year_registration_opened?.date, "last year's opening");
  time(card.last_year_registration_opened?.time, "last year's opening time");
  return problems;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------
// Cleaning: the model decorates strings even under a strict schema (2026-10-28 probe:
// `"June 27 - July 23" ([rockmont.com](https://...))` inside a quote).
// ---------------------------------------------------------------------------

const CITATION_MARKDOWN = /\s*\(\[[^\]]*\]\([^)]*\)\)/g;
const BARE_MARKDOWN_LINK = /\[([^\]]*)\]\((https?:[^)]*)\)/g;

export function cleanExtraction(extraction: ProviderExtraction): ProviderExtraction {
  return cleanValue(extraction, '') as ProviderExtraction;
}

function cleanValue(value: unknown, key: string): unknown {
  if (typeof value === 'string') return cleanString(value, key);
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, cleanValue(child, childKey)])
    );
  }
  return value;
}

function cleanString(value: string, key: string): string {
  let text = value.replace(CITATION_MARKDOWN, '').replace(BARE_MARKDOWN_LINK, '$1').trim();
  if (key === 'url' || key.endsWith('_url') || key === 'sources') return cleanUrl(text);
  if (key === 'text') {
    // Wrapping quotation marks the model adds (but not ones that are part of the page text).
    const wrapped = text.match(/^[“"'‘]([\s\S]*)[”"'’]$/);
    if (wrapped && !/[“”"]/.test(wrapped[1])) text = wrapped[1].trim();
  }
  return text;
}

/** Drop tracking parameters (web search appends utm_source=openai). */
export function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const param of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(param)) parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
