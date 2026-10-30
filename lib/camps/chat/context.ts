/**
 * The directory's filters (CampDirectory's listKey: its URL parameters) read as context for the
 * camps chat (docs/camps/06-ai-chat-plan.md §5.2). Pure and client-safe: the chat modal shows the
 * lines in its greeting and the server puts the args and notes in the prompt.
 *
 * Every filter keeps the directory's meaning, both price bounds included. A value the directory
 * wouldn't accept is dropped with a note, never applied loosely. The tool session still checks the
 * town against the loaded camps.
 */
import {
  CAMP_CATEGORIES,
  CAMP_TYPES,
  type CampCategory,
  type CampType,
} from '@/lib/camps/contract';
import {
  CATEGORY_LABELS,
  HOURS_FILTERS,
  PRICE_BANDS,
  REGISTRATION_FILTERS,
  SUMMER_WEEKS,
  SUPPORT_LABELS,
  TYPE_LABELS,
  formatDate,
  gradeLabel,
  type SupportKey,
} from '@/lib/camps/display';
import type { CampSearchFilters, DirectoryContext, UnknownFact } from './types';

const MAX_KEYWORDS = 10;
const MAX_KEYWORD_LENGTH = 80;
/** The directory's own limits for "My kids" and its drive-time choices. */
const MAX_KIDS = 4;
const DRIVE_LIMITS = [15, 30, 45];

/** The search_camps price for each of the directory's weekly price bands. */
const PRICE_ARGS: Record<string, NonNullable<CampSearchFilters['price']>> = {
  free: { min: 0, max: 0, per: 'week' },
  under150: { min: 0.01, max: 149.99, per: 'week' },
  '150-300': { min: 150, max: 300, per: 'week' },
  over300: { min: 300.01, max: null, per: 'week' },
};

/** The directory's "show camps without ..." kinds, as search_camps' unknown facts. */
const UNKNOWN_FACTS: Record<string, UnknownFact> = {
  drive: 'location',
  town: 'location',
  week: 'dates',
  price: 'price',
  hours: 'hours',
};

export interface Kid {
  age: number | null;
  grade: number | null;
}

/**
 * A kid as the directory's URL and browser keep it (shared with CampDirectory): "7" is age 7
 * during camp, "g3" a rising 3rd grader (grade in the fall after camp; pre-K g-1, kindergarten g0).
 */
export function parseKid(token: string): Kid | null {
  const match = /^(g?)(-?\d{1,2})$/.exec(token);
  if (!match) return null;
  const value = Number(match[2]);
  if (match[1]) return value >= -1 && value <= 12 ? { age: null, grade: value } : null;
  return value >= 2 && value <= 19 ? { age: value, grade: null } : null;
}

/** "age 7", "rising 3rd grader", for a valid token. */
export function kidName(token: string): string {
  const kid = parseKid(token)!;
  if (kid.age !== null) return `age ${kid.age}`;
  if (kid.grade! < 0) return 'rising pre-K';
  if (kid.grade === 0) return 'rising kindergartner';
  return `rising ${gradeLabel(kid.grade!)} grader`;
}

