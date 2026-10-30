/**
 * search_camps' runtime parser (docs/camps/06-ai-chat-plan.md §4): the strict tool schema says
 * which fields and types exist, this checks bounds and combinations and normalizes, throwing a
 * short error that names the allowed values so the model can correct its call. It also parses the
 * lastSearch the browser echoes back.
 *
 * Pure and client-safe: no database, model or tools import. The keyword normalizer lives here too,
 * since search.ts matches with exactly the tokens the parser checked.
 */
import { CAMP_CATEGORIES, CAMP_TYPES } from '@/lib/camps/contract';
import { SUPPORT_LABELS, validDate, validTime, type SupportKey } from '@/lib/camps/display';
import { isRecord } from '@/lib/utils/validation';
import { CARD_FIELDS, OPS_BY_KIND, opError, unknownPathError, valueError } from './fields';
import { PLACES, findPlace, placeKey } from './places';
import type { CampSearchFilters, UnknownFact, WhereClause, WhereOp } from './types';

// ---------------------------------------------------------------------------
// Keyword tokens: case, accents, apostrophes, "&" and punctuation don't matter
// ---------------------------------------------------------------------------

/** A word (letters and digits, inner apostrophes kept), or "&". */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’‘ʼ][\p{L}\p{M}\p{N}]+)*|&/gu;

export interface Token {
  word: string;
  /** Where the word sits in the original text, for snippets. */
  start: number;
  end: number;
}

/** "Kids’ Café & Arts!" -> kids, cafe, and, arts (with their offsets). */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const word =
      match[0] === '&'
        ? 'and'
        : match[0]
            .toLowerCase()
            .normalize('NFKD')
            .replace(/\p{M}/gu, '')
            .replace(/['’‘ʼ]/g, '');
    if (word) tokens.push({ word, start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

export function termWords(text: string): string[] {
  return tokenize(text).map((token) => token.word);
}

/**
 * Where the term's words start consecutive words of the text, as the index of the first, or -1:
 * "art" matches "arts" and "artist" but not "start"; "sibling discount" must be two words in a row.
 */
export function phraseIndex(words: string[], term: string[]): number {
  if (term.length === 0) return -1;
  for (let i = 0; i + term.length <= words.length; i++) {
    let j = 0;
    while (j < term.length && words[i + j].startsWith(term[j])) j++;
    if (j === term.length) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

const FIELDS: Array<keyof CampSearchFilters> = [
  'keywords',
  'keywordMatch',
  'excludeKeywords',
  'kids',
  'kidsMode',
  'dates',
  'dropoffBy',
  'pickupAtOrAfter',
  'dayLength',
  'price',
  'maxDriveMinutes',
  'near',
  'towns',
  'types',
  'categories',
  'needs',
  'registration',
  'registrationOpens',
  'where',
  'includeUnknown',
  'page',
];

const NEEDS = Object.keys(SUPPORT_LABELS) as SupportKey[];
const UNKNOWN_FACTS: UnknownFact[] = ['dates', 'hours', 'price', 'location'];
const REGISTRATION = ['open', 'soon', 'not_announced', 'full'] as const;
const MAX_TERMS = 10;
const MAX_TERM_LENGTH = 80;
const MAX_KIDS = 6;
const MAX_TOWNS = 10;
const MAX_WHERE = 8;
const MAX_PAGE = 200;
const MAX_PRICE = 100_000;
const DEFAULT_NEAR_MILES = 5;

function fail(message: string): never {
  throw new Error(message);
}

const show = (value: unknown) => JSON.stringify(value) ?? String(value);

/** An object with no keys but these (any of them may be missing). */
function record(value: unknown, name: string, keys: string[]): Record<string, unknown> {
  if (!isRecord(value)) fail(`${name} must be an object with ${keys.join(', ')}, or null.`);
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length > 0)
    fail(`${name} has unknown field ${extra.join(', ')}; use ${keys.join(', ')}.`);
  return value;
}

/**
 * A list (null or [] is no filter), at most `max` long, each item parsed, duplicates dropped
 * unless `key` is false (twins are two kids of one age).
 */
function list<T>(
  value: unknown,
  name: string,
  max: number,
  item: (value: unknown) => T,
  key: ((item: T) => string) | false = (parsed) => JSON.stringify(parsed)
): T[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) fail(`${name} must be an array or null.`);
  if (value.length > max) fail(`${name} takes at most ${max} items.`);
  const parsed = value.map(item);
  const items = key ? [...new Map(parsed.map((one) => [key(one), one])).values()] : parsed;
  return items.length > 0 ? items : null;
}

function oneOf<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
  fallback?: T
): T {
  if ((value === null || value === undefined) && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(
      `${name} must be one of ${allowed.join(', ')}${fallback ? ' (or null)' : ''}; got ${show(value)}.`
    );
  }
  return value as T;
}

function nullableOneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]) {
  return value === null || value === undefined ? null : oneOf(value, name, allowed);
}

function finite(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(
      `${name} must be a${integer ? 'n integer' : ' number'} from ${min} to ${max}; got ${show(value)}.`
    );
  }
  if (integer && !Number.isInteger(value)) fail(`${name} must be a whole number; got ${value}.`);
  return value;
}

