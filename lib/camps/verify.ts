/**
 * Verification: re-fetch every cited page with our own fetcher and check each quote is on it.
 *
 *   verified  the quote is on the cited page and the value and year agree with it
 *   review    the quote is on the page but something disagrees (value missing from the quote, a
 *             different year), the page couldn't be fetched (it may be a block, not a fabrication),
 *             or it is a church's Facebook post (plan N9: labeled and checked by hand)
 *   dropped   the quote isn't on the page, or a registration date came from anywhere but the
 *             camp's own site or its registration platform
 *
 * Every registration milestone also carries `needs_hand_check` until a person has looked (N15).
 */

import { FetchPageError, type PageText, type PageTextFetcher } from './fetchPageText';
import { hostOf, isSocialUrl, platformOf, registrableDomain } from './platforms';
import {
  LIST_EVIDENCE_FIELDS,
  SINGLE_EVIDENCE_FIELDS,
  type Check,
  type CheckStatus,
  type Evidence,
  type ExtractedCard,
  type Extraction,
} from './types';

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
  platformHosts?: string[];
  byField: Record<string, FieldTally>;
  totals: FieldTally;
  pages: Array<{ url: string; ok: boolean; method?: string; kind?: string; error?: string }>;
}

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

  const authority = await collectAuthority(extraction, context.seedUrls, page);
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
    platformHosts: [...authority.platformHosts].sort(),
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

export interface Authority {
  /** Registrable domains that are the provider's own. */
  ownDomains: Set<string>;
  /** Registration-platform hosts the provider's own pages link to (a tenant, in effect). */
  platformHosts: Set<string>;
}

/**
 * Which sources speak for the provider. Anchored in the seed pages (from discovery, not from the
 * model being checked): their domains, where they redirect, and what they link to. A domain the
 * model names counts only when a seed page links to it (Lutheridge's seed links its new
 * novusway.org site). A platform host counts only when an own page links to it, so a quote from
 * some other tenant of the same platform can't set a registration date.
 */
async function collectAuthority(
  extraction: Extraction,
  seedUrls: string[],
  page: (url: string) => Promise<PageText | FetchPageError>
): Promise<Authority> {
  const ownDomains = new Set<string>();
  const platformHosts = new Set<string>();
  const linkedDomains = new Set<string>();
  const usable = (url: string) => {
    const domain = registrableDomain(url);
    return domain && !AGGREGATOR_DOMAINS.has(domain) && !platformOf(url) && !isSocialUrl(url)
      ? domain
      : null;
  };

  for (const url of seedUrls) {
    if (platformOf(url)) platformHosts.add(hostOf(url) ?? '');
    const domain = usable(url);
    if (domain) ownDomains.add(domain);
    const result = await page(url);
    if (result instanceof FetchPageError) continue;
    const finalDomain = usable(result.finalUrl);
    if (finalDomain) ownDomains.add(finalDomain);
    for (const link of result.links) {
      if (platformOf(link.href)) platformHosts.add(hostOf(link.href) ?? '');
      const linked = usable(link.href);
      if (linked) linkedDomains.add(linked);
    }
  }

  for (const url of [
    extraction.website_url,
    ...extraction.cards.map((card) => card.camp_page_url),
  ]) {
    const domain = url ? usable(url) : null;
    if (domain && linkedDomains.has(domain)) ownDomains.add(domain);
  }
  platformHosts.delete('');
  return { ownDomains, platformHosts };
}