export function directoryContext(query: string): DirectoryContext {
  const params = new URLSearchParams(query.trim().replace(/^\?/, ''));
  const get = (key: string) => params.get(key)?.trim() ?? '';
  const args: Partial<CampSearchFilters> = {};
  const lines: string[] = [];
  const notes: string[] = [];

  const words = get('q').split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const terms = words.filter(
      (word) => word.length <= MAX_KEYWORD_LENGTH && /[\p{L}\p{N}]/u.test(word)
    );
    const applied = terms.slice(0, MAX_KEYWORDS);
    if (applied.length > 0) {
      args.keywords = applied;
      args.keywordMatch = 'all';
      lines.push(`Search words (all required): ${applied.join(' ')}`);
    }
    if (applied.length < words.length) {
      notes.push(
        `The directory search "${words.join(' ').slice(0, 120)}" was only partly applied: AI keywords take up to ${MAX_KEYWORDS} words of ${MAX_KEYWORD_LENGTH} characters or fewer.`
      );
    }
  }

  const tokens = get('kids').split(',').filter(Boolean);
  const validTokens = [...new Set(tokens.filter((token) => parseKid(token)))];
  const kidTokens = validTokens.slice(0, MAX_KIDS);
  if (validTokens.length < new Set(tokens).size) {
    notes.push('Ignored invalid kids in the directory link.');
  }
  if (kidTokens.length < validTokens.length) {
    notes.push(`Only the first ${MAX_KIDS} kids in the directory link were used.`);
  }
  if (kidTokens.length > 0) {
    const kids = kidTokens.map((token) => parseKid(token)!);
    args.kids = kids;
    const all = get('all');
    args.kidsMode =
      kids.length < 2
        ? 'any'
        : all === '1' || all === 'all'
          ? 'each'
          : all === 'same'
            ? 'same_session'
            : 'any';
    const mode =
      args.kidsMode === 'each'
        ? ' (a session for each)'
        : args.kidsMode === 'same_session'
          ? ' (all in the same session)'
          : kids.length > 1
            ? ' (any of them)'
            : '';
    lines.push(`Kids: ${kidTokens.map(kidName).join(', ')}${mode}`);
  }

  const type = get('type');
  if (type) {
    if (CAMP_TYPES.includes(type as CampType)) {
      args.types = [type as CampType];
      lines.push(`Type: ${TYPE_LABELS[type]}`);
    } else notes.push('Ignored an unrecognized camp type in the directory link.');
  }

  const category = get('cat');
  if (category) {
    if (CAMP_CATEGORIES.includes(category as CampCategory)) {
      args.categories = [category as CampCategory];
      lines.push(`Category: ${CATEGORY_LABELS[category]}`);
    } else notes.push('Ignored an unrecognized category in the directory link.');
  }

  const drive = get('drive');
  if (drive) {
    if (DRIVE_LIMITS.includes(Number(drive))) {
      args.maxDriveMinutes = Number(drive);
      lines.push(`Within a ${drive}-minute drive of downtown Asheville`);
    } else notes.push('Ignored an unrecognized drive time in the directory link.');
  }

  const town = get('town');
  if (town) {
    args.towns = [town.slice(0, 80)];
    lines.push(`Town: ${town.slice(0, 80)}`);
  }

  const weekStart = get('week');
  if (weekStart) {
    const week = SUMMER_WEEKS.find((option) => option.start === weekStart);
    if (week) {
      args.dates = { start: week.start, end: week.end, match: 'overlaps' };
      lines.push(`Runs the week of ${formatDate(week.start, true)} (Mon–Fri)`);
    } else notes.push('Ignored an unrecognized week in the directory link.');
  }

  const hours = get('hours');
  if (hours) {
    if (hours === 'workday') {
      args.dropoffBy = '08:30';
      args.pickupAtOrAfter = '17:00';
      lines.push('Covers a workday: drop-off by 8:30 AM, pickup 5:00 PM or later (care counted)');
    } else if (hours === 'full' || hours === 'half') {
      args.dayLength = hours;
      lines.push(HOURS_FILTERS.find((option) => option.value === hours)!.label);
    } else notes.push('Ignored an unrecognized hours filter in the directory link.');
  }

  const price = get('price');
  if (price) {
    const band = PRICE_BANDS.find((option) => option.value === price);
    if (band) {
      args.price = PRICE_ARGS[price];
      lines.push(`Price: ${band.label}`);
    } else notes.push('Ignored an unrecognized price band in the directory link.');
  }

  const registration = get('reg');
  if (registration) {
    const filter = REGISTRATION_FILTERS.find((option) => option.value === registration);
    if (filter) {
      args.registration = filter.value as NonNullable<CampSearchFilters['registration']>;
      lines.push(`Registration: ${filter.label}`);
      if (registration === 'open') {
        notes.push(
          'The registration filter includes camps whose registration opened earlier, which does not mean spots remain.'
        );
      } else if (registration === 'soon') {
        notes.push(
          "The registration filter goes by the earliest opening for anyone, which may be members' or returning campers' date."
        );
      }
    } else notes.push('Ignored an unrecognized registration filter in the directory link.');
  }

  const needTokens = get('need').split(',').filter(Boolean);
  const needs = [
    ...new Set(needTokens.filter((need) => Object.hasOwn(SUPPORT_LABELS, need))),
  ] as SupportKey[];
  if (needs.length < new Set(needTokens).size) {
    notes.push('Ignored an unrecognized need in the directory link.');
  }
  if (needs.length > 0) {
    args.needs = needs;
    lines.push(`Needs: ${needs.map((need) => SUPPORT_LABELS[need]).join(', ')}`);
  }

  // Shown only where the matching filter is on, as in the directory. ?unknown=1 (older links) is
  // every kind.
  const unknownTokens =
    get('unknown') === '1' ? Object.keys(UNKNOWN_FACTS) : get('unknown').split(',');
  const active: Record<UnknownFact, boolean> = {
    location: args.maxDriveMinutes !== undefined || args.towns !== undefined,
    dates: args.dates !== undefined,
    price: args.price !== undefined,
    hours: args.dropoffBy !== undefined || args.dayLength !== undefined,
  };
  const included = [
    ...new Set(
      unknownTokens
        .map((token) => (Object.hasOwn(UNKNOWN_FACTS, token) ? UNKNOWN_FACTS[token] : null))
        .filter((fact): fact is UnknownFact => !!fact && active[fact])
    ),
  ];
  if (included.length > 0) {
    args.includeUnknown = included;
    lines.push(`Also showing camps that don't state their ${included.join(', ')}`);
  }

  if (get('saved') === '1') {
    notes.push('Saved-only view does not restrict AI; AI searches every listed camp.');
  }
  // group and sort only change how the directory displays its list.

  return { lines, args, notes };
}