function date(value: unknown, name: string): string {
  return validDate(value) ?? fail(`${name} must be a real YYYY-MM-DD date; got ${show(value)}.`);
}

function time(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  return validTime(value) ?? fail(`${name} must be HH:MM on a 24-hour clock; got ${show(value)}.`);
}

function term(value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : null;
  if (!text || text.length > MAX_TERM_LENGTH) {
    fail(`${name} items must be text of 1-${MAX_TERM_LENGTH} characters; got ${show(value)}.`);
  }
  if (termWords(text).length === 0) fail(`${name} item ${show(value)} has no letters or digits.`);
  return text;
}

const termKey = (text: string) => termWords(text).join(' ');

function parseTerms(value: unknown, name: string): string[] | null {
  return list(value, name, MAX_TERMS, (item) => term(item, name), termKey);
}

function parseKid(value: unknown): { age: number | null; grade: number | null } {
  const kid = record(value, 'kids item', ['age', 'grade']);
  const age = kid.age === null || kid.age === undefined ? null : finite(kid.age, 'kids age', 1, 25);
  const grade =
    kid.grade === null || kid.grade === undefined
      ? null
      : finite(kid.grade, 'kids grade (-1 pre-K, 0 K, 13 graduate)', -1, 13, true);
  if (age === null && grade === null) fail('Each kids item needs an age or a grade.');
  return { age, grade };
}

function parseDates(value: unknown): CampSearchFilters['dates'] {
  if (value === null || value === undefined) return null;
  const dates = record(value, 'dates', ['start', 'end', 'match']);
  const start = date(dates.start, 'dates.start');
  const end = date(dates.end, 'dates.end');
  if (start > end) fail('dates.start must be on or before dates.end.');
  return {
    start,
    end,
    match: oneOf(dates.match, 'dates.match', ['overlaps', 'covers'], 'overlaps'),
  };
}

function parsePrice(value: unknown): CampSearchFilters['price'] {
  if (value === null || value === undefined) return null;
  const price = record(value, 'price', ['min', 'max', 'per']);
  const bound = (raw: unknown, name: string) =>
    raw === null || raw === undefined ? null : finite(raw, name, 0, MAX_PRICE);
  const min = bound(price.min, 'price.min');
  const max = bound(price.max, 'price.max');
  if (min === null && max === null)
    fail('price needs a min or a max (dollars), or set price to null.');
  if (min !== null && max !== null && min > max) fail('price.min must not be above price.max.');
  return { min, max, per: oneOf(price.per, 'price.per', ['week', 'session'], 'week') };
}

function parseNear(value: unknown): CampSearchFilters['near'] {
  if (value === null || value === undefined) return null;
  const near = record(value, 'near', ['place', 'maxMiles']);
  const place = typeof near.place === 'string' ? findPlace(near.place) : null;
  if (!place) {
    fail(
      `Unknown near.place ${show(near.place)}. Known places: ${PLACES.map((known) => known.name).join(', ')}.`
    );
  }
  const maxMiles =
    near.maxMiles === null || near.maxMiles === undefined
      ? DEFAULT_NEAR_MILES
      : finite(near.maxMiles, 'near.maxMiles', 0.5, 60);
  return { place: place.name, maxMiles };
}

/**
 * Towns compare by placeKey (case, spacing, a trailing ", NC"). With the index's towns, an unknown
 * one is an error naming them, and a known one takes its spelling.
 */
function parseTowns(value: unknown, knownTowns?: string[]): string[] | null {
  const known = knownTowns && new Map(knownTowns.map((town) => [placeKey(town), town]));
  return list(
    value,
    'towns',
    MAX_TOWNS,
    (item) => {
      if (typeof item !== 'string' || !placeKey(item)) fail(`towns items must be town names.`);
      const name = item
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*NC$/i, '');
      if (!known) return name;
      return (
        known.get(placeKey(item)) ??
        fail(`Unknown town ${show(item)}. Towns with camps: ${[...known.values()].join(', ')}.`)
      );
    },
    placeKey
  );
}

