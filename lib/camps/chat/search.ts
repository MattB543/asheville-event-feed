/**
 * The camps chat's search_camps and get_camp_details over every listed camp
 * (docs/camps/06-ai-chat-plan.md §4). Pure: tools.ts builds the index from queryCamps() and passes
 * one `now` per request.
 *
 * A camp matches when one witness passes every filter: one session (or, for a camp listing none,
 * its season) at one of its sites with one of its applicable price tiers. Eligibility, dates,
 * hours, price, site and session-scoped keywords are all judged on that same witness, so a cheap
 * day rate, a closer site or a July coding week can't stand in for the week and tier asked about.
 * A fact the camp doesn't state is unknown, never a pass: the witness keeps it only when the search
 * allows that unknown (includeUnknown), and missing price never means free.
 *
 * Nothing private leaves here: the hits and the public card carry no confidence, review notes,
 * sources, coordinates or DB metadata.
 */
import type {
  AgeRange,
  AvailabilityStatus,
  GradeRange,
  Hours,
  PriceTier,
} from '@/lib/camps/contract';
import {
  AVAILABILITY_LABELS,
  CATEGORY_LABELS,
  TARGET_SEASON,
  TYPE_LABELS,
  formatPrice,
  formatPriceTier,
  inTargetSeason,
  isUnconfirmed,
  kidFit,
  matchesRegistration,
  providerLabel,
  registrationLine,
  siteTown,
  supportKeys,
  toCardData,
  weeklyPrice,
  type KidFit,
  type RegistrationLine,
} from '@/lib/camps/display';
import type { CampListing, CampSiteInfo } from '@/lib/db/queries/camps';
import { SITE_URL } from '@/lib/seo/site';
import { isRecord } from '@/lib/utils/validation';
import { CARD_FIELDS, splitPath, type ArrayRoot, type FieldKind } from './fields';
import { findPlace, milesBetween, placeKey, townPoint } from './places';
import {
  CAMP_SEARCH_PAGE_SIZE,
  type CampDetailsResult,
  type CampSearchFilters,
  type CampSearchHit,
  type CampSearchResult,
  type CampSessionMatch,
  type PublicCampCard,
  type PublicCampSite,
  type PublicMilestone,
  type UnknownFact,
  type WhereClause,
} from './types';
import { parseCampSearchFilters, phraseIndex, termWords, tokenize, type Token } from './validation';

// ---------------------------------------------------------------------------
// The index: built once per load, holds no clock-dependent values
// ---------------------------------------------------------------------------

/** One searchable piece of public text, tokenized once. */
interface TextField {
  /** The card path it came from, shown with a snippet ("description", "sessions[].label"). */
  field: string;
  /** Relevance: names, type and categories 3; labels and description 2; anything else 1. */
  weight: number;
  text: string;
  tokens: Token[];
  words: string[];
}

interface IndexedSite {
  index: number;
  town: string | null;
  townKey: string | null;
  /** Whole minutes from Pack Square, as the directory's drive filter reads them. */
  drive: number | null;
  /** The site's own point, else its town's centroid (estimated); null when neither is known. */
  point: { lat: number; lng: number } | null;
  estimated: boolean;
  text: TextField[];
}

interface IndexedTier {
  tier: PriceTier;
  /** Index into card.prices; null for a session's own price. */
  card: number | null;
  /** countsAsPrice: a $0 tier beside paid ones is a scholarship or credit, not the price. */
  counts: boolean;
  /** Member, resident, sibling, early-bird ... prices: possible, not assured. */
  conditional: boolean;
  /** Labelled half day: can't stand for a full-day or workday price. */
  halfDay: boolean;
  /** An age or grade band the label states ("Ages 11-14, junior counselors"). */
  band: { ages: AgeRange | null; grades: GradeRange | null } | null;
  text: TextField[];
}

interface IndexedRow {
  /** Index into card.sessions; null for the season row of a camp listing no sessions. */
  session: number | null;
  label: string | null;
  /** Null when unknown or reversed: a bad interval is unknown, never repaired. */
  start: string | null;
  end: string | null;
  year: number | null;
  /** Inclusive days for weekly prices; a season counts only when it is two weeks or less. */
  days: number | null;
  /** A session stating either ages or grades replaces both of the card's (§2). */
  eligibility: { ages: AgeRange | null; grades: GradeRange | null };
  /** Session times over the card's, each end on its own; reversed times are unknown. */
  hours: Hours;
  /** Indexes into the camp's sites; null when unknown (none listed, or a name the card lacks). */
  sites: number[] | null;
  /** The session's own price, or else the card's tiers: never both. */
  tiers: IndexedTier[];
  status: AvailabilityStatus | null;
  text: TextField[];
}

export interface IndexedCamp {
  /** Private: read for the display helpers only, never sent anywhere. */
  listing: CampListing;
  card: PublicCampCard;
  /** Camp-wide text: holds for every row. */
  text: TextField[];
  sites: IndexedSite[];
  cardTiers: IndexedTier[];
  rows: IndexedRow[];
  /** Lists no sessions: one season row. */
  seasonOnly: boolean;
  /** That season is two weeks or less, so it is the program's own dates. */
  shortSeason: boolean;
}

export interface CampIndex {
  camps: IndexedCamp[];
  /** Every site town, as the filters name them ("Asheville", "Cleveland, SC"). */
  towns: string[];
}

const CONDITIONAL =
  /\b(?:members?|membership|non[\s-]*members?|residents?|non[\s-]*residents?|siblings?|early[\s-]*(?:bird|registration|enrollment)|(?:by|before) (?:jan|feb|mar|apr|may|jun)[a-z]*\.? \d|alumni|returning|discount(?:ed)?|scholarships?|staff|employees?|military|additional child|second child|deposit|sliding|in[\s-]*county|out[\s-]*of[\s-]*county)\b/i;
const HALF_DAY = /\bhalf[\s-]*days?\b/i;
const BAND = /\b(ages?|grades?)\s+(k|\d{1,2})\s*(?:-|–|—|to|through)\s*(\d{1,2})\b/i;

/** The age or grade band a price label states: "Ages 11-14, junior counselors", "rising grades 7–9". */
function tierBand(label: string | null): IndexedTier['band'] {
  const match = label ? BAND.exec(label) : null;
  if (!label || !match) return null;
  const min = /^k$/i.test(match[2]) ? 0 : Number(match[2]);
  const max = Number(match[3]);
  if (min > max) return null;
  if (/^age/i.test(match[1])) return { ages: { min, max }, grades: null };
  const basis = /\brising\b/i.test(label) ? 'rising' : 'unspecified';
  return { ages: null, grades: { min, max, basis } };
}

function httpUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

function textField(field: string, weight: number, text: string | null | undefined): TextField[] {
  const value = text?.trim();
  if (!value) return [];
  const tokens = tokenize(value);
  return tokens.length > 0
    ? [{ field, weight, text: value, tokens, words: tokens.map((token) => token.word) }]
    : [];
}

