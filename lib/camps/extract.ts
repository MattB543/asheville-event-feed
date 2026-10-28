/**
 * Extraction: Sol + web_search reads a provider's official pages and returns its camp cards, every
 * fact with a source URL, a verbatim quote and the summer it applies to. The quotes are checked
 * afterwards by `verify.ts`; nothing here is trusted on its own.
 */

import { FetchPageError, type PageTextFetcher } from './fetchPageText';
import { isSocialUrl, platformOf, registrableDomain } from './platforms';
import { createResponse, type ResponsesResult } from './responses';
import { EXTRACTION_SCHEMA, type Extraction } from './types';

export interface ProviderInput {
  key: string;
  name: string;
  urls: string[];
  area?: string;
  /** Context a discovery step would know, e.g. a Facebook event URL from our own feed. */
  hint?: string;
}

/** 'search': Sol + web_search alone. 'bundle': the same, plus our own fetched text of the seed pages. */
export type ExtractionMode = 'search' | 'bundle';

export interface BundlePage {
  url: string;
  text: string;
}

export interface ExtractionRun {
  mode: ExtractionMode;
  extraction: Extraction;
  response: Omit<ResponsesResult, 'text'>;
  attempts: number;
  bundle?: Array<{ url: string; chars: number; method?: string; error?: string }>;
}

const BUNDLE_MAX_PAGES = 6;
const BUNDLE_PAGE_CHARS = 14000;
const BUNDLE_TOTAL_CHARS = 48000;
const RELEVANT_LINK =
  /camp|summer|dates|rates|tuition|fees|register|registration|enroll|faq|schedule|\.pdf(?:$|\?)/i;
const PREFERRED_LINK = /dates|rates|tuition|fees|register|registration|\.pdf(?:$|\?)|2027/i;

/**
 * A bounded source bundle (Codex review §5): the seed pages, then up to a few same-site links from
 * them that look like camp, rates, registration or PDF pages. Text we fetched ourselves, so a quote
 * taken from it is on the page by construction; web search still covers everything else.
 */
