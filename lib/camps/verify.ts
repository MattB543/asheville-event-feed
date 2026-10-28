/**
 * Verification: re-fetch every cited page with our own fetcher and check each quote is on it.
 *
 *   verified  the quote is on the cited page and the value and year agree with it
 *   review    the quote is on the page but something disagrees (value missing from the quote, a
 *             different year), the page couldn't be fetched (it may be a block, not a fabrication),
 *             or it is a church's Facebook post (plan N9: labeled and checked by hand)
 *   dropped   the quote isn't on the page, or a registration date came from anywhere but the
 *             camp's own site or its own registration-platform account
 *
 * Every registration milestone also carries `needs_hand_check`: it is shown as settled only after a
 * person has looked (N15), whatever its status here.
 */

import { FetchPageError, type PageText, type PageTextFetcher } from './fetchPageText';
import { isSocialUrl, platformOf, platformTenant, registrableDomain } from './platforms';
import {
  LIST_EVIDENCE_FIELDS,
  SINGLE_EVIDENCE_FIELDS,
  type Check,
  type CheckStatus,
  type Evidence,
  type ExtractedCard,
  type Extraction,
} from './types';
import { isTentativeWording } from './wording';

/** Listing sites: fine for discovery, never an official source (plan §2.1, §6.1). */
const AGGREGATOR_DOMAINS = new Set([
  'allevents.in',
  'macaronikid.com',
  'kidvoyage.com',
  'campsearch.com',
  'asheville.com',
  'exploreasheville.com',
  '6amcity.com',
  'avltoday.com',
  'happeningnext.com',
  'mountainx.com',
  '828newsnow.com',
  'activityhero.com',
  'acacamps.org',
  'avlgo.com',
  'yelp.com',
  'riverartsdistrict.com',
]);

/** Facts that differ from summer to summer, so their year label needs support from the page. */
const YEAR_SENSITIVE_FIELDS = new Set([
  'season_dates',
  'prices',
  'fees',
  'hours',
  'extended_care',
  'registration_milestones',
  'availability',
  'last_year_registration_opened',
]);

/** Flags that don't send a fact to review on their own. */
const INFORMATIONAL_FLAGS = new Set(['needs_hand_check', 'weekday_supports_year']);

export interface VerifyContext {
  fetcher: PageTextFetcher;
  /** Seed URLs for the provider, to anchor which domains are its own. */
  seedUrls: string[];
  /** Domains a person confirmed are the provider's own (a moved site: Lutheridge -> novusway.org). */
  reviewedDomains?: string[];
  now?: Date;
}

export interface FieldTally {
  total: number;
  verified: number;
  review: number;
  dropped: number;
}

export interface VerifyReport {
  ownDomains: string[];
  platformTenants?: string[];
  byField: Record<string, FieldTally>;
  totals: FieldTally;
  pages: Array<{ url: string; ok: boolean; method?: string; kind?: string; error?: string }>;
}

type PageReader = (url: string) => Promise<PageText | FetchPageError>;

export async function verifyExtraction(
  extraction: Extraction,
  context: VerifyContext
): Promise<VerifyReport> {
  const now = (context.now ?? new Date()).toISOString();
  const pages = new Map<string, PageText | FetchPageError>();

  async function page(url: string): Promise<PageText | FetchPageError> {
    let result = pages.get(url);
    if (!result) {
      try {
        result = await context.fetcher.get(url);
      } catch (error) {
        result = error instanceof FetchPageError ? error : new FetchPageError(url, [String(error)]);
      }
      pages.set(url, result);
    }
    return result;
  }

  const authority = await collectAuthority(
    extraction,
    context.seedUrls,
    context.reviewedDomains ?? [],
    page
  );
  const byField: Record<string, FieldTally> = {};
  const totals: FieldTally = { total: 0, verified: 0, review: 0, dropped: 0 };

  for (const card of extraction.cards) {
    for (const { field, evidence } of evidenceItems(card)) {
      const check = await checkEvidence(field, evidence, card, authority, page, now);
      evidence.check = check;
      const tally = (byField[field] ??= { total: 0, verified: 0, review: 0, dropped: 0 });
      tally.total++;
      tally[check.status]++;
      totals.total++;
      totals[check.status]++;
    }
  }

  return {
    ownDomains: [...authority.ownDomains].sort(),
    platformTenants: [...authority.platformTenants].sort(),
    byField,
    totals,
    pages: [...pages.entries()].map(([url, result]) =>
      result instanceof FetchPageError
        ? { url, ok: false, error: result.attempts.join('; ') }
        : { url, ok: true, method: result.method, kind: result.kind }
    ),
  };
}