/** Days from start to end, both counted. */
function daySpan(start: string, end: string): number {
  return (
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5) + 1
  );
}

/** Both ends known and in order, else unknown. */
function interval(start: string | null, end: string | null) {
  return start && end && end >= start ? { start, end } : null;
}

const isBound = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A stated range with valid numbers in order, else null (unknown: may fit). */
function range<R extends AgeRange>(value: R | null): R | null {
  if (!value) return null;
  const min = isBound(value.min) ? value.min : null;
  const max = isBound(value.max) ? value.max : null;
  if (min !== null && max !== null && min > max) return null;
  return { ...value, min, max };
}

function mergeHours(own: Hours | null, card: Hours | null): Hours {
  const start = own?.start ?? card?.start ?? null;
  const end = own?.end ?? card?.end ?? null;
  return start && end && end <= start ? { start: null, end: null } : { start, end };
}

function buildPublicCard(listing: CampListing): PublicCampCard {
  const card = structuredClone(listing.card);
  const lastYear = card.last_year_registration_opened;
  return {
    name: card.name,
    provider: providerLabel(listing.providerName),
    type: card.type,
    categories: card.categories,
    description: card.description,
    camp_page_url: httpUrl(card.camp_page_url),
    registration_url: httpUrl(card.registration_url),
    season: card.season,
    ages: card.ages,
    grades: card.grades,
    sites: listing.sites.map(
      (site): PublicCampSite => ({
        name: site.name,
        address: site.address,
        town: site.town,
        state: site.state,
        driveMinutes: isBound(site.driveMinutes) ? Math.round(site.driveMinutes) : null,
        driveFromTown: site.driveFromTown === true,
      })
    ),
    hours: card.hours,
    extended_care: card.extended_care,
    prices: card.prices,
    sessions: card.sessions,
    registration: card.registration.map(
      (milestone): PublicMilestone => ({
        audience: milestone.audience,
        kind: milestone.kind,
        date: milestone.date,
        time: milestone.time,
        precision: milestone.precision,
        certainty: milestone.certainty,
        text: milestone.text,
        url: httpUrl(milestone.url) ?? '',
        year: milestone.year,
        unconfirmed: isUnconfirmed(milestone, listing.confirmed),
      })
    ),
    last_year_registration_opened: lastYear && { ...lastYear, url: httpUrl(lastYear.url) ?? '' },
    availability: card.availability,
    financial_aid: card.financial_aid,
    special_needs: card.special_needs,
    lunch: card.lunch,
    transportation: card.transportation,
  };
}

/**
 * A type or category as searched and shown: its label ("Nature & outdoors"), with the raw value
 * after it only when the label lacks its words ("Vacation Bible School (vbs)").
 */
function enumText(value: string, labels: Record<string, string>): string {
  const label = labels[value] ?? value;
  const words = termWords(label);
  return termWords(value).every((raw) => words.some((word) => word.startsWith(raw)))
    ? label
    : `${label} (${value.replace(/_/g, ' ')})`;
}

function indexSite(site: CampSiteInfo, index: number): IndexedSite {
  const town = siteTown(site);
  const own = isBound(site.lat) && isBound(site.lng) ? { lat: site.lat, lng: site.lng } : null;
  return {
    index,
    town,
    townKey: town ? placeKey(town) : null,
    drive: isBound(site.driveMinutes) ? Math.round(site.driveMinutes) : null,
    point: own ?? townPoint(site.town, site.state),
    estimated: !own,
    text: [
      ...textField('sites[].name', 1, site.name),
      ...textField('sites[].address', 1, site.address),
      ...textField('sites[].town', 1, site.town),
      ...textField('sites[].state', 1, site.state),
    ],
  };
}

function indexCamp(listing: CampListing): IndexedCamp {
  const { card } = listing;
  const publicCard = buildPublicCard(listing);
  const validTier = (tier: PriceTier | null): tier is PriceTier =>
    !!tier && isBound(tier.amount) && tier.amount >= 0;
  const paid = [...card.prices, ...card.sessions.map((session) => session.price)].some(
    (tier) => validTier(tier) && tier.amount > 0
  );
  const indexTier = (tier: PriceTier, cardIndex: number | null): IndexedTier => ({
    tier,
    card: cardIndex,
    counts: !paid || tier.amount > 0,
    conditional: CONDITIONAL.test(tier.label ?? ''),
    halfDay: HALF_DAY.test(tier.label ?? ''),
    band: tierBand(tier.label),
    text: textField(
      cardIndex === null ? 'sessions[].price.label' : 'prices[].label',
      2,
      tier.label
    ),
  });
  const cardTiers = card.prices.flatMap((tier, index) =>
    validTier(tier) ? [indexTier(tier, index)] : []
  );
  const sites = listing.sites.map(indexSite);
  const everySite = sites.length > 0 ? sites.map((site) => site.index) : null;
  const rowSites = (name: string | null) => {
    if (!name) return everySite;
    const index = listing.sites.findIndex((site) => site.name === name);
    return index >= 0 ? [index] : null;
  };
  const season = interval(card.season.start, card.season.end);
  const seasonDays = season ? daySpan(season.start, season.end) : null;

  const rows: IndexedRow[] =
    card.sessions.length > 0
      ? card.sessions.map((session, index) => {
          const dates = interval(session.start, session.end);
          const own = !!session.ages || !!session.grades;
          return {
            session: index,
            label: session.label,
            start: dates?.start ?? null,
            end: dates?.end ?? null,
            year: session.year,
            days: dates ? daySpan(dates.start, dates.end) : null,
            eligibility: own
              ? { ages: range(session.ages), grades: range(session.grades) }
              : { ages: range(card.ages), grades: range(card.grades) },
            hours: mergeHours(session.hours, card.hours),
            sites: rowSites(session.site),
            tiers: session.price
              ? validTier(session.price)
                ? [indexTier(session.price, null)]
                : []
              : cardTiers,
            status: session.status,
            text: textField('sessions[].label', 2, session.label),
          };
        })
      : [
          {
            session: null,
            label: null,
            start: season?.start ?? null,
            end: season?.end ?? null,
            year: card.season.year,
            days: seasonDays !== null && seasonDays <= 14 ? seasonDays : null,
            eligibility: { ages: range(card.ages), grades: range(card.grades) },
            hours: mergeHours(null, card.hours),
            sites: everySite,
            tiers: cardTiers,
            status: null,
            text: [],
          },
        ];

  const support = (['financial_aid', 'special_needs', 'lunch', 'transportation'] as const).flatMap(
    (key) => textField(`${key}.text`, 1, card[key]?.text)
  );
  return {
    listing,
    card: publicCard,
    text: [
      ...textField('name', 3, card.name),
      ...textField('provider', 3, publicCard.provider),
      ...textField('type', 3, enumText(card.type, TYPE_LABELS)),
      ...textField(
        'categories',
        3,
        card.categories.map((category) => enumText(category, CATEGORY_LABELS)).join(', ')
      ),
      ...textField('description', 2, card.description),
      ...textField('season.text', 1, card.season.text),
      ...textField('hours.text', 1, card.hours?.text),
      ...textField('extended_care.cost_text', 1, card.extended_care?.cost_text),
      ...card.registration.flatMap((milestone) =>
        textField('registration[].text', 1, milestone.text)
      ),
      ...textField(
        'last_year_registration_opened.text',
        1,
        card.last_year_registration_opened?.text
      ),
      ...textField('availability.scope', 1, card.availability?.scope),
      ...textField('availability.text', 1, card.availability?.text),
      ...support,
    ],
    sites,
    cardTiers,
    rows,
    seasonOnly: card.sessions.length === 0,
    shortSeason: seasonDays !== null && seasonDays <= 14,
  };
}

