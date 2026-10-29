/**
 * Shapes for the camps pipeline: what extraction returns (with evidence on every fact), what
 * verification adds, and the import rows that mirror the §5 revised tables
 * (docs/camps/01-context-and-plan.md).
 */

export const CAMP_TYPES = [
  'day',
  'half_day',
  'overnight',
  'evening',
  'vbs',
  'clinic',
  'pre_college',
] as const;
export type CampType = (typeof CAMP_TYPES)[number];

export const CAMP_CATEGORIES = [
  'arts',
  'music',
  'theater',
  'dance',
  'stem',
  'nature_outdoor',
  'sports',
  'horses',
  'cooking',
  'academic',
  'faith_based',
  'general',
  'special_needs',
] as const;
export type CampCategory = (typeof CAMP_CATEGORIES)[number];

export const AUDIENCES = [
  'public',
  'member',
  'returning',
  'lottery',
  'resident',
  'early_bird',
  'other',
] as const;
export type Audience = (typeof AUDIENCES)[number];

export const MILESTONE_KINDS = ['opens', 'deadline', 'lottery_results', 'closes'] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const PRECISIONS = ['datetime', 'date', 'month'] as const;
export type Precision = (typeof PRECISIONS)[number];

export const AVAILABILITY_STATUSES = [
  'unknown',
  'available',
  'mixed',
  'waitlist',
  'full',
  'closed',
] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const SOURCE_KINDS = [
  'official_site',
  'registration_platform',
  'official_social',
  'third_party',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const GRADE_BASES = ['rising', 'completed', 'current', 'unspecified'] as const;
export type GradeBasis = (typeof GRADE_BASES)[number];

export const PRICE_UNITS = ['week', 'session', 'day', 'program', 'month', 'other'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** Every extracted fact carries where it came from and which summer it is about. */
export interface Evidence {
  /** The summer the fact applies to (2027, or 2026 when 2027 isn't posted). */
  year: number;
  url: string;
  /** Copied verbatim from the page at `url`. */
  quote: string;
  source_kind: SourceKind;
  /** Added by verify.ts. */
  check?: Check;
}

export interface SeasonDates extends Evidence {
  start: string | null; // YYYY-MM-DD
  end: string | null;
}
export interface Ages extends Evidence {
  min: number | null;
  max: number | null;
}
/** Grades as numbers: pre-K -1, kindergarten 0, 1st 1 ... 12th 12. Never converted to ages (N11). */
export interface Grades extends Evidence {
  min: number | null;
  max: number | null;
  basis: GradeBasis;
}
export interface Hours extends Evidence {
  start: string | null; // HH:MM, 24h
  end: string | null;
}
export interface ExtendedCare extends Evidence {
  early_dropoff_start: string | null;
  late_pickup_end: string | null;
  cost_text: string | null;
}
export interface Price extends Evidence {
  amount: number; // dollars
  unit: PriceUnit;
  tier: string | null; // "member", "resident", "full day 7:30-5:30" ...
}
export interface Fee extends Evidence {
  amount: number;
  label: string;
  per: 'family' | 'camper' | 'session' | 'other';
}
export interface CampLocation extends Evidence {
  name: string;
  address: string | null;
  town: string | null;
  state: string | null;
}
export interface Flag extends Evidence {
  available: boolean;
  details: string | null;
}
export interface Milestone extends Evidence {
  audience: Audience;
  kind: MilestoneKind;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM, 24h, Eastern; only when stated
  precision: Precision;
}
export interface Availability extends Evidence {
  status: AvailabilityStatus;
  scope: string | null;
}
export interface LastYearOpening extends Evidence {
  date: string;
  time: string | null;
}
export interface SessionFact {
  label: string | null;
  start: string;
  end: string;
  year: number;
}

export interface ExtractedCard {
  name: string;
  variant: string | null;
  type: CampType;
  categories: CampCategory[];
  camp_page_url: string | null;
  registration_url: string | null;
  description: string;
  season_dates: SeasonDates | null;
  ages: Ages | null;
  grades: Grades | null;
  hours: Hours | null;
  extended_care: ExtendedCare | null;
  prices: Price[];
  fees: Fee[];
  locations: CampLocation[];
  financial_aid: Flag | null;
  special_needs: Flag | null;
  lunch: Flag | null;
  transportation: Flag | null;
  registration_milestones: Milestone[];
  availability: Availability | null;
  last_year_registration_opened: LastYearOpening | null;
  sessions: SessionFact[];
  /** Platform identities the card was read from (WebTrac FMIDs). Not asked of the model. */
  platform_ids?: Record<string, string[]>;
}

export interface Extraction {
  provider_name: string;
  website_url: string | null;
  notes: string | null;
  excluded: Array<{ name: string; reason: string }>;
  cards: ExtractedCard[];
}

/** The fields of a card that hold one piece of evidence (or null). */
export const SINGLE_EVIDENCE_FIELDS = [
  'season_dates',
  'ages',
  'grades',
  'hours',
  'extended_care',
  'financial_aid',
  'special_needs',
  'lunch',
  'transportation',
  'availability',
  'last_year_registration_opened',
] as const;

/** The fields of a card that hold a list of evidence items. */
export const LIST_EVIDENCE_FIELDS = [
  'prices',
  'fees',
  'locations',
  'registration_milestones',
] as const;

/** Every piece of evidence on a card, with its field name. */
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
// Verification
// ---------------------------------------------------------------------------

export type CheckStatus = 'verified' | 'review' | 'dropped';

export interface Check {
  status: CheckStatus;
  /** How the quote was found: exact / fragments / loose, or why it wasn't. */
  match:
    | 'exact'
    | 'fragments'
    | 'loose'
    | 'not_found'
    | 'fetch_failed'
    | 'hand_check'
    | 'not_checked';
  flags: string[];
  checkedAt: string;
  fetchMethod?: string;
  /** Set when a person (or, in the pilot, the pilot session in a browser) confirmed the fact. */
  handCheckedAt?: string;
  handCheckedBy?: string;
  handCheckNote?: string;
  /** The official page the hand check was made on, when it isn't the cited one (N9). */
  handCheckSource?: string;
  /** Where the cited URL redirected, when it did: the page actually checked. */
  resolvedUrl?: string;
}

/**
 * A fact can be shown as settled: the checker verified it, or someone checked it by hand. A fact
 * the checker marks `needs_hand_check` (every registration milestone, N15) needs the hand check
 * either way.
 */
export function isPublishable(
  check: Pick<Check, 'status' | 'flags' | 'handCheckedAt'> | undefined
): boolean {
  if (!check || check.status === 'dropped') return false;
  if (check.flags.includes('needs_hand_check')) return !!check.handCheckedAt;
  return check.status === 'verified' || !!check.handCheckedAt;
}

// ---------------------------------------------------------------------------
// JSON schema for the extraction call (strict structured output)
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

const str = (description?: string): Schema => ({
  type: 'string',
  ...(description && { description }),
});
const nullableStr = (description?: string): Schema => ({
  type: ['string', 'null'],
  ...(description && { description }),
});
const nullableNum = (description?: string): Schema => ({
  type: ['number', 'null'],
  ...(description && { description }),
});
const enumOf = (values: readonly string[], description?: string): Schema => ({
  type: 'string',
  enum: [...values],
  ...(description && { description }),
});

function object(properties: Record<string, Schema>): Schema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function nullable(schema: Schema): Schema {
  return { anyOf: [schema, { type: 'null' }] };
}

const evidenceProperties: Record<string, Schema> = {
  year: {
    type: 'integer',
    description: 'The summer this fact applies to: 2027, or 2026 when only 2026 is posted.',
  },
  url: str('The exact page (or PDF) the quote is on. Never a search-results page.'),
  quote: str(
    'Text copied character-for-character from that page, 5-300 characters, containing the value. No ellipses, no paraphrase, no added quotation marks, no citation links.'
  ),
  source_kind: enumOf(SOURCE_KINDS),
};

const evidenced = (properties: Record<string, Schema>): Schema =>
  object({ ...properties, ...evidenceProperties });

const cardSchema = object({
  name: str(
    'Program name, e.g. "Adventure Camp". Not the provider name alone unless it has one program.'
  ),
  variant: nullableStr(
    "What separates this card from the provider's other cards (site, age band), or null."
  ),
  type: enumOf(CAMP_TYPES),
  categories: { type: 'array', items: enumOf(CAMP_CATEGORIES) },
  camp_page_url: nullableStr('The official page for this program.'),
  registration_url: nullableStr('Where parents register (official site or registration platform).'),
  description: str(
    'One or two plain factual sentences from the official pages: what kids do. No praise or marketing claims.'
  ),
  season_dates: nullable(
    evidenced({
      start: nullableStr('YYYY-MM-DD, first day of the season'),
      end: nullableStr('YYYY-MM-DD, last day'),
    })
  ),
  ages: nullable(evidenced({ min: nullableNum(), max: nullableNum() })),
  grades: nullable(
    evidenced({
      min: nullableNum('Pre-K -1, kindergarten 0, 1st grade 1 ... 12th grade 12'),
      max: nullableNum(),
      basis: enumOf(
        GRADE_BASES,
        '"rising 3rd grade" is rising; "completed 2nd grade" is completed'
      ),
    })
  ),
  hours: nullable(evidenced({ start: nullableStr('HH:MM 24h'), end: nullableStr('HH:MM 24h') })),
  extended_care: nullable(
    evidenced({
      early_dropoff_start: nullableStr('HH:MM 24h'),
      late_pickup_end: nullableStr('HH:MM 24h'),
      cost_text: nullableStr('Extra cost as stated, e.g. "$50/week"'),
    })
  ),
  prices: {
    type: 'array',
    items: evidenced({
      amount: { type: 'number', description: 'Dollars' },
      unit: enumOf(PRICE_UNITS),
      tier: nullableStr(
        'Which price this is: member, non-member, resident, early bird, full day ...'
      ),
    }),
  },
  fees: {
    type: 'array',
    description: 'Required extra fees (registration, deposit, materials), not tuition.',
    items: evidenced({
      amount: { type: 'number' },
      label: str(),
      per: enumOf(['family', 'camper', 'session', 'other']),
    }),
  },
  locations: {
    type: 'array',
    description: 'Where campers are dropped off and spend the day. Not field-trip destinations.',
    items: evidenced({
      name: str(),
      address: nullableStr('Street address when stated'),
      town: nullableStr(),
      state: nullableStr('Two-letter state'),
    }),
  },
  financial_aid: nullable(evidenced({ available: { type: 'boolean' }, details: nullableStr() })),
  special_needs: nullable(evidenced({ available: { type: 'boolean' }, details: nullableStr() })),
  lunch: nullable(evidenced({ available: { type: 'boolean' }, details: nullableStr() })),
  transportation: nullable(evidenced({ available: { type: 'boolean' }, details: nullableStr() })),
  registration_milestones: {
    type: 'array',
    items: evidenced({
      audience: enumOf(AUDIENCES),
      kind: enumOf(MILESTONE_KINDS),
      date: str('YYYY-MM-DD (the calendar date, which may fall in the year before the season)'),
      time: nullableStr('HH:MM 24h Eastern, only when the page states a time'),
      precision: enumOf(PRECISIONS),
    }),
  },
  availability: nullable(
    evidenced({
      status: enumOf(AVAILABILITY_STATUSES),
      scope: nullableStr('Which sessions the status applies to, when not all'),
    })
  ),
  last_year_registration_opened: nullable(
    evidenced({ date: str('YYYY-MM-DD'), time: nullableStr('HH:MM 24h') })
  ),
  sessions: {
    type: 'array',
    description: 'Individual sessions/weeks when the page lists them cheaply; otherwise [].',
    items: object({
      label: nullableStr(),
      start: str('YYYY-MM-DD'),
      end: str('YYYY-MM-DD'),
      year: { type: 'integer' },
    }),
  },
});

export const EXTRACTION_SCHEMA: Schema = object({
  provider_name: str(),
  website_url: nullableStr("The provider's own website"),
  notes: nullableStr(
    'Anything a reviewer should know: conflicts, missing 2027 info, pages you could not open.'
  ),
  excluded: {
    type: 'array',
    description: 'Offerings you found but left out under the camp rule, with the reason.',
    items: object({ name: str(), reason: str() }),
  },
  cards: { type: 'array', items: cardSchema },
});
