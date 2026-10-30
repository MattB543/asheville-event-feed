/**
 * The public card fields search_camps' generic `where` can test (docs/camps/06-ai-chat-plan.md
 * §4.2): one explicit registry, from which the tool schema's path enum and the parser's errors are
 * generated. Paths use the raw card's names (season.start, extended_care.cost_text, prices[].unit),
 * not the export's renames. Nothing private is registered: confidence, review_notes, sources and
 * DB metadata can't be asked about.
 *
 * Pure and client-safe.
 */
import {
  AUDIENCES,
  AVAILABILITY_STATUSES,
  CAMP_CATEGORIES,
  CAMP_TYPES,
  GRADE_BASES,
  MILESTONE_KINDS,
  PRECISIONS,
  PRICE_UNITS,
  SEASON_STATUSES,
  SUPPORT_VALUES,
} from '@/lib/camps/contract';
import type { WhereOp } from './types';

export type FieldKind = 'text' | 'number' | 'date' | 'time' | 'enum' | 'boolean' | 'container';

export interface CardField {
  kind: FieldKind;
  /** The allowed values of an enum field. */
  values?: readonly string[];
}

const TEXT: CardField = { kind: 'text' };
const NUMBER: CardField = { kind: 'number' };
const DATE: CardField = { kind: 'date' };
const TIME: CardField = { kind: 'time' };
const BOOLEAN: CardField = { kind: 'boolean' };
const CONTAINER: CardField = { kind: 'container' };
const oneOf = (values: readonly string[]): CardField => ({ kind: 'enum', values });

const SUPPORT = (key: string) => ({
  [key]: CONTAINER,
  [`${key}.value`]: oneOf(SUPPORT_VALUES),
  [`${key}.text`]: TEXT,
});

export const CARD_FIELDS: Record<string, CardField> = {
  name: TEXT,
  provider: TEXT,
  type: oneOf(CAMP_TYPES),
  categories: CONTAINER,
  'categories[]': oneOf(CAMP_CATEGORIES),
  description: TEXT,
  camp_page_url: TEXT,
  registration_url: TEXT,

  season: CONTAINER,
  'season.year': NUMBER,
  'season.status': oneOf(SEASON_STATUSES),
  'season.start': DATE,
  'season.end': DATE,
  'season.text': TEXT,

  ages: CONTAINER,
  'ages.min': NUMBER,
  'ages.max': NUMBER,
  grades: CONTAINER,
  'grades.min': NUMBER,
  'grades.max': NUMBER,
  'grades.basis': oneOf(GRADE_BASES),

  hours: CONTAINER,
  'hours.start': TIME,
  'hours.end': TIME,
  'hours.text': TEXT,
  extended_care: CONTAINER,
  'extended_care.early_dropoff_start': TIME,
  'extended_care.late_pickup_end': TIME,
  'extended_care.cost_text': TEXT,

  prices: CONTAINER,
  'prices[]': CONTAINER,
  'prices[].amount': NUMBER,
  'prices[].unit': oneOf(PRICE_UNITS),
  'prices[].label': TEXT,
  'prices[].year': NUMBER,

  sites: CONTAINER,
  'sites[]': CONTAINER,
  'sites[].name': TEXT,
  'sites[].address': TEXT,
  'sites[].town': TEXT,
  'sites[].state': TEXT,
  'sites[].driveMinutes': NUMBER,
  'sites[].driveFromTown': BOOLEAN,

  sessions: CONTAINER,
  'sessions[]': CONTAINER,
  'sessions[].label': TEXT,
  'sessions[].start': DATE,
  'sessions[].end': DATE,
  'sessions[].year': NUMBER,
  'sessions[].site': TEXT,
  'sessions[].ages': CONTAINER,
  'sessions[].ages.min': NUMBER,
  'sessions[].ages.max': NUMBER,
  'sessions[].grades': CONTAINER,
  'sessions[].grades.min': NUMBER,
  'sessions[].grades.max': NUMBER,
  'sessions[].grades.basis': oneOf(GRADE_BASES),
  'sessions[].hours': CONTAINER,
  'sessions[].hours.start': TIME,
  'sessions[].hours.end': TIME,
  'sessions[].price': CONTAINER,
  'sessions[].price.amount': NUMBER,
  'sessions[].price.unit': oneOf(PRICE_UNITS),
  'sessions[].price.label': TEXT,
  'sessions[].price.year': NUMBER,
  'sessions[].status': oneOf(AVAILABILITY_STATUSES),

  registration: CONTAINER,
  'registration[]': CONTAINER,
  'registration[].audience': oneOf(AUDIENCES),
  'registration[].kind': oneOf(MILESTONE_KINDS),
  'registration[].date': DATE,
  'registration[].time': TIME,
  'registration[].precision': oneOf(PRECISIONS),
  'registration[].certainty': oneOf(['announced', 'expected']),
  'registration[].text': TEXT,
  'registration[].url': TEXT,
  'registration[].year': NUMBER,
  'registration[].unconfirmed': BOOLEAN,

  last_year_registration_opened: CONTAINER,
  'last_year_registration_opened.date': DATE,
  'last_year_registration_opened.time': TIME,
  'last_year_registration_opened.text': TEXT,
  'last_year_registration_opened.url': TEXT,

  availability: CONTAINER,
  'availability.status': oneOf(AVAILABILITY_STATUSES),
  'availability.scope': TEXT,
  'availability.text': TEXT,

  ...SUPPORT('financial_aid'),
  ...SUPPORT('special_needs'),
  ...SUPPORT('lunch'),
  ...SUPPORT('transportation'),
};