async function checkEvidence(
  field: string,
  evidence: Evidence,
  card: ExtractedCard,
  authority: Authority,
  page: (url: string) => Promise<PageText | FetchPageError>,
  checkedAt: string
): Promise<Check> {
  const flags: string[] = [];
  const domain = registrableDomain(evidence.url);
  const isOwn = !!domain && authority.ownDomains.has(domain);
  const platform = platformOf(evidence.url);
  const social = isSocialUrl(evidence.url);
  const isMilestone = field === 'registration_milestones';

  if (!domain) return done('dropped', 'not_checked', ['bad_url']);
  if (domain && AGGREGATOR_DOMAINS.has(domain)) flags.push('third_party_source');
  else if (!isOwn && !platform && !social) flags.push('unrecognized_domain');
  if (platform && !authority.platformHosts.has(hostOf(evidence.url) ?? '')) {
    flags.push('platform_not_linked_from_own_page');
  }
  // Ownership of a social page isn't established by anything we can fetch (plan N9).
  if (social) flags.push('social_source_hand_check');

  // Registration dates: own site or registration platform; a church's own social post for VBS.
  if (isMilestone) {
    flags.push('needs_hand_check');
    if (social && card.type !== 'vbs') {
      return done('dropped', 'not_checked', [...flags, 'registration_source_not_official']);
    }
    if (!social && !isOwn && !platform) {
      return done('dropped', 'not_checked', [...flags, 'registration_source_not_official']);
    }
  }

  flags.push(...valueFlags(field, evidence), ...yearFlags(field, evidence));

  const result = await page(evidence.url);
  if (result instanceof FetchPageError) {
    if (social) return done('review', 'hand_check', [...flags, 'social_source_hand_check']);
    return done('review', 'fetch_failed', [...flags, 'fetch_failed']);
  }

  const match = findQuote(result.text, evidence.quote);
  if (match === 'not_found') {
    return done('dropped', 'not_found', [...flags, 'quote_not_on_page'], result.method);
  }
  if (isMilestone) flags.push(...milestoneContextFlags(evidence, result.text));

  // A quote with no year in it ("June 22-26") takes its year from the page; a page that never
  // mentions that year can't be what made it a 2027 fact. A stated weekday that fits the date
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
  return done(reviewFlags.length > 0 ? 'review' : 'verified', match, flags, result.method);

  function done(
    status: CheckStatus,
    how: Check['match'],
    allFlags: string[],
    fetchMethod?: string
  ): Check {
    return { status, match: how, flags: [...new Set(allFlags)], checkedAt, fetchMethod };
  }
}

// ---------------------------------------------------------------------------
// Quote matching
// ---------------------------------------------------------------------------

export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[​-‍﻿­]/g, '')
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loose(text: string): string {
  return normalizeForMatch(text).replace(/[^a-z0-9$]/g, '');
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

  const parts = wanted
    .split(/\.{3}|…/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
  if (parts.length > 1) {
    // In order and close together: fragments from different sections prove nothing.
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
  }

  const looseWanted = loose(quote);
  if (looseWanted.length >= 8 && loose(pageText).includes(looseWanted)) return 'loose';
  return 'not_found';
}

// ---------------------------------------------------------------------------
// Value and year checks: is the stated value actually in the quote?
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

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
    if (!timeInQuote(value, quote)) flags.push(`value_not_in_quote:${label}`);
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
  }
  return flags;
}

function dateInQuote(date: string, quote: string, monthOnly: boolean): boolean {
  const [, monthText, dayText] = date.split('-');
  const month = Number(monthText);
  const day = Number(dayText);
  const monthName = MONTHS[month - 1];
  const hasMonthName = new RegExp(`\\b${monthName}`).test(quote);
  if (monthOnly) return hasMonthName || new RegExp(`\\b0?${month}/`).test(quote);

  const numeric = new RegExp(`\\b0?${month}[/.-]0?${day}\\b`).test(quote);
  // Also covers "June 15-19", where the end day appears without its month.
  const named = hasMonthName && new RegExp(`\\b0?${day}(?:st|nd|rd|th)?\\b`).test(quote);
  return numeric || named;
}

/**
 * Every time of day the quote states, as 24h "HH:MM". "6:00 PM" and "9am" are exact; "8:30-4:30"
 * (no am/pm) could be either half of the day, so both readings count; a bare number ("October 6")
 * is never a time.
 */
export function timesInQuote(quote: string): Set<string> {
  const times = new Set<string>();
  const pad = (hour: number, minute: string) => `${String(hour).padStart(2, '0')}:${minute}`;
  if (/\bnoon\b/i.test(quote)) times.add('12:00');
  if (/\bmidnight\b/i.test(quote)) times.add('00:00');
  const pattern = /(?<![\d:])(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?!\d)/gi;
  for (const match of quote.matchAll(pattern)) {
    const hour = Number(match[1]);
    const minute = match[2] ?? '00';
    const meridiem = match[3]?.toLowerCase().replace(/[^ap]/g, '');
    if (hour > 23 || Number(minute) > 59) continue;
    if (meridiem) {
      if (hour < 1 || hour > 12) continue;
      times.add(pad((hour % 12) + (meridiem === 'p' ? 12 : 0), minute));
    } else if (match[2]) {
      times.add(pad(hour, minute));
      if (hour < 12) times.add(pad(hour + 12, minute));
    }
  }
  return times;
}