export function buildCampIndex(listings: CampListing[]): CampIndex {
  const camps = listings.map(indexCamp);
  const towns = new Map<string, string>();
  for (const camp of camps) {
    for (const site of camp.sites) {
      if (site.town && site.townKey && !towns.has(site.townKey)) towns.set(site.townKey, site.town);
    }
  }
  return { camps, towns: [...towns.values()].sort((a, b) => a.localeCompare(b)) };
}

// ---------------------------------------------------------------------------
// Generic `where` on the public card (§4.2)
// ---------------------------------------------------------------------------

interface Clause extends WhereClause {
  kind: FieldKind;
  root: ArrayRoot | null;
  rest: string[];
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Null, empty text or lists and objects with nothing in them are missing; 0 and false are not. */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(present);
  // A grade range's basis alone says nothing
  if (isRecord(value))
    return Object.entries(value).some(([key, item]) => key !== 'basis' && present(item));
  return false;
}

/**
 * The stored value a comparison reads, or undefined when there is nothing to compare. A
 * registration date given only as a month is no day: its synthetic 1st never compares.
 */
function comparable(clause: Clause, item: unknown): unknown {
  const value = clause.rest.length > 0 ? readPath(item, clause.rest) : item;
  if (!present(value)) return undefined;
  if (clause.path === 'registration[].date' && readPath(item, ['precision']) === 'month') {
    return undefined;
  }
  return value;
}

/** Does the stored value equal / contain / reach the clause's value (eq for ne, contains for not_contains)? */
function test(clause: Clause, value: unknown): boolean {
  const target = clause.value ?? '';
  switch (clause.kind) {
    case 'text': {
      const words = termWords(String(value));
      const term = termWords(target);
      return clause.op === 'contains' || clause.op === 'not_contains'
        ? phraseIndex(words, term) >= 0
        : words.join(' ') === term.join(' ');
    }
    case 'number': {
      const number = Number(value);
      const wanted = Number(target);
      return clause.op === 'lte'
        ? number <= wanted
        : clause.op === 'gte'
          ? number >= wanted
          : number === wanted;
    }
    case 'date':
    case 'time': {
      const text = String(value);
      return clause.op === 'lte'
        ? text <= target
        : clause.op === 'gte'
          ? text >= target
          : text === target;
    }
    default:
      return String(value) === target;
  }
}

const isNegative = (clause: WhereClause) => clause.op === 'ne' || clause.op === 'not_contains';

/** With no item to test (an empty array, or no site or card tier for this row), only `missing` holds. */
const noItem = (clauses: Clause[]) => clauses.every((clause) => clause.op === 'missing');

/** A positive clause (comparison, exists or missing) on one item. */
function holds(clause: Clause, item: unknown): boolean {
  const value = clause.rest.length > 0 ? readPath(item, clause.rest) : item;
  if (clause.op === 'exists') return present(value);
  if (clause.op === 'missing') return !present(value);
  const stored = comparable(clause, item);
  return stored !== undefined && test(clause, stored);
}

const allHold = (clauses: Clause[], item: unknown) =>
  clauses.every((clause) => holds(clause, item));

/** The items a root's clauses read: the card itself, or each array item. */
function items(card: PublicCampCard, root: ArrayRoot | null): unknown[] {
  return root === null ? [card] : (card[root] as unknown[]);
}

/**
 * ne / not_contains exclude the camp when the value appears anywhere under the path, and need a
 * stated value somewhere to compare: a missing or empty field never passes a comparison.
 */
function exclusionPasses(clause: Clause, card: PublicCampCard): boolean {
  const values = items(card, clause.root)
    .map((item) => comparable(clause, item))
    .filter((value) => value !== undefined);
  return values.length > 0 && !values.some((value) => test(clause, value));
}

// ---------------------------------------------------------------------------
// One search's prepared filters
// ---------------------------------------------------------------------------

interface Prepared {
  filters: CampSearchFilters;
  terms: string[][];
  excluded: string[][];
  kids: Array<{ age: number | null; grade: number | null }>;
  allowed: Set<UnknownFact>;
  /** Requested dates in TARGET_SEASON: earlier schedules move to the same week (inTargetSeason). */
  project: boolean;
  place: { lat: number; lng: number } | null;
  towns: Set<string> | null;
  locationActive: boolean;
  hoursActive: boolean;
  where: {
    negatives: Clause[];
    card: Clause[];
    categories: Clause[];
    registration: Clause[];
    sessions: Clause[];
    sites: Clause[];
    prices: Clause[];
  };
}

function prepare(filters: CampSearchFilters): Prepared {
  const clauses: Clause[] = (filters.where ?? []).map((clause) => ({
    ...clause,
    kind: CARD_FIELDS[clause.path].kind,
    ...splitPath(clause.path),
  }));
  const positives = (root: ArrayRoot | null) =>
    clauses.filter((clause) => !isNegative(clause) && clause.root === root);
  const year = String(TARGET_SEASON);
  return {
    filters,
    terms: (filters.keywords ?? []).map(termWords),
    excluded: (filters.excludeKeywords ?? []).map(termWords),
    kids: filters.kids ?? [],
    allowed: new Set(filters.includeUnknown ?? []),
    project:
      !!filters.dates && filters.dates.start.startsWith(year) && filters.dates.end.startsWith(year),
    place: filters.near ? findPlace(filters.near.place) : null,
    towns: filters.towns && new Set(filters.towns.map(placeKey)),
    locationActive: filters.maxDriveMinutes !== null || !!filters.near || !!filters.towns,
    hoursActive: !!(filters.dropoffBy || filters.pickupAtOrAfter || filters.dayLength),
    where: {
      negatives: clauses.filter(isNegative),
      card: positives(null),
      categories: positives('categories'),
      registration: positives('registration'),
      sessions: positives('sessions'),
      sites: positives('sites'),
      prices: positives('prices'),
    },
  };
}