export async function buildSourceBundle(
  provider: ProviderInput,
  fetcher: PageTextFetcher
): Promise<{ pages: BundlePage[]; log: NonNullable<ExtractionRun['bundle']> }> {
  const pages: BundlePage[] = [];
  const log: NonNullable<ExtractionRun['bundle']> = [];
  const queued = new Set<string>();
  const seedDomains = new Set(provider.urls.map((url) => registrableDomain(url)).filter(Boolean));
  const followups: Array<{ href: string; score: number }> = [];
  let total = 0;

  const add = async (url: string, collectLinks: boolean) => {
    if (queued.has(url) || pages.length >= BUNDLE_MAX_PAGES || total >= BUNDLE_TOTAL_CHARS) return;
    queued.add(url);
    if (isSocialUrl(url)) {
      log.push({ url, chars: 0, error: 'social page: not fetched (login wall)' });
      return;
    }
    try {
      const page = await fetcher.get(url);
      const text = page.text.slice(0, Math.min(BUNDLE_PAGE_CHARS, BUNDLE_TOTAL_CHARS - total));
      pages.push({ url: page.finalUrl, text });
      total += text.length;
      log.push({ url, chars: text.length, method: page.method });
      if (!collectLinks) return;
      for (const link of page.links) {
        const domain = registrableDomain(link.href);
        const sameSite =
          domain !== null &&
          (seedDomains.has(domain) || domain === registrableDomain(page.finalUrl));
        if (!sameSite && !platformOf(link.href)) continue;
        const label = `${link.href} ${link.text}`;
        if (!RELEVANT_LINK.test(label)) continue;
        followups.push({
          href: link.href.split('#')[0],
          score: PREFERRED_LINK.test(label) ? 2 : 1,
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

  for (const url of provider.urls.slice(0, 3)) await add(url, true);
  followups.sort((a, b) => b.score - a.score);
  for (const { href } of followups) await add(href, false);
  return { pages, log };
}

/** The camp rule (plan N8), card rule (D5/N4) and evidence rules, in one place for every call. */
export function extractionInstructions(today: string): string {
  return `You research kids' summer camps near Asheville, NC for AVLGO, a free local directory. Parents use it to compare camps and not miss registration dates, so a wrong fact is worse than a missing one. Today is ${today}.

Task: for the provider below, find its official pages (search the web; PDFs count) and return each summer camp offering as a card, with evidence for every fact.

WHAT COUNTS AS A CAMP. Include finite, supervised youth programs in summer: day camps, half-day camps, overnight camps, evening programs, summer-only childcare programs, Vacation Bible School, short sports or skill clinics (even one day), teen pre-college programs. Exclude, and list in "excluded" with the reason: year-round classes or childcare, sports leagues or team seasons, job or employment programs, adult-only or family-only retreats, and programs outside the summer (spring break, winter break, teacher workdays).

CARDS. One card per distinct offering. Make separate cards when the program differs, when eligibility (ages or grades) differs, or when the attendance site differs. Keep price tiers (member / non-member, resident / non-resident, early bird, half day / full day / extended care) on ONE card as several prices. Keep a program's themed weeks on one card and list them in sessions. A provider with one program is one card.

YEARS. AVLGO wants summer 2027. Use 2027 facts wherever the provider has posted them. When a field has no 2027 information, give the 2026 fact with year 2026 instead. Never relabel a 2026 fact as 2027 or project last year's dates forward. Each fact's "year" is the summer it describes. Registration for summer 2027 can open in 2026: a milestone's "year" is the summer (2027) while its "date" is the calendar date.

REGISTRATION MILESTONES. Only when the provider's own website, its registration platform, or (for a church's Vacation Bible School only) the church's own Facebook or Instagram post states the date. Never from a third-party listing or a search snippet, and never inferred from last year, a recurring pattern or a copyright year. Separate audiences: public, member, returning families, lottery, residents, early bird. Give "time" only when the page states a time. Use precision "month" when only a month is stated (date = the 1st of that month). An opening date for the 2026 season (e.g. "registration opened January 12") goes in last_year_registration_opened with year 2026, not in registration_milestones.

AVAILABILITY. Only as the official site or registration platform states it now: available, mixed (some sessions full), waitlist, full, closed. Null when not stated.

EVIDENCE. Every fact needs "url", the exact page or PDF where it appears, and "quote", text copied character-for-character from that page: short (one line, sentence or table row) and containing the value. Our own crawler re-opens every cited URL afterwards and drops any fact whose quote is not on that page word for word, so you do not need to confirm a page yourself: if you can't open a page, you may cite it with the exact wording its search result showed. Never invent or reword text. Do not shorten with "...", add quotation marks, or put citation links or commentary in any field. If you have no exact wording for a fact, leave it null (or out of the list). Use source_kind "third_party" only when nothing official states the fact, and never for registration milestones.

UNKNOWN IS UNKNOWN. Do not guess. Financial aid, special-needs support, lunch, transportation and extended care stay null unless a page addresses them. Give ages and grades exactly as stated (both when both are stated); never convert grades to ages.

DESCRIPTION. One or two plain sentences on what campers do, from the official pages. No praise, no marketing language.

FORMATS. Times are 24-hour HH:MM (Eastern). Dates are YYYY-MM-DD. Prices are dollars per the stated unit.`;
}

export function extractionInput(provider: ProviderInput, bundle: BundlePage[] = []): string {
  const lines = [`Provider: ${provider.name}`];
  if (provider.urls.length > 0)
    lines.push(`Known pages:\n${provider.urls.map((url) => `- ${url}`).join('\n')}`);
  lines.push(`Area: ${provider.area ?? 'Asheville, NC area'}`);
  if (provider.hint) lines.push(`Note: ${provider.hint}`);
  if (bundle.length > 0) {
    lines.push(
      'PAGES WE FETCHED. The current text of these official pages, read by our own crawler. Quote from them exactly; search the web for anything they lack (other pages, PDFs, 2027 updates).'
    );
    for (const page of bundle) lines.push(`----- ${page.url}\n${page.text}`);
    lines.push('----- end of fetched pages');
  }
  return lines.join('\n');
}

export async function extractProvider(
  provider: ProviderInput,
  today: string,
  options: { mode: ExtractionMode; fetcher?: PageTextFetcher } = { mode: 'search' }
): Promise<ExtractionRun> {
  let bundle: Awaited<ReturnType<typeof buildSourceBundle>> | null = null;
  if (options.mode === 'bundle') {
    if (!options.fetcher) throw new Error('bundle mode needs a fetcher');
    bundle = await buildSourceBundle(provider, options.fetcher);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await createResponse({
      instructions: extractionInstructions(today),
      input: extractionInput(provider, bundle?.pages ?? []),
      webSearch: true,
      effort: 'low',
      jsonSchema: { name: 'camp_extraction', schema: EXTRACTION_SCHEMA },
      maxOutputTokens: 40000,
    });
    try {
      if (result.status !== 'completed') throw new Error(`response status ${result.status}`);
      const extraction = cleanExtraction(JSON.parse(result.text) as Extraction);
      const { text: _text, ...response } = result;
      void _text;
      return { mode: options.mode, extraction, response, attempts: attempt, bundle: bundle?.log };
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
// Cleaning: the model decorates strings even under a strict schema (2026-10-28 probe:
// `"June 27 - July 23" ([rockmont.com](https://...))` inside a quote).
// ---------------------------------------------------------------------------

const CITATION_MARKDOWN = /\s*\(\[[^\]]*\]\([^)]*\)\)/g;
const BARE_MARKDOWN_LINK = /\[([^\]]*)\]\((https?:[^)]*)\)/g;

export function cleanExtraction(extraction: Extraction): Extraction {
  return cleanValue(extraction, '') as Extraction;
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
  if (key === 'url' || key.endsWith('_url')) return cleanUrl(text);
  if (key === 'quote') {
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