/** The tool schema's path enum. */
export const WHERE_PATHS = Object.keys(CARD_FIELDS);

export const WHERE_OPS: readonly WhereOp[] = [
  'eq',
  'ne',
  'lte',
  'gte',
  'contains',
  'not_contains',
  'exists',
  'missing',
];

export const OPS_BY_KIND: Record<FieldKind, readonly WhereOp[]> = {
  text: ['eq', 'ne', 'contains', 'not_contains', 'exists', 'missing'],
  number: ['eq', 'ne', 'lte', 'gte', 'exists', 'missing'],
  date: ['eq', 'ne', 'lte', 'gte', 'exists', 'missing'],
  time: ['eq', 'ne', 'lte', 'gte', 'exists', 'missing'],
  enum: ['eq', 'ne', 'exists', 'missing'],
  boolean: ['eq', 'ne', 'exists', 'missing'],
  container: ['exists', 'missing'],
};

/** The arrays whose items a clause can address; positives under one must hold on one item. */
export type ArrayRoot = 'categories' | 'prices' | 'sites' | 'sessions' | 'registration';

/**
 * "sessions[].price.amount" is { root: 'sessions', rest: ['price', 'amount'] }; "season.start" is
 * { root: null, rest: ['season', 'start'] }; "categories[]" is { root: 'categories', rest: [] }.
 */
export function splitPath(path: string): { root: ArrayRoot | null; rest: string[] } {
  const at = path.indexOf('[]');
  if (at < 0) return { root: null, rest: path.split('.') };
  const rest = path.slice(at + 2).replace(/^\./, '');
  return { root: path.slice(0, at) as ArrayRoot, rest: rest ? rest.split('.') : [] };
}

/** A short error naming what the path or operator may be. */
export function unknownPathError(path: unknown): string {
  const near =
    typeof path === 'string'
      ? WHERE_PATHS.filter((known) => {
          const leaf =
            path
              .split(/[.[\]]+/)
              .filter(Boolean)
              .at(-1) ?? path;
          return known.includes(leaf);
        }).slice(0, 8)
      : [];
  return `Unknown where path ${JSON.stringify(path)}. Use a listed path${
    near.length > 0 ? `, e.g. ${near.join(', ')}` : ''
  }; nested fields use [] for arrays (sessions[].label).`;
}

export function opError(path: string, op: unknown): string {
  const field = CARD_FIELDS[path];
  return `where ${path} (${field.kind}) allows op ${OPS_BY_KIND[field.kind].join(', ')}; got ${JSON.stringify(op)}.`;
}

export function valueError(path: string, op: string): string {
  const field = CARD_FIELDS[path];
  if (op === 'exists' || op === 'missing') return `where ${path} ${op} takes value null.`;
  const expected = {
    text: 'nonblank text up to 200 characters',
    number: 'a number as a string, e.g. "300"',
    date: 'a real YYYY-MM-DD date',
    time: 'HH:MM on a 24-hour clock',
    enum: `one of ${field.values?.join(', ')}`,
    boolean: '"true" or "false"',
    container: 'null',
  }[field.kind];
  return `where ${path} ${op} needs value ${expected}.`;
}