// ---------------------------------------------------------------------------
// Judging one camp
// ---------------------------------------------------------------------------

type Verdict = 'pass' | 'unknown' | 'fail';

/** Per keyword, the best field it matches (highest weight), or null. */
function bestFields(fields: TextField[], terms: string[][]): Array<TextField | null> {
  return terms.map((term) => {
    let best: TextField | null = null;
    for (const field of fields) {
      if ((!best || field.weight > best.weight) && phraseIndex(field.words, term) >= 0)
        best = field;
    }
    return best;
  });
}

function heavier(...fields: Array<TextField | null | undefined>): TextField | null {
  return fields.reduce<TextField | null>(
    (best, field) => (field && (!best || field.weight > best.weight) ? field : best),
    null
  );
}

/** Every piece of public text, for the broad exclusions. */
function allText(camp: IndexedCamp): TextField[] {
  return [
    ...camp.text,
    ...camp.sites.flatMap((site) => site.text),
    ...camp.cardTiers.flatMap((tier) => tier.text),
    ...camp.rows.flatMap((row) => [...row.text, ...row.tiers.flatMap((tier) => tier.text)]),
  ];
}

/** The target-summer openings inside the window (a month overlapping it may be). */
function selectOpenings(
  card: PublicCampCard,
  window: NonNullable<CampSearchFilters['registrationOpens']>
): PublicMilestone[] {
  return card.registration.filter((milestone) => {
    if (milestone.year !== TARGET_SEASON || milestone.kind !== 'opens') return false;
    if (
      window.audience === 'public' &&
      milestone.audience !== 'public' &&
      milestone.audience !== 'lottery'
    ) {
      return false;
    }
    let first = milestone.date;
    let last = milestone.date;
    if (milestone.precision === 'month') {
      const [year, month] = milestone.date.split('-').map(Number);
      first = `${milestone.date.slice(0, 7)}-01`;
      last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }
    return !((window.from && last < window.from) || (window.to && first > window.to));
  });
}

/** What a matched date leaves to confirm: another audience's, a month, expected, unconfirmed. */
const doubt = (milestone: PublicMilestone) =>
  [
    milestone.audience !== 'public',
    milestone.precision === 'month',
    milestone.certainty === 'expected',
    milestone.unconfirmed,
  ].filter(Boolean).length;