function timeInQuote(time: string, quote: string): boolean {
  const [hour, minute] = time.split(':');
  return timesInQuote(quote).has(`${hour.padStart(2, '0')}:${minute}`);
}

function numberInQuote(value: number, quote: string): boolean {
  const digits = quote.replace(/(\d),(\d{3})/g, '$1$2');
  const whole = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return new RegExp(`(?<![\\d.])${whole.replace('.', '\\.')}(?:\\.00)?(?!\\d)`).test(digits);
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_WINDOW = 16;

/**
 * When the quote names weekdays, the fact's first date must fall on one of them. A match is
 * evidence for the year (weekdays shift every year); a mismatch usually means a date moved to the
 * wrong year.
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

  // Only weekdays written next to this date's day number count: "June 7-11 Mon - Fri" yes,
  // "July 13 - 17 (optional overnight - Thursday evening)" no.
  const quote = normalizeForMatch(evidence.quote);
  const day = Number(date.slice(8, 10));
  const dayAt = [...quote.matchAll(new RegExp(`(?<!\\d)0?${day}(?!\\d)`, 'g'))].map(
    (match) => match.index ?? 0
  );
  const named = new Set(
    [...quote.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|rs|s)?\b/g)]
      .filter((match) => dayAt.some((at) => Math.abs((match.index ?? 0) - at) <= WEEKDAY_WINDOW))
      .map((match) => match[1])
  );
  if (named.size === 0) return null;
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return named.has(weekday) ? 'weekday_supports_year' : `weekday_mismatch:${weekday}`;
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
      // The calendar year itself, not just one the season allows: "October 6, 2026" can't be
      // 2027-10-06 even though a 2027 season permits either year (Codex pilot review).
      if (quoteYears.length > 0 && !quoteYears.includes(year)) {
        flags.push(`date_year_not_in_quote:${key}`);
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Registration milestones: does the text around the quote support the audience and the action?
// Heuristic review flags; every milestone is hand-checked before launch anyway (N15).
// ---------------------------------------------------------------------------

const RESTRICTED_AUDIENCE =
  /\b(returning|current (?:camper )?famil|members?\b|priority|alumni|waitlist|wait list|residents?\b|lottery|early.bird|staff)/;
// "all returning families" is not an open audience.
const OPEN_AUDIENCE =
  /\b(?:(?:all|everyone|anyone|general|public)\b(?! (?:returning|current|members?|priority|level|d\d))|new (?:camper )?famil|all others)/;
const AUDIENCE_WORDS: Record<string, RegExp> = {
  member: /\bmembers?\b/,
  returning:
    /\breturning|current (?:camper )?famil|previous|last (?:summer|year)|alumni|re-?enroll|attended/,
  lottery: /\blottery|application/,
  resident: /\bresidents?\b/,
  early_bird: /\bearly/,
};
const KIND_WORDS: Record<string, RegExp> = {
  opens:
    /\b(open|opens|opening|begin|begins|start|starts|available|launch|register|registration|enroll|sign.up)/,
  deadline:
    /\b(deadline|due|no later than|before|closes|closed|last day|(?:register|apply|enroll|sign up) by)\b/,
  closes: /\b(close|closes|closed|ends|until|last day)\b/,
  lottery_results: /\b(lottery|results|notif|notified|selected)/,
};

const TENTATIVE_WORDING =
  /\b(expect|expected|expects|tentative|tentatively|anticipat\w*|plan to|plans to|estimated|approximately|should open|likely|hope to|mid-)/;

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
  const flags: string[] = [];

  if (audience === 'public') {
    // A "public" date whose surroundings only talk about a restricted group.
    if (RESTRICTED_AUDIENCE.test(context) && !OPEN_AUDIENCE.test(context)) {
      flags.push('audience_context_conflict');
    }
  } else if (AUDIENCE_WORDS[audience] && !AUDIENCE_WORDS[audience].test(above)) {
    flags.push('audience_not_in_context');
  }
  if (KIND_WORDS[kind] && !KIND_WORDS[kind].test(context)) flags.push('kind_not_in_context');
  // "Registration is expected to open in mid-December": not a date anyone can set an alarm for.
  if (TENTATIVE_WORDING.test(quote)) flags.push('tentative_wording');
  return flags;
}

export function hostLabel(url: string): string {
  return hostOf(url) ?? url;
}