function parseRegistrationOpens(value: unknown): CampSearchFilters['registrationOpens'] {
  if (value === null || value === undefined) return null;
  const opens = record(value, 'registrationOpens', ['from', 'to', 'audience']);
  const bound = (raw: unknown, name: string) =>
    raw === null || raw === undefined ? null : date(raw, name);
  const from = bound(opens.from, 'registrationOpens.from');
  const to = bound(opens.to, 'registrationOpens.to');
  if (!from && !to) fail('registrationOpens needs a from or a to date, or set it to null.');
  if (from && to && from > to) fail('registrationOpens.from must be on or before .to.');
  return {
    from,
    to,
    audience: oneOf(opens.audience, 'registrationOpens.audience', ['public', 'any'], 'public'),
  };
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

export function parseWhereClause(value: unknown): WhereClause {
  const clause = record(value, 'where item', ['path', 'op', 'value']);
  const path = clause.path;
  // Own keys only: "constructor" or "__proto__" is an unknown path, not Object's
  if (typeof path !== 'string' || !Object.hasOwn(CARD_FIELDS, path)) fail(unknownPathError(path));
  const { kind, values } = CARD_FIELDS[path];
  const op = clause.op as WhereOp;
  if (!OPS_BY_KIND[kind].includes(op)) fail(opError(path, clause.op));
  if (op === 'exists' || op === 'missing') {
    if (clause.value !== null && clause.value !== undefined) fail(valueError(path, op));
    return { path, op, value: null };
  }
  const raw = typeof clause.value === 'string' ? clause.value.trim() : null;
  let parsed: string | null = null;
  if (raw) {
    if (kind === 'text') parsed = raw.length <= 200 && termWords(raw).length > 0 ? raw : null;
    else if (kind === 'number') {
      parsed = NUMERIC.test(raw) && Number.isFinite(Number(raw)) ? String(Number(raw)) : null;
    } else if (kind === 'date') parsed = validDate(raw);
    else if (kind === 'time') parsed = validTime(raw);
    else if (kind === 'enum') parsed = values?.includes(raw) ? raw : null;
    else if (kind === 'boolean') parsed = raw === 'true' || raw === 'false' ? raw : null;
  }
  return { path, op, value: parsed ?? fail(valueError(path, op)) };
}

/**
 * The normalized filters, or an error the model can act on. Missing fields take their defaults
 * (for the browser's lastSearch and tests); null and [] mean no filter; the all-null object is
 * an unfiltered search. `knownTowns` (the loaded index's) checks town names.
 */
export function parseCampSearchFilters(value: unknown, knownTowns?: string[]): CampSearchFilters {
  if (!isRecord(value)) fail('search_camps arguments must be an object.');
  const extra = Object.keys(value).filter(
    (key) => !FIELDS.includes(key as keyof CampSearchFilters)
  );
  if (extra.length > 0) fail(`Unknown search_camps field ${extra.join(', ')}.`);

  const keywords = parseTerms(value.keywords, 'keywords');
  const keywordMatch = oneOf(value.keywordMatch, 'keywordMatch', ['all', 'any'], 'all');
  const excludeKeywords = parseTerms(value.excludeKeywords, 'excludeKeywords');
  if (keywords && excludeKeywords) {
    const excluded = excludeKeywords.map(termWords);
    const conflicts = (keyword: string) =>
      excluded.some((words) => phraseIndex(termWords(keyword), words) >= 0);
    if (keywordMatch === 'all' ? keywords.some(conflicts) : keywords.every(conflicts)) {
      fail(
        'A required keyword contains an excluded keyword, so nothing could match. Drop the contradictory keyword and keep the exclusions.'
      );
    }
  }

  const page =
    value.page === null || value.page === undefined
      ? 1
      : finite(value.page, 'page', 1, MAX_PAGE, true);

  return {
    keywords,
    keywordMatch,
    excludeKeywords,
    kids: list(value.kids, 'kids', MAX_KIDS, parseKid, false),
    kidsMode: oneOf(value.kidsMode, 'kidsMode', ['any', 'each', 'same_session'], 'any'),
    dates: parseDates(value.dates),
    dropoffBy: time(value.dropoffBy, 'dropoffBy'),
    pickupAtOrAfter: time(value.pickupAtOrAfter, 'pickupAtOrAfter'),
    dayLength: nullableOneOf(value.dayLength, 'dayLength', ['full', 'half']),
    price: parsePrice(value.price),
    maxDriveMinutes:
      value.maxDriveMinutes === null || value.maxDriveMinutes === undefined
        ? null
        : finite(value.maxDriveMinutes, 'maxDriveMinutes', 1, 180, true),
    near: parseNear(value.near),
    towns: parseTowns(value.towns, knownTowns),
    types: list(value.types, 'types', CAMP_TYPES.length, (item) =>
      oneOf(item, 'types', CAMP_TYPES)
    ),
    categories: list(value.categories, 'categories', CAMP_CATEGORIES.length, (item) =>
      oneOf(item, 'categories', CAMP_CATEGORIES)
    ),
    needs: list(value.needs, 'needs', NEEDS.length, (item) => oneOf(item, 'needs', NEEDS)),
    registration: nullableOneOf(value.registration, 'registration', REGISTRATION),
    registrationOpens: parseRegistrationOpens(value.registrationOpens),
    where: list(value.where, 'where', MAX_WHERE, parseWhereClause),
    includeUnknown: list(value.includeUnknown, 'includeUnknown', UNKNOWN_FACTS.length, (item) =>
      oneOf(item, 'includeUnknown', UNKNOWN_FACTS)
    ),
    page,
  };
}