function judgeDates(row: IndexedRow, camp: IndexedCamp, prep: Prepared) {
  const dates = prep.filters.dates;
  if (!dates) return { verdict: 'pass' as Verdict, projected: null };
  if (!row.start || !row.end) return { verdict: 'unknown' as Verdict, projected: null };
  const shift = prep.project && Number(row.start.slice(0, 4)) < TARGET_SEASON;
  const start = shift ? inTargetSeason(row.start) : row.start;
  const end = shift ? inTargetSeason(row.end) : row.end;
  const projected = shift ? { start, end } : null;
  if (dates.match === 'overlaps') {
    return {
      verdict: (start <= dates.end && end >= dates.start ? 'pass' : 'fail') as Verdict,
      projected,
    };
  }
  if (start > dates.start || end < dates.end) return { verdict: 'fail' as Verdict, projected };
  // A whole summer's envelope doesn't show the camp runs every day of the range
  const verdict: Verdict = row.session === null && !camp.shortSeason ? 'unknown' : 'pass';
  return { verdict, projected };
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * One end of the day (display.ts coversWorkday, with the asked-for time): met when any stated time
 * meets it; short when the times that could meet it are all stated and none does; else unknown.
 */
function endpoint(
  base: string | null,
  care: string | null,
  hasCare: boolean,
  meets: (time: string) => boolean
): { met: boolean | null; byCare: boolean } {
  if (base && meets(base)) return { met: true, byCare: false };
  if (care && meets(care)) return { met: true, byCare: true };
  return { met: base && (!hasCare || care) ? false : null, byCare: false };
}

function judgeHours(row: IndexedRow, camp: IndexedCamp, prep: Prepared) {
  const { dropoffBy, pickupAtOrAfter, dayLength } = prep.filters;
  if (!prep.hoursActive) return { verdict: 'pass' as Verdict, byCare: false };
  if (camp.card.type === 'overnight') return { verdict: 'fail' as Verdict, byCare: false };
  const care = camp.listing.card.extended_care;
  const tests: Array<boolean | null> = [];
  let byCare = false;
  if (dropoffBy) {
    const end = endpoint(
      row.hours.start,
      care?.early_dropoff_start ?? null,
      !!care,
      (t) => t <= dropoffBy
    );
    tests.push(end.met);
    byCare ||= end.byCare;
  }
  if (pickupAtOrAfter) {
    const end = endpoint(
      row.hours.end,
      care?.late_pickup_end ?? null,
      !!care,
      (t) => t >= pickupAtOrAfter
    );
    tests.push(end.met);
    byCare ||= end.byCare;
  }
  if (dayLength) {
    const { start, end } = row.hours;
    const length =
      start && end
        ? minutesOf(end) - minutesOf(start) >= 300
          ? 'full'
          : 'half'
        : camp.card.type === 'half_day'
          ? 'half'
          : null;
    tests.push(length === null ? null : length === dayLength);
  }
  const verdict: Verdict = tests.includes(false)
    ? 'fail'
    : tests.includes(null)
      ? 'unknown'
      : 'pass';
  return { verdict, byCare };
}

interface SiteJudgement {
  verdict: Verdict;
  distance: { miles: number; estimated: boolean } | null;
  match: Array<TextField | null>;
}

function judgeSite(site: IndexedSite | null, camp: IndexedCamp, prep: Prepared): SiteJudgement {
  const { maxDriveMinutes } = prep.filters;
  const match = site ? bestFields(site.text, prep.terms) : prep.terms.map(() => null);
  if (
    prep.where.sites.length > 0 &&
    !(site ? allHold(prep.where.sites, camp.card.sites[site.index]) : noItem(prep.where.sites))
  ) {
    return { verdict: 'fail', distance: null, match };
  }
  if (!prep.locationActive) return { verdict: 'pass', distance: null, match };
  if (!site) return { verdict: 'unknown', distance: null, match };
  const tests: Array<boolean | null> = [];
  if (maxDriveMinutes !== null)
    tests.push(site.drive === null ? null : site.drive <= maxDriveMinutes);
  let distance: SiteJudgement['distance'] = null;
  if (prep.place && prep.filters.near) {
    if (site.point) {
      const miles = milesBetween(prep.place, site.point);
      distance = { miles: Math.round(miles * 10) / 10, estimated: site.estimated };
      tests.push(miles <= prep.filters.near.maxMiles);
    } else tests.push(null);
  }
  if (prep.towns) tests.push(site.townKey === null ? null : prep.towns.has(site.townKey));
  const verdict: Verdict = tests.includes(false)
    ? 'fail'
    : tests.includes(null)
      ? 'unknown'
      : 'pass';
  return { verdict, distance, match };
}

/**
 * A price as the filter compares it. Per week: weeklyPrice over the row's own days (a summer-long
 * season never spreads a session price). Per session: a stated session amount, or a program's for
 * a camp listing no sessions; week, day and month prices never become invented session totals.
 */
function comparedPrice(
  tier: IndexedTier,
  row: IndexedRow,
  camp: IndexedCamp,
  per: 'week' | 'session'
) {
  if (per === 'week') return weeklyPrice(tier.tier, row.days);
  if (tier.tier.unit === 'session') return tier.tier.amount;
  return tier.tier.unit === 'program' && camp.seasonOnly ? tier.tier.amount : null;
}

interface TierOption {
  tier: IndexedTier | null;
  compared: number | null;
  unknown: boolean;
}

/** The stated hours are a full day (5+ hours). */
const fullDayHours = ({ start, end }: Hours) =>
  !!start && !!end && minutesOf(end) - minutesOf(start) >= 300;

/**
 * Can a half-day price stand for the hours asked? Not for a full day. For a pickup time only when
 * the stated hours are themselves a half day ending no earlier: a half-day price beside full-day
 * hours doesn't say when its half day ends, or even that it is the morning. A drop-off time alone
 * it can serve (a half day 8-noon with drop-off by 9).
 */
function halfDayCovers(row: IndexedRow, prep: Prepared): boolean {
  const { dayLength, pickupAtOrAfter } = prep.filters;
  if (dayLength === 'full') return false;
  if (!pickupAtOrAfter) return true;
  const { start, end } = row.hours;
  if (!start || !end || fullDayHours(row.hours)) return false;
  return minutesOf(pickupAtOrAfter) <= minutesOf(end);
}

/** The row's tiers that can stand as its price; null when the stated prices all fail. */
function tierOptions(row: IndexedRow, camp: IndexedCamp, prep: Prepared): TierOption[] | null {
  const price = prep.filters.price;
  const halfDay = halfDayCovers(row, prep);
  const tiers = row.tiers.filter((tier) => halfDay || !tier.halfDay);
  let options: TierOption[];
  if (!price) options = tiers.map((tier) => ({ tier, compared: null, unknown: false }));
  else {
    const counted = tiers.filter((tier) => tier.counts);
    const comparable = counted.flatMap((tier) => {
      const compared = comparedPrice(tier, row, camp, price.per);
      return compared === null ? [] : [{ tier, compared, unknown: false }];
    });
    if (comparable.length > 0) {
      options = comparable.filter(
        ({ compared }) =>
          (price.min === null || compared >= price.min) &&
          (price.max === null || compared <= price.max)
      );
      if (options.length === 0) return null;
    } else {
      // No price in that unit: unknown, but each tier keeps its label for keywords and `where`
      options = counted.map((tier) => ({ tier, compared: null, unknown: true }));
    }
  }
  if (options.length === 0) options = [{ tier: null, compared: null, unknown: !!price }];
  if (prep.where.prices.length > 0) {
    options = options.filter(({ tier }) =>
      tier?.card != null
        ? allHold(prep.where.prices, camp.card.prices[tier.card])
        : noItem(prep.where.prices)
    );
    if (options.length === 0) return null;
  }
  return options;
}

interface Witness {
  row: IndexedRow;
  site: IndexedSite | null;
  tier: IndexedTier | null;
  compared: number | null;
  distance: SiteJudgement['distance'];
  projected: { start: string; end: string } | null;
  byCare: boolean;
  unknown: UnknownFact[];
  fits: KidFit[];
  /** The children this witness can take. */
  kids: number[];
  /** Per keyword, the field that matched on this witness (camp-wide or its own). */
  hits: Array<TextField | null>;
  uncertainty: number;
}

const FIT_RANK: Record<KidFit, number> = { fits: 0, may_fit: 1, no: 2 };
const worseFit = (a: KidFit, b: KidFit) => (FIT_RANK[a] >= FIT_RANK[b] ? a : b);

/** Do these fits (one per kid) leave a session: some kid fits, and every kid for same_session? */
function takesKids(fits: KidFit[], prep: Prepared): boolean {
  if (fits.length === 0) return true;
  const able = fits.filter((fit) => fit !== 'no').length;
  return able > 0 && (prep.filters.kidsMode !== 'same_session' || able === fits.length);
}

/** Every witness passing the known facts; unknown facts are listed, not judged. */
function witnessesOf(
  camp: IndexedCamp,
  prep: Prepared,
  campMatch: Array<TextField | null>
): Witness[] {
  const witnesses: Witness[] = [];
  const { kids } = prep;
  const sites = camp.sites.map((site) => judgeSite(site, camp, prep));
  const noSite = judgeSite(null, camp, prep);
  const tierMatches = new Map<IndexedTier, Array<TextField | null>>();
  const tierMatch = (tier: IndexedTier) => {
    if (!tierMatches.has(tier)) tierMatches.set(tier, bestFields(tier.text, prep.terms));
    return tierMatches.get(tier)!;
  };

  for (const row of camp.rows) {
    const dates = judgeDates(row, camp, prep);
    if (dates.verdict === 'fail') continue;
    const hours = judgeHours(row, camp, prep);
    if (hours.verdict === 'fail') continue;
    const rowFits = kids.map((kid) => kidFit(row.eligibility, kid));
    if (!takesKids(rowFits, prep)) continue;
    if (
      prep.where.sessions.length > 0 &&
      !(row.session === null
        ? noItem(prep.where.sessions)
        : allHold(prep.where.sessions, camp.card.sessions[row.session]))
    ) {
      continue;
    }
    const tiers = tierOptions(row, camp, prep);
    if (!tiers) continue;
    const rowMatch = bestFields(row.text, prep.terms);
    const historical = row.year !== null && row.year < TARGET_SEASON ? 1 : 0;

    for (const site of row.sites === null ? [null] : row.sites.map((index) => camp.sites[index])) {
      const place = site ? sites[site.index] : noSite;
      if (place.verdict === 'fail') continue;
      for (const option of tiers) {
        // A price for one age band ("Ages 11-14") isn't a younger kid's price
        const band = option.tier?.band;
        const fits = band
          ? rowFits.map((fit, index) => worseFit(fit, kidFit(band, kids[index])))
          : rowFits;
        if (!takesKids(fits, prep)) continue;
        const able = fits.flatMap((fit, index) => (fit === 'no' ? [] : [index]));
        const mayFit = able.some((index) => fits[index] === 'may_fit') ? 1 : 0;
        const own = option.tier ? tierMatch(option.tier) : [];
        const hits = prep.terms.map((_, t) =>
          heavier(campMatch[t], rowMatch[t], place.match[t], own[t])
        );
        if (
          prep.terms.length > 0 &&
          (prep.filters.keywordMatch === 'any' ? !hits.some(Boolean) : !hits.every(Boolean))
        ) {
          continue;
        }
        const unknown: UnknownFact[] = [];
        if (dates.verdict === 'unknown') unknown.push('dates');
        if (hours.verdict === 'unknown') unknown.push('hours');
        if (option.unknown) unknown.push('price');
        if (place.verdict === 'unknown') unknown.push('location');
        const conditional = option.tier && (option.tier.conditional || !option.tier.counts) ? 1 : 0;
        witnesses.push({
          row,
          site,
          tier: option.tier,
          compared: option.compared,
          distance: place.distance,
          projected: dates.projected,
          byCare: hours.byCare,
          unknown,
          fits,
          kids: able,
          hits,
          uncertainty: unknown.length + historical + mayFit + conditional,
        });
      }
    }
  }
  return witnesses;
}

/** Does this set of witnesses satisfy the kids mode? */
function satisfies(witnesses: Witness[], prep: Prepared): boolean {
  if (prep.filters.kidsMode !== 'each' || prep.kids.length === 0) return witnesses.length > 0;
  return prep.kids.every((_, index) => witnesses.some((witness) => witness.kids.includes(index)));
}

interface Judged {
  camp: IndexedCamp;
  /** Witnesses passing with the allowed unknowns. */
  witnesses: Witness[];
  campMatch: Array<TextField | null>;
  /** The registration dates the registration filters matched, most certain first. */
  openings: PublicMilestone[] | null;
  /** The directory's status, when the registration filter read it. */
  directory: RegistrationLine['status'] | null;
}

/**
 * The camp's witnesses when it matches, or the unknown facts that alone keep it out (counted, not
 * shown), or null when a stated fact rules it out.
 */
function judgeCamp(camp: IndexedCamp, prep: Prepared, now: Date): Judged | UnknownFact[] | null {
  const { filters, where } = prep;
  const { card } = camp;
  if (filters.types && !filters.types.includes(card.type)) return null;
  if (
    filters.categories &&
    !card.categories.some((category) => filters.categories!.includes(category))
  ) {
    return null;
  }
  if (filters.needs) {
    const has = supportKeys(camp.listing.card);
    if (!filters.needs.every((need) => has.includes(need))) return null;
  }
  let directory: Judged['directory'] = null;
  if (filters.registration) {
    directory = registrationLine(camp.listing.card, camp.listing.confirmed, now, {
      earliestOpening: true,
    }).status;
    if (!matchesRegistration(directory, filters.registration)) return null;
  }
  let openings = filters.registrationOpens ? selectOpenings(card, filters.registrationOpens) : null;
  if (openings?.length === 0) return null;

  // Generic clauses on the card: exclusions anywhere, positives on the card, each categories[]
  // clause on any category (so arts and music can both be required), and registration[] clauses
  // on one date, which must also be a selected opening when there is a window. Caveats and
  // ranking read only the dates that passed.
  if (!where.negatives.every((clause) => exclusionPasses(clause, card))) return null;
  if (!allHold(where.card, card)) return null;
  if (
    card.categories.length === 0
      ? !noItem(where.categories)
      : !where.categories.every((clause) =>
          card.categories.some((category) => holds(clause, category))
        )
  ) {
    return null;
  }
  if (where.registration.length > 0) {
    const dates = openings ?? card.registration;
    if (dates.length === 0) {
      if (!noItem(where.registration)) return null;
    } else {
      openings = dates.filter((milestone) => allHold(where.registration, milestone));
      if (openings.length === 0) return null;
    }
  }
  openings?.sort((a, b) => doubt(a) - doubt(b));
  if (prep.excluded.length > 0) {
    const text = allText(camp);
    if (prep.excluded.some((term) => text.some((field) => phraseIndex(field.words, term) >= 0))) {
      return null;
    }
  }

  const campMatch = bestFields(camp.text, prep.terms);
  const all = witnessesOf(camp, prep, campMatch);
  const ok = (witness: Witness) => witness.unknown.every((fact) => prep.allowed.has(fact));
  const current = all.filter(ok);
  if (satisfies(current, prep)) return { camp, witnesses: current, campMatch, openings, directory };
  if (!satisfies(all, prep)) return null;

  // Kept out only by unknowns: which ones, on the witnesses that would serve the children no
  // passing witness serves (every witness, outside "each")
  const served = new Set(current.flatMap((witness) => witness.kids));
  const rescuers = all.filter(
    (witness) =>
      !ok(witness) &&
      (prep.filters.kidsMode !== 'each' || witness.kids.some((index) => !served.has(index)))
  );
  return [...new Set(rescuers.flatMap((witness) => witness.unknown))].filter(
    (fact) => !prep.allowed.has(fact)
  );
}

// ---------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------

const TONE_ORDER: Record<RegistrationLine['tone'], number> = {
  open: 0,
  upcoming: 1,
  tentative: 2,
  unknown: 3,
  closed: 4,
};

const UNKNOWN_CAVEATS: Record<UnknownFact, string> = {
  dates: 'Dates not stated for this one',
  hours: 'Hours not stated, so the times asked for are unconfirmed',
  price: 'No comparable price stated',
  location: 'Site location unknown',
};

const MAX_CAVEATS = 8;
const SNIPPET = 160;

function byDate(a: Witness, b: Witness): number {
  return (
    a.uncertainty - b.uncertainty ||
    (a.row.start ?? '9999').localeCompare(b.row.start ?? '9999') ||
    (a.row.label ?? '').localeCompare(b.row.label ?? '') ||
    (a.compared ?? Infinity) - (b.compared ?? Infinity) ||
    // A week, session or day price over an "other" one, often a fee ("Registration fee per family")
    Number(a.tier?.tier.unit === 'other') - Number(b.tier?.tier.unit === 'other') ||
    (a.tier?.tier.amount ?? Infinity) - (b.tier?.tier.amount ?? Infinity) ||
    (a.site?.index ?? 0) - (b.site?.index ?? 0)
  );
}

/**
 * The examples a hit shows: the best one, or in "each" mode one per child no earlier example takes
 * (at most six, one per session). matchedSessions says how many more passed; get_camp_details
 * lists them all.
 */
function examples(witnesses: Witness[], prep: Prepared): Witness[] {
  const sorted = [...witnesses].sort((a, b) => b.kids.length - a.kids.length || byDate(a, b));
  const picked: Witness[] = [];
  if (prep.filters.kidsMode === 'each') {
    const best = new Map<IndexedRow, Witness>();
    for (const witness of sorted) if (!best.has(witness.row)) best.set(witness.row, witness);
    const rows = [...best.values()].sort(byDate);
    for (let index = 0; index < prep.kids.length; index++) {
      if (picked.some((witness) => witness.kids.includes(index))) continue;
      const cover = rows.find((witness) => witness.kids.includes(index));
      if (cover) picked.push(cover);
    }
  }
  if (picked.length === 0 && sorted.length > 0) picked.push(sorted[0]);
  return picked.sort(
    (a, b) =>
      (a.projected?.start ?? a.row.start ?? '9999').localeCompare(
        b.projected?.start ?? b.row.start ?? '9999'
      ) || byDate(a, b)
  );
}

function matchOf(witness: Witness, camp: IndexedCamp, prep: Prepared): CampSessionMatch {
  const { row, site, tier } = witness;
  const { card } = camp;
  // Only what the match's own fields don't say: its price label and year, and the hit's hoursNote,
  // are already there
  const caveats: string[] = [];
  if (witness.projected && row.year !== null) {
    // A card can post the target summer's season while its sessions are still last year's
    caveats.push(
      row.session !== null && card.season.year >= TARGET_SEASON
        ? `Based on its ${row.year} session list; ${TARGET_SEASON} sessions not posted`
        : `Based on its ${row.year} schedule; ${TARGET_SEASON} not posted`
    );
  }
  if (witness.kids.some((index) => witness.fits[index] === 'may_fit')) {
    caveats.push('Age/grade fit uncertain: converted between ages and grades, or not stated');
  }
  if (tier) {
    if (tier.conditional || !tier.counts) {
      caveats.push(
        `Price "${tier.tier.label ?? formatPriceTier(tier.tier)}" may not apply to every family`
      );
    }
    // A card still on last summer already says so for all its prices
    if (tier.tier.year < TARGET_SEASON && tier.tier.year !== card.season.year) {
      caveats.push(`${tier.tier.year} price`);
    }
    if (tier.halfDay && fullDayHours(row.hours)) {
      caveats.push("Half-day price; the hours shown are the full day's");
    }
    if (
      witness.compared !== null &&
      prep.filters.price?.per === 'week' &&
      tier.tier.unit !== 'week' &&
      tier.tier.amount > 0
    ) {
      caveats.push(
        `About ${formatPrice(witness.compared)}/week, estimated from ${formatPriceTier(tier.tier)}`
      );
    }
  }
  if (witness.byCare) {
    const cost = card.extended_care?.cost_text?.trim();
    caveats.push(
      `Times met with before/after care (${cost ? `care cost: ${clip(cost, 100)}` : 'may cost extra'})`
    );
  }
  if (row.status && row.year !== null && row.year < TARGET_SEASON) {
    caveats.push(
      `"${AVAILABILITY_LABELS[row.status] ?? row.status}" was the ${row.year} status, not current availability`
    );
  }
  if (site?.estimated && (prep.filters.maxDriveMinutes !== null || prep.filters.near)) {
    caveats.push('Drive time or distance is from the town center (estimate)');
  }
  for (const fact of witness.unknown) caveats.push(UNKNOWN_CAVEATS[fact]);
  const kidFits = witness.kids.map((index) => witness.fits[index]);
  return {
    label: row.label,
    start: row.start,
    end: row.end,
    year: row.year,
    projectedStart: witness.projected?.start ?? null,
    projectedEnd: witness.projected?.end ?? null,
    site: site ? camp.card.sites[site.index].name : null,
    town: site?.town ?? null,
    driveMinutes: site?.drive ?? null,
    driveFromTown: site ? camp.card.sites[site.index].driveFromTown : false,
    distance: witness.distance,
    hours: { ...row.hours },
    price: tier ? { ...tier.tier } : null,
    comparedPrice:
      witness.compared !== null && prep.filters.price
        ? { amount: Math.round(witness.compared * 100) / 100, per: prep.filters.price.per }
        : null,
    kidFit: prep.kids.length === 0 ? null : kidFits.includes('may_fit') ? 'may_fit' : 'fits',
    kidIndexes: [...witness.kids],
    status: row.status,
    unknown: [...witness.unknown],
    caveats,
  };
}

function snippet(field: TextField, term: string[]): string {
  const at = phraseIndex(field.words, term);
  if (field.text.length <= SNIPPET || at < 0) return field.text.slice(0, SNIPPET);
  const from = field.tokens[at].start;
  const start = Math.max(0, Math.min(from - 50, field.text.length - (SNIPPET - 2)));
  const end = Math.min(field.text.length, start + SNIPPET - 2);
  return `${start > 0 ? '…' : ''}${field.text.slice(start, end)}${end < field.text.length ? '…' : ''}`;
}

function clip(text: string, length = 140): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** What holds for the whole camp: old schedules, no sessions, registration and support wording. */
function campCaveats(judged: Judged, prep: Prepared, publicLine: RegistrationLine): string[] {
  const { camp, openings, directory } = judged;
  const card = camp.card;
  const caveats: string[] = [];
  if (card.season.year < TARGET_SEASON) {
    caveats.push(`Dates and prices are from ${card.season.year}; ${TARGET_SEASON} not posted yet`);
  }
  if (camp.seasonOnly) caveats.push('No sessions listed; season dates only');
  if (directory && directory !== publicLine.status) {
    caveats.push(
      'Matched the registration filter on a date that may be only for members, returning campers or other families'
    );
  }
  if (prep.filters.registration === 'open' && publicLine.status === 'opened') {
    caveats.push('Registration opened earlier; that is not proof spots remain');
  }
  const milestone = openings?.[0];
  if (milestone) {
    const what = milestone.kind === 'opens' ? 'Opening date' : 'Matched registration date';
    if (milestone.year !== TARGET_SEASON) caveats.push(`${what} is for summer ${milestone.year}`);
    if (milestone.audience !== 'public') {
      caveats.push(
        `${what} is for ${milestone.audience.replace('_', '-')} registration: "${clip(milestone.text)}"`
      );
    }
    if (milestone.precision === 'month')
      caveats.push(`${what} is given only as a month, not a day`);
    if (milestone.certainty === 'expected') caveats.push(`${what} is expected, not announced`);
    if (milestone.unconfirmed) caveats.push(`${what} is unconfirmed`);
  }
  for (const need of prep.filters.needs ?? []) {
    if (need === 'extended_care') {
      const care = card.extended_care;
      if (!care?.early_dropoff_start && !care?.late_pickup_end) {
        caveats.push('Before/after care offered; its hours are not stated');
      }
      if (care?.cost_text) caveats.push(`Care cost: ${clip(care.cost_text)}`);
      continue;
    }
    const fact = card[need];
    if (!fact) continue;
    if (need === 'special_needs') {
      caveats.push(
        `Special-needs support (${fact.value === 'case_by_case' ? 'case by case' : 'stated'}), not a certification: "${clip(fact.text)}"`
      );
    } else if (fact.value === 'case_by_case' || need === 'lunch') {
      caveats.push(`${need.replace('_', ' ')}: "${clip(fact.text)}"`);
    }
  }
  const availability = card.availability;
  if (availability && card.season.year < TARGET_SEASON) {
    caveats.push(`Availability info is from ${card.season.year}`);
  } else if (availability?.scope && !/^(?:all|every)\b/i.test(availability.scope)) {
    caveats.push(
      `"${AVAILABILITY_LABELS[availability.status] ?? availability.status}" applies to ${clip(availability.scope, 80)}`
    );
  }
  return caveats;
}

function toHit(
  judged: Judged,
  prep: Prepared,
  now: Date,
  publicLine: RegistrationLine
): CampSearchHit {
  const { camp, witnesses, campMatch } = judged;
  const { card, listing } = camp;
  const data = toCardData(listing, now);
  const chosen = examples(witnesses, prep);
  const matches = chosen.map((witness) => matchOf(witness, camp, prep));

  const keywordHits: CampSearchHit['keywordHits'] = [];
  (prep.filters.keywords ?? []).forEach((keyword, t) => {
    const field = campMatch[t] ?? chosen.find((witness) => witness.hits[t])?.hits[t];
    if (field && keywordHits.length < 3) {
      keywordHits.push({ term: keyword, field: field.field, text: snippet(field, prep.terms[t]) });
    }
  });

  const caveats = campCaveats(judged, prep, publicLine);
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    providerName: data.providerName,
    summary: data.summary,
    who: data.who,
    season: data.season,
    price: data.price,
    priceNote: data.priceNote,
    hours: data.hours,
    hoursNote: data.hoursNote,
    care: data.care,
    location: data.location,
    drive: data.drive,
    support: data.support,
    websiteUrl: httpUrl(data.websiteUrl),
    type: card.type,
    categories: [...card.categories],
    url: `/camps/${listing.slug}`,
    registrationUrl: card.registration_url,
    checkedAt: listing.checkedAt,
    seasonYear: card.season.year,
    seasonStatus: card.season.status,
    registration: publicLine,
    openingDates: card.registration
      .filter((milestone) => milestone.year === TARGET_SEASON && milestone.kind === 'opens')
      .map((milestone) => ({ ...milestone })),
    lastYearOpened: card.last_year_registration_opened && { ...card.last_year_registration_opened },
    matchedSessions: new Set(witnesses.map((witness) => witness.row)).size,
    totalSessions: camp.rows.length,
    matches,
    keywordHits,
    unknown: [...new Set(matches.flatMap((match) => match.unknown))],
    caveats: [...new Set(caveats)].slice(0, MAX_CAVEATS),
  };
}