export function evidenceItems(card: ExtractedCard): Array<{ field: string; evidence: Evidence }> {
  const items: Array<{ field: string; evidence: Evidence }> = [];
  for (const field of SINGLE_EVIDENCE_FIELDS) {
    const evidence = card[field];
    if (evidence) items.push({ field, evidence });
  }
  for (const field of LIST_EVIDENCE_FIELDS) {
    for (const evidence of card[field]) items.push({ field, evidence });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Authority: which sources speak for the provider
// ---------------------------------------------------------------------------

interface Authority {
  /** Registrable domains that are the provider's own: seeds, their redirects, reviewed domains. */
  ownDomains: Set<string>;
  /** The provider website the model named, linked from an own seed but not yet reviewed. */
  linkedDomains: Set<string>;
  /** Registration-platform accounts (`platformTenant`) the provider's own pages link to. */
  platformTenants: Set<string>;
}

type SourceClass = 'own' | 'linked' | 'platform' | 'social' | 'aggregator' | 'unrecognized' | 'bad';

/** A domain that isn't a listing site, a platform or a social network. */
function siteDomain(url: string): string | null {
  const domain = registrableDomain(url);
  return domain && !AGGREGATOR_DOMAINS.has(domain) && !platformOf(url) && !isSocialUrl(url)
    ? domain
    : null;
}

/**
 * Anchored in the seed pages (from discovery, not from the model being checked): their domains,
 * where they redirect, and the platform accounts they link to. A seed that turns out to be, or to
 * land on, a listing or social page extends nothing. The provider website the model names counts
 * only when an own seed links to it, and even then its facts wait for review until a person
 * confirms the domain (providers.json `domains`): a linked sponsor looks the same as a moved site.
 */
async function collectAuthority(
  extraction: Extraction,
  seedUrls: string[],
  reviewedDomains: string[],
  page: PageReader
): Promise<Authority> {
  const ownDomains = new Set<string>(reviewedDomains);
  const platformTenants = new Set<string>();
  const seedLinks = new Set<string>();

  for (const url of seedUrls) {
    const tenant = platformTenant(url);
    const domain = siteDomain(url);
    if (!tenant && !domain) continue;
    const result = await page(url);
    if (result instanceof FetchPageError) {
      if (tenant) platformTenants.add(tenant);
      if (domain) ownDomains.add(domain);
      continue;
    }
    // Judge the seed by where it landed, too.
    const landedTenant = platformTenant(result.finalUrl);
    const landedDomain = siteDomain(result.finalUrl);
    if (!landedTenant && !landedDomain) continue;
    // Not the account a seed redirects to: Ryzer event 123 forwarding to 999 says nothing about 999.
    if (tenant) platformTenants.add(tenant);
    if (domain) ownDomains.add(domain);
    if (domain && landedDomain) ownDomains.add(landedDomain);
    for (const link of result.links) {
      const linkedTenant = platformTenant(link.href);
      if (linkedTenant) platformTenants.add(linkedTenant);
      const linked = siteDomain(link.href);
      if (linked) seedLinks.add(linked);
    }
  }

  const linkedDomains = new Set<string>();
  const website = extraction.website_url ? siteDomain(extraction.website_url) : null;
  if (website && !ownDomains.has(website) && seedLinks.has(website)) linkedDomains.add(website);
  return { ownDomains, linkedDomains, platformTenants };
}

function classify(url: string, authority: Authority): SourceClass {
  const domain = registrableDomain(url);
  if (!domain) return 'bad';
  if (AGGREGATOR_DOMAINS.has(domain)) return 'aggregator';
  if (isSocialUrl(url)) return 'social';
  if (platformOf(url)) return 'platform';
  if (authority.ownDomains.has(domain)) return 'own';
  return authority.linkedDomains.has(domain) ? 'linked' : 'unrecognized';
}

/** Flags for a source, and whether a registration date may come from it. */
function sourceFlags(
  url: string,
  authority: Authority,
  card: ExtractedCard
): { flags: string[]; officialForRegistration: boolean } {
  const kind = classify(url, authority);
  const flags: string[] = [];
  if (kind === 'aggregator') flags.push('third_party_source');
  if (kind === 'unrecognized') flags.push('unrecognized_domain');
  if (kind === 'linked') flags.push('domain_not_reviewed');
  // Ownership of a social page isn't established by anything we can fetch (plan N9).
  if (kind === 'social') flags.push('social_source_hand_check');
  // An account we can't identify (no tenant pattern for that host) is never linked.
  const tenant = platformTenant(url);
  const linkedAccount = kind === 'platform' && !!tenant && authority.platformTenants.has(tenant);
  if (kind === 'platform' && !linkedAccount) flags.push('platform_tenant_not_linked');
  return {
    flags,
    officialForRegistration:
      kind === 'own' ||
      kind === 'linked' ||
      kind === 'platform' ||
      (kind === 'social' && card.type === 'vbs'),
  };
}

// ---------------------------------------------------------------------------
// One fact
// ---------------------------------------------------------------------------

async function checkEvidence(
  field: string,
  evidence: Evidence,
  card: ExtractedCard,
  authority: Authority,
  page: PageReader,
  checkedAt: string
): Promise<Check> {
  const isMilestone = field === 'registration_milestones';
  if (classify(evidence.url, authority) === 'bad') {
    return done('dropped', 'not_checked', ['bad_url']);
  }

  const source = sourceFlags(evidence.url, authority, card);
  const flags = [...source.flags];
  if (isMilestone) {
    flags.push('needs_hand_check');
    if (!source.officialForRegistration) {
      return done('dropped', 'not_checked', [...flags, 'registration_source_not_official']);
    }
  }
  flags.push(...valueFlags(field, evidence), ...yearFlags(field, evidence));

  const result = await page(evidence.url);
  if (result instanceof FetchPageError) {
    return isSocialUrl(evidence.url)
      ? done('review', 'hand_check', flags)
      : done('review', 'fetch_failed', [...flags, 'fetch_failed']);
  }

  // Judge the page we actually read: an own-site link can redirect to a listing site, and a
  // linked platform account (Ryzer event 123) can redirect to another one (event 999).
  const resolvedUrl = result.finalUrl !== evidence.url ? result.finalUrl : undefined;
  if (
    resolvedUrl &&
    (registrableDomain(resolvedUrl) !== registrableDomain(evidence.url) ||
      platformTenant(resolvedUrl) !== platformTenant(evidence.url))
  ) {
    const landed = sourceFlags(resolvedUrl, authority, card);
    flags.push(...landed.flags, 'redirected');
    if (isMilestone && !landed.officialForRegistration) {
      return done(
        'dropped',
        'not_checked',
        [...flags, 'registration_source_not_official'],
        result.method,
        resolvedUrl
      );
    }
  }

  const match = findQuote(result.text, evidence.quote);
  if (match === 'not_found') {
    return done(
      'dropped',
      'not_found',
      [...flags, 'quote_not_on_page'],
      result.method,
      resolvedUrl
    );
  }
  if (isMilestone) flags.push(...milestoneContextFlags(evidence, result.text));

  // A quote with no year in it ("June 22-26") takes its year from the page; a page that never
  // mentions that year can't be what made it a 2027 fact. A weekday written next to the date
  // ("June 7-11 Mon - Fri" is only Mon-Fri in 2027) settles the year on its own.
  const weekday = weekdayCheck(field, evidence);
  if (weekday) flags.push(weekday);
  if (
    YEAR_SENSITIVE_FIELDS.has(field) &&
    weekday !== 'weekday_supports_year' &&
    !/\b20[2-3]\d\b/.test(evidence.quote)
  ) {
    const pageYears = new Set(
      [...result.text.matchAll(/\b(20[2-3]\d)\b/g)].map((m) => Number(m[1]))
    );
    const allowed = isMilestone ? [evidence.year, evidence.year - 1] : [evidence.year];
    if (!allowed.some((year) => pageYears.has(year))) flags.push('year_not_on_page');
  }

  const reviewFlags = flags.filter((flag) => !INFORMATIONAL_FLAGS.has(flag));
  return done(
    reviewFlags.length > 0 ? 'review' : 'verified',
    match,
    flags,
    result.method,
    resolvedUrl
  );

  function done(
    status: CheckStatus,
    how: Check['match'],
    allFlags: string[],
    fetchMethod?: string,
    resolvedUrl?: string
  ): Check {
    return {
      status,
      match: how,
      flags: [...new Set(allFlags)],
      checkedAt,
      fetchMethod,
      ...(resolvedUrl ? { resolvedUrl } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Quote matching
// ---------------------------------------------------------------------------

export function normalizeForMatch(text: string): string {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      // Zero-width characters, incl. the word joiner Lutheridge puts after dashes ("June 13–⁠18")
      .replace(/[​-‍⁠﻿­]/g, '')
      .replace(/[‘’‚‛′`]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐‑‒–—―−]/g, '-')
      .replace(/[*_#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Letters and digits only, for PDF text that lost its spacing. Thousands commas go, but a decimal
 * point stays, so "$1499" never matches "$14.99".
 */
function loose(text: string): string {
  return normalizeForMatch(text)
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d)\.(?=\d)/g, '$1§')
    .replace(/[^a-z0-9$§]/g, '');
}

const MAX_ELLIPSIS_GAP = 400;

export function findQuote(
  pageText: string,
  quote: string
): 'exact' | 'fragments' | 'loose' | 'not_found' {
  const page = normalizeForMatch(pageText);
  const wanted = normalizeForMatch(quote).replace(/^[\s.,;:"'-]+|[\s.,;:"'-]+$/g, '');
  if (wanted.length < 4) return 'not_found';
  if (page.includes(wanted)) return 'exact';

  // Every fragment around an ellipsis must be there, in order and close together.
  const parts = wanted
    .split(/\.{3}|…/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    let start = -1;
    let from = 0;
    const inOrder = parts.every((part) => {
      const at = page.indexOf(part, from);
      if (at < 0) return false;
      if (start < 0) start = at;
      from = at + part.length;
      return true;
    });
    if (inOrder && from - start <= wanted.length + MAX_ELLIPSIS_GAP) return 'fragments';
    return 'not_found';
  }

  const looseWanted = loose(quote);
  if (looseWanted.length >= 8 && loose(pageText).includes(looseWanted)) return 'loose';
  return 'not_found';
}

// ---------------------------------------------------------------------------
// Value checks: is the stated value actually in the quote?
// ---------------------------------------------------------------------------

function valueFlags(field: string, evidence: Evidence): string[] {
  const quote = normalizeForMatch(evidence.quote);
  const record = evidence as unknown as Record<string, unknown>;
  const flags: string[] = [];

  const checkDate = (value: unknown, label: string, monthOnly = false) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    if (!dateInQuote(value, quote, monthOnly)) flags.push(`value_not_in_quote:${label}`);
  };
  const checkTime = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) return;
    if (!timesInQuote(quote).has(value.padStart(5, '0'))) flags.push(`value_not_in_quote:${label}`);
  };
  const checkNumber = (value: unknown, label: string) => {
    if (typeof value !== 'number') return;
    if (!numberInQuote(value, quote)) flags.push(`value_not_in_quote:${label}`);
  };

  switch (field) {
    case 'season_dates':
      checkDate(record.start, 'start');
      checkDate(record.end, 'end');
      break;
    case 'registration_milestones':
    case 'last_year_registration_opened':
      checkDate(record.date, 'date', record.precision === 'month');
      checkTime(record.time, 'time');
      // A registration time with no am/pm in the quote is a guess, even when it matches a reading.
      if (typeof record.time === 'string' && !/\b(?:[ap]\.?\s?m\b|noon|midnight)/.test(quote)) {
        flags.push('time_ambiguous');
      }
      break;
    case 'hours':
      checkTime(record.start, 'start');
      checkTime(record.end, 'end');
      break;
    case 'extended_care':
      checkTime(record.early_dropoff_start, 'early_dropoff_start');
      checkTime(record.late_pickup_end, 'late_pickup_end');
      break;
    case 'prices':
    case 'fees':
      checkNumber(record.amount, 'amount');
      break;
    case 'ages':
      checkNumber(record.min, 'min');
      checkNumber(record.max, 'max');
      break;
    case 'grades':
      flags.push(...gradeFlags(record as { min: unknown; max: unknown; basis: unknown }, quote));
      break;
  }
  return flags;
}

// --- Dates: month, day and year read together, as one expression -----------------------------

const MONTH_PATTERN =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const MONTH_KEYS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])';
const YEAR = '(?:,?\\s*(20\\d{2}))?';

interface DateExpression {
  month: number;
  day: number;
  year: number | null;
  index: number;
}

function monthNumber(name: string): number {
  return MONTH_KEYS.indexOf(name.slice(0, 3)) + 1;
}

/**
 * Every date the quote writes, with the year written beside it (if any): "October 6, 2026",
 * "June 15-19" (both days), "June 29 - July 3, 2026" (the year carries back over the dash),
 * "Wed, 24 Jun, 2026", "06/15/2026".
 */
export function dateExpressions(quote: string): DateExpression[] {
  const found: DateExpression[] = [];
  const monthFirst = new RegExp(
    `\\b${MONTH_PATTERN}\\s+${DAY}(?:\\s*(?:-|to|through|thru)\\s*${DAY})?${YEAR}`,
    'g'
  );
  for (const match of quote.matchAll(monthFirst)) {
    const month = monthNumber(match[1]);
    const year = match[4] ? Number(match[4]) : null;
    found.push({ month, day: Number(match[2]), year, index: match.index ?? 0 });
    if (match[3]) found.push({ month, day: Number(match[3]), year, index: (match.index ?? 0) + 1 });
  }
  const dayFirst = new RegExp(`(?<![\\d/])${DAY}\\s+${MONTH_PATTERN}${YEAR}`, 'g');
  for (const match of quote.matchAll(dayFirst)) {
    found.push({
      month: monthNumber(match[2]),
      day: Number(match[1]),
      year: match[3] ? Number(match[3]) : null,
      index: match.index ?? 0,
    });
  }
  for (const match of quote.matchAll(
    /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/])/g
  )) {
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : null;
    found.push({ month: Number(match[1]), day: Number(match[2]), year, index: match.index ?? 0 });
  }

  for (const match of quote.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    found.push({
      month: Number(match[2]),
      day: Number(match[3]),
      year: Number(match[1]),
      index: match.index ?? 0,
    });
  }

  // "June 29 - July 3, 2026": a yearless date just before a dated one, across a dash, shares it.
  found.sort((a, b) => a.index - b.index);
  for (let i = found.length - 2; i >= 0; i--) {
    const next = found[i + 1];
    const between = quote.slice(found[i].index, next.index);
    if (
      found[i].year === null &&
      next.year !== null &&
      /-|\bto\b|through/.test(between) &&
      between.length <= 20
    ) {
      found[i].year = next.year;
    }
  }
  return found.filter(
    (date) => date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= 31
  );
}

function dateInQuote(date: string, quote: string, monthOnly: boolean): boolean {
  const [year, month, day] = date.split('-').map(Number);
  if (monthOnly) {
    // A full date carries its own year ("opens October 6, 2026" is not October 2027); a month
    // mentioned without a day can carry one right after it ("opens October 2027"). Either may match.
    const fullDate = dateExpressions(quote).some(
      (e) => e.month === month && (e.year === null || e.year === year)
    );
    const monthOnly = new RegExp(
      `\\b${MONTH_PATTERN}(?![a-z])(?!\\s+\\d{1,2}(?:st|nd|rd|th)?(?![\\d:]))(?:\\s+(20\\d{2}))?`,
      'g'
    );
    return (
      fullDate ||
      [...quote.matchAll(monthOnly)].some(
        (match) => monthNumber(match[1]) === month && (!match[2] || Number(match[2]) === year)
      )
    );
  }
  return dateExpressions(quote).some(
    (expression) =>
      expression.month === month &&
      expression.day === day &&
      (expression.year === null || expression.year === year)
  );
}

// --- Times ------------------------------------------------------------------------------------

const TIME = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)?';

function to24(hour: number, minute: string, meridiem: string): string {
  return `${String((hour % 12) + (meridiem === 'p' ? 12 : 0)).padStart(2, '0')}:${minute}`;
}

/**
 * Every time of day the quote states, as 24h "HH:MM". Amounts ("$7.00") and bare numbers
 * ("October 6") are never times. In a range one am/pm covers both ends ("9:00-11:00 AM", and
 * "11-1 pm" starts at 11 am); a range with no am/pm that runs backwards ("8:30-4:30") is a camp day,
 * morning to afternoon. A single time with no am/pm could be either, so both readings count.
 */
export function timesInQuote(quote: string): Set<string> {
  const times = new Set<string>();
  const text = quote.toLowerCase().replace(/\$\s*\d[\d,]*(?:\.\d+)?/g, ' ');
  if (/\bnoon\b/.test(text)) times.add('12:00');
  if (/\bmidnight\b/.test(text)) times.add('00:00');
  const meridiemOf = (value: string | undefined) => value?.replace(/[^ap]/g, '') || null;
  const consumed: Array<[number, number]> = [];

  const range = new RegExp(`(?<![\\d:.])${TIME}\\s*(?:-|to|until)\\s*${TIME}(?![\\d])`, 'g');
  for (const match of text.matchAll(range)) {
    const [h1, m1, h2, m2] = [Number(match[1]), match[2], Number(match[4]), match[5]];
    let [mer1, mer2] = [meridiemOf(match[3]), meridiemOf(match[6])];
    // "15-19" is a date range, not a time range.
    if (!mer1 && !mer2 && !m1 && !m2) continue;
    if (h1 > 12 || h2 > 12 || h1 < 1 || h2 < 1) continue;
    const minutes = (hour: number, minute: string | undefined, mer: string) =>
      ((hour % 12) + (mer === 'p' ? 12 : 0)) * 60 + Number(minute ?? 0);
    if (mer2 && !mer1) mer1 = minutes(h1, m1, mer2) > minutes(h2, m2, mer2) ? 'a' : mer2;
    if (mer1 && !mer2) mer2 = minutes(h2, m2, mer1) < minutes(h1, m1, mer1) ? 'p' : mer1;
    // A backwards unlabeled range is a camp day; one starting at 12 starts at noon ("12:30-4:30").
    if (!mer1 && !mer2 && h1 > h2) [mer1, mer2] = [h1 === 12 ? 'p' : 'a', 'p'];
    if (mer1 && mer2) {
      times.add(to24(h1, m1 ?? '00', mer1));
      times.add(to24(h2, m2 ?? '00', mer2));
      consumed.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    }
  }

  const single = new RegExp(`(?<![\\d:.])${TIME}(?![\\d])`, 'g');
  for (const match of text.matchAll(single)) {
    const at = match.index ?? 0;
    if (consumed.some(([start, end]) => at >= start && at < end)) continue;
    const hour = Number(match[1]);
    const minute = match[2] ?? '00';
    const meridiem = meridiemOf(match[3]);
    if (hour > 23 || Number(minute) > 59) continue;
    if (meridiem) {
      if (hour >= 1 && hour <= 12) times.add(to24(hour, minute, meridiem));
    } else if (match[2]) {
      times.add(`${String(hour).padStart(2, '0')}:${minute}`);
      if (hour < 12) times.add(`${String(hour + 12).padStart(2, '0')}:${minute}`);
    }
  }
  return times;
}

// --- Amounts and grades -----------------------------------------------------------------------

/** The whole amount: $300 is not $300.50, and $14.99 is not $1499. */
function numberInQuote(value: number, quote: string): boolean {
  const digits = quote.replace(/(\d),(\d{3})/g, '$1$2');
  const whole = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return new RegExp(`(?<![\\d.])${whole.replace('.', '\\.')}(?:\\.00)?(?!\\d|\\.\\d)`).test(digits);
}

const GRADE_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  freshmen: 9,
  freshman: 9,
  sophomores: 10,
  sophomore: 10,
  juniors: 11,
  junior: 11,
  seniors: 12,
  senior: 12,
};

/** Grade numbers the quote names: Pre-K -1, K 0, "3rd", "third", "grades 3-5". */
function gradesInQuote(quote: string): Set<number> {
  const grades = new Set<number>();
  if (/\bpre-?k\b|pre-?kindergarten|preschool/.test(quote)) grades.add(-1);
  if (/(?<!pre-?)\bk(?:inder(?:garten)?)?\b/.test(quote)) grades.add(0);
  // No word boundary before the digit: page text runs a name into its grades ("Climb High4th-6th").
  for (const match of quote.matchAll(/(?<!\d)(\d{1,2})(?:st|nd|rd|th)\b/g))
    grades.add(Number(match[1]));
  for (const match of quote.matchAll(
    /\bgrades?\s+(\d{1,2})(?:\s*(?:-|to|through)\s*(\d{1,2}))?/g
  )) {
    grades.add(Number(match[1]));
    if (match[2]) grades.add(Number(match[2]));
  }
  // "K-5", "kindergarten through 5th", "pre-k-2"
  for (const match of quote.matchAll(
    /\b(?:pre-?k|k|kinder(?:garten)?)\s*(?:-|to|through)\s*(\d{1,2})/g
  )) {
    grades.add(Number(match[1]));
  }
  for (const [word, grade] of Object.entries(GRADE_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(quote)) grades.add(grade);
  }
  return grades;
}

const RISING = /\b(rising|entering|going into|will be in)\b/;
const CURRENT =
  /\b(currently in (?:grades?|k|kindergarten|\d)|current grades?|in grades? [\dk][\w\s-]* (?:this|during the) (?:school year|20\d{2}))\b/;
const COMPLETED =
  /\b(completed|completing|finished|have finished|who've completed|who have completed)\b/;

/** Both grade bounds must be in the quote, and the quote must say rising or completed as stated. */
function gradeFlags(
  grades: { min: unknown; max: unknown; basis: unknown },
  quote: string
): string[] {
  const flags: string[] = [];
  const named = gradesInQuote(quote);
  if (typeof grades.min === 'number' && !named.has(grades.min))
    flags.push('value_not_in_quote:grade_min');
  if (typeof grades.max === 'number' && !named.has(grades.max))
    flags.push('value_not_in_quote:grade_max');
  const saysRising = RISING.test(quote);
  const saysCompleted = COMPLETED.test(quote);
  if (grades.basis === 'rising' && !saysRising) flags.push('grade_basis_not_in_quote');
  if (grades.basis === 'completed' && !saysCompleted) flags.push('grade_basis_not_in_quote');
  if (grades.basis === 'current' && !CURRENT.test(quote)) flags.push('grade_basis_not_in_quote');
  if (
    (saysRising && grades.basis !== 'rising') ||
    (saysCompleted && grades.basis !== 'completed')
  ) {
    flags.push('grade_basis_conflict');
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Year checks
// ---------------------------------------------------------------------------

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_WINDOW = 20;

/**
 * When a weekday is written right next to the fact's first date, that date must fall on it. The
 * nearest weekday is the one that belongs to the date: in "June 12-16 Mon-Fri" the 12th is a
 * Monday, so a Friday start is a mismatch. A match is evidence for the year (weekdays shift every
 * year); a mismatch usually means a date moved to the wrong year.
 */
function weekdayCheck(field: string, evidence: Evidence): string | null {
  const record = evidence as unknown as Record<string, unknown>;
  const date =
    field === 'season_dates'
      ? record.start
      : field === 'registration_milestones' || field === 'last_year_registration_opened'
        ? record.date
        : null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (record.precision === 'month') return null;

  const quote = normalizeForMatch(evidence.quote);
  const [, month, day] = date.split('-').map(Number);
  const expression = dateExpressions(quote).find((e) => e.month === month && e.day === day);
  if (!expression) return null;

  const weekdays = [
    ...quote.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|rs|s)?\b/g),
  ].map((match) => ({
    weekday: match[1],
    distance: Math.abs((match.index ?? 0) - expression.index),
  }));
  const nearest = weekdays.sort((a, b) => a.distance - b.distance)[0];
  if (!nearest || nearest.distance > WEEKDAY_WINDOW) return null;

  const actual = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return nearest.weekday === actual ? 'weekday_supports_year' : `weekday_mismatch:${actual}`;
}

function yearFlags(field: string, evidence: Evidence): string[] {
  const flags: string[] = [];
  const isMilestone = field === 'registration_milestones';
  // A 2027 milestone can be dated 2026; a 2026 "last year" opening can be dated 2025.
  const okYears = new Set(
    isMilestone || field === 'last_year_registration_opened'
      ? [evidence.year, evidence.year - 1]
      : [evidence.year]
  );

  const quoteYears = [...evidence.quote.matchAll(/\b(20[2-3]\d)\b/g)].map((match) =>
    Number(match[1])
  );
  if (quoteYears.length > 0 && !quoteYears.some((year) => okYears.has(year))) {
    flags.push('year_mismatch_quote');
  }

  const urlYears = [...(evidence.url.match(/(?<!\d)(20[2-3]\d)(?!\d)/g) ?? [])].map(Number);
  if (urlYears.length > 0 && !urlYears.some((year) => okYears.has(year))) {
    flags.push('year_mismatch_url');
  }

  const record = evidence as unknown as Record<string, unknown>;
  for (const key of ['date', 'start', 'end']) {
    const value = record[key];
    if (typeof value === 'string' && /^\d{4}-/.test(value)) {
      const year = Number(value.slice(0, 4));
      if (!okYears.has(year)) flags.push(`date_year_${year}_vs_${evidence.year}`);
      // When the quote names years, the date's own year must be one of them: "2026 registration
      // opens October 6" can't be 2027-10-06, even though a 2027 season allows dates in 2026.
      if (quoteYears.length > 0 && !quoteYears.includes(year)) {
        flags.push(`date_year_not_in_quote:${key}`);
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Registration milestones: does the statement around the quote support the audience, the action
// and a firm date? Heuristic review flags; every milestone is hand-checked anyway (N15).
// ---------------------------------------------------------------------------

const RESTRICTED_AUDIENCE =
  /\b(returning|current (?:camper )?famil|members?\b|priority|alumni|waitlist|wait list|residents?\b|lottery|early.bird|staff)/;
/** Words that describe everyone being allowed to register ("all programs" doesn't). */
const OPEN_AUDIENCE =
  /\b(?:all (?:new )?(?:camper )?(?:families|campers|children|kids|participants|students|others)(?! (?:returning|who|from|that|currently|enrolled|attending))|everyone|anyone|general public|open to (?:the )?public|public registration|new (?:camper )?famil\w*)\b/;
const AUDIENCE_WORDS: Record<string, RegExp> = {
  member: /\bmembers?\b/,
  returning:
    /\breturning|current (?:camper )?famil|previous|last (?:summer|year)|alumni|re-?enroll|attended/,
  lottery: /\blottery|application/,
  resident: /\bresidents?\b/,
  early_bird: /\bearly/,
};
const OPEN_WORDS =
  /\b(open|opens|opening|begin|begins|start|starts|available|launch|launches|goes live)\b/;
const DEADLINE_WORDS =
  /\b(deadline|due|no later than|closes|closed|last day|(?:register|apply|enroll|sign up) by)\b/;
const KIND_WORDS: Record<string, RegExp> = {
  opens:
    /\b(open|opens|opening|begin|begins|start|starts|available|launch|register|registration|enroll|sign.up)/,
  deadline: DEADLINE_WORDS,
  closes: /\b(close|closes|closed|ends|until|last day)\b/,
  lottery_results: /\b(lottery|results|notif|notified|selected)/,
};

/**
 * The sentence the quote sits in: from the previous full stop to the next, within reach. A quote
 * that ends its own sentence takes nothing after it. (Page text is whitespace-normalized, so a
 * heading runs into the sentence below it: "phase 1 - october 6, 2026 summer 2027 registration
 * opens ... for all returning camper families", which is the statement we want.)
 */
function statementAround(page: string, at: number, length: number): string {
  const quoted = page.slice(at, at + length);
  const before = page.slice(Math.max(0, at - 200), at);
  const start = before.lastIndexOf('. ');
  const after = /[.!?]$/.test(quoted) ? '' : page.slice(at + length, at + length + 200);
  const end = after.search(/[.!?](\s|$)/);
  return `${start >= 0 ? before.slice(start + 2) : before}${quoted}${end >= 0 ? after.slice(0, end + 1) : after}`;
}

/** The clause of the statement that holds the quote: split at semicolons and "and"/"but". */
function clauseAround(statement: string, quote: string): string {
  const clauses = statement.split(/;|,\s+(?:and|but|then)\b|\.\s/);
  return clauses.find((clause) => clause.includes(quote.slice(0, 20))) ?? statement;
}

function milestoneContextFlags(evidence: Evidence, pageText: string): string[] {
  const { audience, kind } = evidence as unknown as { audience: string; kind: string };
  const page = normalizeForMatch(pageText);
  const quote = normalizeForMatch(evidence.quote);
  const at = page.indexOf(quote.slice(0, 40));
  // The quote, the line before it and what follows (a heading's date, then its sentence).
  const context = at >= 0 ? page.slice(Math.max(0, at - 100), at + quote.length + 200) : quote;
  // A restricted audience is often named once above a list of phase times ("...all returning
  // camper families" then "6:00 PM for D3", "7:00 PM for D2"), so look further up for it.
  const above = at >= 0 ? page.slice(Math.max(0, at - 400), at + quote.length + 200) : quote;
  const statement = at >= 0 ? statementAround(page, at, quote.length) : quote;
  const flags: string[] = [];

  if (audience === 'public') {
    // A "public" date whose own statement only names a restricted group.
    if (RESTRICTED_AUDIENCE.test(statement) && !OPEN_AUDIENCE.test(statement)) {
      flags.push('audience_context_conflict');
    }
  } else if (AUDIENCE_WORDS[audience] && !AUDIENCE_WORDS[audience].test(above)) {
    flags.push('audience_not_in_context');
  }

  if (KIND_WORDS[kind] && !KIND_WORDS[kind].test(context)) flags.push('kind_not_in_context');
  // The quote's own clause says the other thing: "register by June 20" is not an opening, even
  // when only "June 20" was quoted, or when an opening shares the sentence ("opens January 10;
  // register by June 20").
  const clause = clauseAround(statement, quote);
  if (kind === 'opens' && DEADLINE_WORDS.test(clause) && !OPEN_WORDS.test(clause)) {
    flags.push('kind_conflict');
  }
  if (
    (kind === 'deadline' || kind === 'closes') &&
    OPEN_WORDS.test(clause) &&
    !DEADLINE_WORDS.test(clause)
  ) {
    flags.push('kind_conflict');
  }

  // "Registration is expected to open on October 6": the qualifier can sit outside the quote.
  if (isTentativeWording(statement)) flags.push('tentative_wording');
  return flags;
}
