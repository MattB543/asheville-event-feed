/**
 * The v2 camp contract (docs/camps/04-v2-plan.md): what Sol extracts for a provider, one card per
 * program, with sites, weeks/themes, age bands and price tiers as rows inside the card.
 *
 * Nothing here is checked by code. Sol rates its own confidence per card and per registration
 * date; anything short of `high` goes to Matt's review queue at /admin/camps.
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

export const AVAILABILITY_STATUSES = ['available', 'mixed', 'waitlist', 'full', 'closed'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const GRADE_BASES = ['rising', 'completed', 'current', 'unspecified'] as const;
export type GradeBasis = (typeof GRADE_BASES)[number];

export const PRICE_UNITS = ['week', 'session', 'day', 'program', 'month', 'other'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Whether the provider has posted its 2027 camp information yet. */
export const SEASON_STATUSES = ['posted', 'coming_soon', 'not_posted'] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const SUPPORT_VALUES = ['yes', 'case_by_case', 'no'] as const;
export type SupportValue = (typeof SUPPORT_VALUES)[number];

/** Ages in years. Grades as numbers: pre-K -1, kindergarten 0, 1st 1 ... 12th 12. */
export interface AgeRange {
  min: number | null;
  max: number | null;
}
export interface GradeRange {
  min: number | null;
  max: number | null;
  basis: GradeBasis;
}

/** An attendance site: where campers are dropped off, not a field-trip destination. */
export interface Site {
  name: string;
  /** Street address ("201 Beaverdam Rd"); looked up when the camp's page doesn't print it. */
  address: string | null;
  town: string | null;
  /** Two-letter state. */
  state: string | null;
}

export interface Hours {
  start: string | null; // HH:MM, 24h, Eastern
  end: string | null;
}

export interface PriceTier {
  amount: number; // dollars
  unit: PriceUnit;
  /** Which price this is: "member", "half day", "ages 4-7, non-resident" ... */
  label: string | null;
  /** The summer the price is for (2027, or 2026 when 2027 isn't posted). */
  year: number;
}

/** One row inside a card: a week, theme, session, age band or site, as the camp lists them. */
export interface Session {
  label: string | null; // "Week 3: Bugs!", "Session A", "Ages 8-10"
  start: string; // YYYY-MM-DD
  end: string;
  year: number;
  /** A `Site.name` from the card, when the card has several sites. */
  site: string | null;
  /** Only when this row's eligibility differs from the card's. */
  ages: AgeRange | null;
  grades: GradeRange | null;
  hours: Hours | null;
  price: PriceTier | null;
  status: AvailabilityStatus | null;
}

export interface Milestone {
  audience: Audience;
  kind: MilestoneKind;
  date: string; // YYYY-MM-DD; for precision 'month', the 1st
  time: string | null; // HH:MM 24h Eastern, only when stated
  precision: Precision;
  /** "Registration opens Jan 10" is announced; "expected mid-December" is expected. */
  certainty: 'announced' | 'expected';
  /** As the page states it, e.g. "Member registration opens January 10 at 9:00 a.m." */
  text: string;
  /** The page that says it. */
  url: string;
  /** The summer it's for (2027); the date itself may fall in 2026. */
  year: number;
  confidence: Confidence;
}

export interface SupportFact {
  value: SupportValue;
  /** The camp's own wording, shown instead of a badge. */
  text: string;
}

export interface CampCard {
  /** Program name. Reuse the name given in "Existing programs" when it's the same program. */
  name: string;
  type: CampType;
  categories: CampCategory[];
  /** One or two plain factual sentences on what campers do. */
  description: string;
  camp_page_url: string | null;
  registration_url: string | null;
  /** The summer the card's dates describe, and whether 2027 is posted yet. */
  season: {
    year: number;
    status: SeasonStatus;
    start: string | null; // YYYY-MM-DD
    end: string | null;
    /** E.g. "2027 dates coming in January", when the page says so. */
    text: string | null;
  };
  /** Overall eligibility across every row. */
  ages: AgeRange | null;
  grades: GradeRange | null;
  sites: Site[];
  hours: (Hours & { text: string | null }) | null;
  extended_care: {
    early_dropoff_start: string | null;
    late_pickup_end: string | null;
    cost_text: string | null;
  } | null;
  /** Tiers that apply across sessions. A row's own price goes on the row. */
  prices: PriceTier[];
  /** Weeks, themes, age bands, sites as rows; [] when the camp lists none. */
  sessions: Session[];
  registration: Milestone[];
  last_year_registration_opened: {
    date: string;
    time: string | null;
    text: string;
    url: string;
  } | null;
  availability: { status: AvailabilityStatus; scope: string | null; text: string } | null;
  financial_aid: SupportFact | null;
  special_needs: SupportFact | null;
  lunch: SupportFact | null;
  transportation: SupportFact | null;
  /** The official pages this card was read from. */
  sources: string[];
  confidence: Confidence;
  /** What a reviewer should check, when confidence isn't high. */
  review_notes: string | null;
}

export interface ProviderExtraction {
  provider_name: string;
  website_url: string | null;
  notes: string | null;
  excluded: Array<{ name: string; reason: string }>;
  cards: CampCard[];
}

/** One provider from discovery (data/camps/providers.json). */
export interface Provider {
  /** Stable slug; never changes once assigned. */
  key: string;
  name: string;
  /** Official camp pages; the first few seed the extraction bundle. */
  urls: string[];
  area: string | null;
  /** Context for extraction, e.g. "VBS posted only on Facebook". */
  hint?: string;
  /** Read by the deterministic WebTrac catalog parser instead of Sol. */
  webtrac?: boolean;
  /** Which discovery methods found it (seed_sheet, grid, aggregator, our_db ...). */
  discovered_by: string[];
  /** 'review' when its URL didn't resolve or the page didn't mention a kids' program. */
  status: 'ok' | 'review';
  status_reason?: string;
}

/** Stable identity of a card: provider key + slug of the program name. */
export function campKeyFor(providerKey: string, programName: string): string {
  return `${providerKey}:${slugPart(programName)}`;
}

export function slugPart(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Needs Matt's review: the card or any registration date is less than high confidence. */
export function needsReview(card: CampCard): boolean {
  return card.confidence !== 'high' || card.registration.some((m) => m.confidence !== 'high');
}