// ---------------------------------------------------------------------------
// search_camps and get_camp_details
// ---------------------------------------------------------------------------

export function searchCamps(
  index: CampIndex,
  filters: CampSearchFilters,
  now: Date
): CampSearchResult {
  const prep = prepare(filters);
  const unknownCounts: CampSearchResult['unknownCounts'] = {};
  const passing: Array<{
    judged: Judged;
    line: RegistrationLine;
    uncertainty: number;
    score: number;
  }> = [];
  for (const camp of index.camps) {
    const judged = judgeCamp(camp, prep, now);
    if (!judged) continue;
    if (Array.isArray(judged)) {
      for (const fact of judged) unknownCounts[fact] = (unknownCounts[fact] ?? 0) + 1;
      continue;
    }
    const opening = judged.openings?.[0];
    const score = prep.terms.reduce(
      (sum, _, t) =>
        sum +
        Math.max(
          judged.campMatch[t]?.weight ?? 0,
          ...judged.witnesses.map((witness) => witness.hits[t]?.weight ?? 0)
        ),
      0
    );
    passing.push({
      judged,
      line: registrationLine(camp.listing.card, camp.listing.confirmed, now),
      uncertainty:
        Math.min(...judged.witnesses.map((witness) => witness.uncertainty)) +
        (opening && doubt(opening) > 0 ? 1 : 0),
      score,
    });
  }

  // Stable relevance: fewer uncertainties, keyword fields, public registration, name, slug
  passing.sort(
    (a, b) =>
      a.uncertainty - b.uncertainty ||
      b.score - a.score ||
      TONE_ORDER[a.line.tone] - TONE_ORDER[b.line.tone] ||
      (a.line.sortDate ?? '9999').localeCompare(b.line.sortDate ?? '9999') ||
      a.judged.camp.card.name.localeCompare(b.judged.camp.card.name) ||
      a.judged.camp.listing.slug.localeCompare(b.judged.camp.listing.slug)
  );

  const total = passing.length;
  const start = (filters.page - 1) * CAMP_SEARCH_PAGE_SIZE;
  const page = passing.slice(start, start + CAMP_SEARCH_PAGE_SIZE);
  const notes: string[] = [];
  if (page.length === 0 && total > 0) {
    notes.push(
      `Page ${filters.page} is past the end: ${total} candidates on ${Math.ceil(total / CAMP_SEARCH_PAGE_SIZE)} page(s).`
    );
  }
  if (Object.keys(unknownCounts).length > 0) {
    notes.push(
      'unknownCounts: camps left out only because a fact is not stated (counts overlap; never add them). includeUnknown keeps them, flagged.'
    );
  }
  if (prep.excluded.length > 0) {
    notes.push('excludeKeywords drop a camp when the words appear anywhere in its public text.');
  }
  return {
    filters,
    totalMatches: total,
    page: filters.page,
    hasMore: start + CAMP_SEARCH_PAGE_SIZE < total,
    unknownCounts,
    notes,
    camps: page.map(({ judged, line }) => toHit(judged, prep, now, line)),
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** A slug, "/camps/<slug>", or an AVL GO link to exactly that path; anything else is null. */
function refSlug(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const text = ref.trim();
  if (SLUG.test(text)) return text;
  const path = /^\/camps\/([^/?#\s]+)$/.exec(text)?.[1];
  if (path) return SLUG.test(path) ? path : null;
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    const hosts = new Set(['www.avlgo.com', 'avlgo.com', new URL(SITE_URL).hostname]);
    if (!hosts.has(url.hostname.toLowerCase())) return null;
    const slug = /^\/camps\/([^/]+)$/.exec(url.pathname)?.[1];
    return slug && SLUG.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

const NO_FILTERS = prepare(parseCampSearchFilters({}));

/** Full public cards for up to three camps, by slug or AVL GO link; the rest are notFound. */
export function campDetails(index: CampIndex, refs: string[], now: Date): CampDetailsResult {
  const result: CampDetailsResult = { camps: [], notFound: [] };
  const seen = new Set<string>();
  for (const ref of refs) {
    const slug = refSlug(ref);
    const camp = slug ? index.camps.find((one) => one.listing.slug === slug) : undefined;
    if (!camp || !slug) {
      result.notFound.push(String(ref));
      continue;
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    const judged = judgeCamp(camp, NO_FILTERS, now) as Judged;
    result.camps.push({
      hit: toHit(
        judged,
        NO_FILTERS,
        now,
        registrationLine(camp.listing.card, camp.listing.confirmed, now)
      ),
      card: structuredClone(camp.card),
    });
  }
  return result;
}
