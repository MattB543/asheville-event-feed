/**
 * What /camps and /camps/[slug] show, from v2 program cards (lib/camps/contract.ts). Pure
 * functions, no I/O: the directory's client component imports them too.
 *
 * A card describes one summer (`season.year`): 2027 when the camp has posted it, else 2026, and
 * prices and weeks from 2026 carry a "2026" label (D12). The helpers take the directory's trimmed
 * card (CampListCard); a full CampCard fits that shape too.
 */

import { parseAsEastern } from '@/lib/utils/timezone';
import type {
  AgeRange,
  Audience,
  GradeRange,
  MilestoneKind,
  PriceUnit,
  SupportValue,
} from './contract';
import type {
  CampListCard,
  CampListItem,
  CampListMilestone,
  CampSiteInfo,
} from '@/lib/db/queries/camps';

export const TARGET_SEASON = 2027;

export const AI_NOTICE =
  "This info was pulled from each camp's website by AI. Double-check with the camp before booking anything.";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const TYPE_LABELS: Record<string, string> = {
  day: 'Day camp',
  half_day: 'Half-day',
  overnight: 'Overnight',
  evening: 'Evening',
  vbs: 'Vacation Bible School',
  clinic: 'Clinic',
  pre_college: 'Pre-college',
};

export const CATEGORY_LABELS: Record<string, string> = {
  arts: 'Arts',
  music: 'Music',
  theater: 'Theater',
  dance: 'Dance',
  stem: 'STEM',
  nature_outdoor: 'Nature & outdoors',
  sports: 'Sports',
  horses: 'Horses',
  cooking: 'Cooking',
  academic: 'Academic',
  faith_based: 'Faith-based',
  general: 'General',
  special_needs: 'Special needs',
};

export const SUPPORT_LABELS = {
  financial_aid: 'Financial aid',
  special_needs: 'Special-needs support',
  lunch: 'Lunch included',
  transportation: 'Transportation',
  extended_care: 'Before/after care',
} as const;
export type SupportKey = keyof typeof SUPPORT_LABELS;

export const AVAILABILITY_LABELS: Record<string, string> = {
  available: 'Open',
  mixed: 'Some sessions full',
  waitlist: 'Waitlist',
  full: 'Full',
  closed: 'Closed',
};

export const SUPPORT_VALUE_LABELS: Record<SupportValue, string> = {
  yes: 'Yes',
  case_by_case: 'Case by case',
  no: 'No',
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatDate(date: string, withYear = false): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}${withYear ? `, ${year}` : ''}`;
}

export function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** "13:00" -> "1 p.m.", "08:30" -> "8:30 a.m." */
export function formatTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number);
  const suffix = hour >= 12 ? 'p.m.' : 'a.m.';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${suffix}`;
}

/** "7:30 a.m. – 5:30 p.m."; one end alone when that's all the camp says. */
export function formatHours(
  hours: { start: string | null; end: string | null } | null
): string | null {
  if (!hours) return null;
  const start = formatTime(hours.start);
  const end = formatTime(hours.end);
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  return end ? `Until ${end}` : null;
}

/** "Drop-off from 7 a.m., pickup until 6 p.m." from a card's extended care. */
export function formatExtendedCare(care: CampListCard['extended_care']): string | null {
  if (!care) return null;
  const parts = [
    care.early_dropoff_start && `drop-off from ${formatTime(care.early_dropoff_start)}`,
    care.late_pickup_end && `pickup until ${formatTime(care.late_pickup_end)}`,
  ].filter(Boolean);
  return parts.length > 0 ? capitalize(parts.join(', ')) : 'Extended care offered';
}

export function gradeLabel(grade: number): string {
  if (grade < 0) return 'Pre-K';
  if (grade === 0) return 'K';
  const suffix =
    grade % 10 === 1 && grade !== 11
      ? 'st'
      : grade % 10 === 2 && grade !== 12
        ? 'nd'
        : grade % 10 === 3 && grade !== 13
          ? 'rd'
          : 'th';
  return `${grade}${suffix}`;
}

export function formatGrades(grades: GradeRange | null): string | null {
  if (!grades || (grades.min === null && grades.max === null)) return null;
  const range =
    grades.min !== null && grades.max !== null
      ? grades.min === grades.max
        ? gradeLabel(grades.min)
        : `${gradeLabel(grades.min)}–${gradeLabel(grades.max)}`
      : grades.min !== null
        ? `${gradeLabel(grades.min)} grade and up`
        : `up to ${gradeLabel(grades.max!)} grade`;
  const prefix =
    grades.basis === 'rising' ? 'Rising ' : grades.basis === 'completed' ? 'Finished ' : '';
  return `${prefix}${range}${grades.min !== null && grades.max !== null ? ' grade' : ''}`;
}

export function formatAges(ages: AgeRange | null): string | null {
  if (!ages || (ages.min === null && ages.max === null)) return null;
  if (ages.min !== null && ages.max !== null)
    return ages.min === ages.max ? `Age ${ages.min}` : `Ages ${ages.min}–${ages.max}`;
  return ages.min !== null ? `Ages ${ages.min}+` : `Up to age ${ages.max}`;
}

/** "Ages 9–15 · Rising 5th–8th grade", or null when the camp states neither. */
export function formatWho(ages: AgeRange | null, grades: GradeRange | null): string | null {
  return [formatAges(ages), formatGrades(grades)].filter(Boolean).join(' · ') || null;
}

export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? `$${amount.toLocaleString('en-US')}` : `$${amount.toFixed(2)}`;
}

const UNIT_LABEL: Record<string, string> = {
  week: '/week',
  session: '/session',
  day: '/day',
  program: '',
  month: '/month',
  other: '',
};

export function formatPriceTier(price: { amount: number; unit: string }): string {
  return price.amount === 0
    ? 'Free'
    : `${formatPrice(price.amount)}${UNIT_LABEL[price.unit] ?? ''}`;
}

/** "$325–$375/week"; mixed units are shown per unit ("$375/week · $85/day"), never merged. */
export function formatPriceRange(prices: Array<{ amount: number; unit: string }>): string | null {
  if (prices.length === 0) return null;
  const byUnit = new Map<string, number[]>();
  for (const price of prices)
    byUnit.set(price.unit, [...(byUnit.get(price.unit) ?? []), price.amount]);
  return [...byUnit.entries()]
    .sort(([, a], [, b]) => Math.max(...b) - Math.max(...a))
    .slice(0, 2)
    .map(([unit, amounts]) => {
      const min = Math.min(...amounts);
      const max = Math.max(...amounts);
      if (max === 0) return 'Free';
      const range = min === max ? formatPrice(min) : `${formatPrice(min)}–${formatPrice(max)}`;
      return `${range}${UNIT_LABEL[unit] ?? ''}`;
    })
    .join(' · ');
}

/** Whole minutes for a drive time, never 0. */
export function driveLabel(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`;
}

/** "Asheville", or "Cleveland, SC" outside North Carolina. */
export function siteTown(site: Pick<CampSiteInfo, 'town' | 'state'>): string | null {
  if (!site.town) return null;
  return site.state && site.state !== 'NC' ? `${site.town}, ${site.state}` : site.town;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Days from `start` to `end` (YYYY-MM-DD), both counted. */
function daySpan(start: string, end: string): number {
  const days =
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}

// ---------------------------------------------------------------------------
// Registration (01 §4.3): what a parent sees first
// ---------------------------------------------------------------------------

/**
 * The date names an audience and a kind, e.g. "Member registration opens" (or "... opened" with
 * `past`).
 */
export function milestoneLabel(
  milestone: { audience: Audience; kind: MilestoneKind },
  past = false
): string {
  if (milestone.kind === 'lottery_results') return 'Lottery results';
  if (milestone.audience === 'lottery') {
    return {
      opens: `Lottery applications ${past ? 'opened' : 'open'}`,
      deadline: 'Lottery application deadline',
      closes: `Lottery applications ${past ? 'closed' : 'close'}`,
    }[milestone.kind];
  }
  const what = {
    opens: `registration ${past ? 'opened' : 'opens'}`,
    deadline: 'registration deadline',
    closes: `registration ${past ? 'closed' : 'closes'}`,
  }[milestone.kind];
  const who: Record<Audience, string> = {
    public: '',
    member: 'Member',
    returning: 'Returning-camper',
    lottery: '',
    resident: 'Resident',
    early_bird: 'Early-bird',
    other: '',
  };
  if (milestone.audience === 'other') return `${capitalize(what)} for some families`;
  return capitalize(who[milestone.audience] ? `${who[milestone.audience]} ${what}` : what);
}

/** "Jan 10, 2027, 9 a.m.", "Jan 10, 2027", or "in December 2026" for a month. */
export function milestoneWhen(
  milestone: Pick<CampListMilestone, 'date' | 'time' | 'precision'>
): string {
  if (milestone.precision === 'month') {
    const [year, month] = milestone.date.split('-').map(Number);
    return `in ${MONTHS_LONG[month - 1]} ${year}`;
  }
  const time = milestone.precision === 'datetime' ? formatTime(milestone.time) : null;
  return `${formatDate(milestone.date, true)}${time ? `, ${time}` : ''}`;
}

/** Shown as "unconfirmed": short of high confidence, and Matt hasn't confirmed the card as it is. */
export function isUnconfirmed(milestone: { confidence: string }, confirmed: boolean): boolean {
  return milestone.confidence !== 'high' && !confirmed;
}

/**
 * Until when a date still reads as ahead: its stated time; a date with no time, the whole day; a
 * month, the whole month. Eastern time.
 */
export function upcomingUntil(
  milestone: Pick<CampListMilestone, 'date' | 'time' | 'precision'>
): Date {
  if (milestone.precision === 'datetime' && milestone.time) {
    return parseAsEastern(milestone.date, `${milestone.time}:00`);
  }
  const [year, month, day] = milestone.date.split('-').map(Number);
  const next =
    milestone.precision === 'month'
      ? new Date(Date.UTC(year, month, 1))
      : new Date(Date.UTC(year, month - 1, day + 1));
  return parseAsEastern(next.toISOString().slice(0, 10), '00:00:00');
}

/** Dates in milestone order: by date, then time (a date with no time first). */
export function byMilestoneDate(a: CampListMilestone, b: CampListMilestone): number {
  return `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`);
}

/** The directory's registration filter. */
export type RegistrationStatus = 'open' | 'soon' | 'later' | 'not_announced' | 'full';

export const REGISTRATION_FILTERS: Array<{ value: RegistrationStatus; label: string }> = [
  { value: 'open', label: 'Open now' },
  { value: 'soon', label: 'Opens within 14 days' },
  { value: 'not_announced', label: 'Not announced' },
  { value: 'full', label: 'Waitlist, full or closed' },
];

export interface RegistrationLine {
  tone: 'upcoming' | 'open' | 'tentative' | 'unknown' | 'closed';
  text: string;
  detail: string | null;
  /** The date the line is about, for sorting; null when there isn't one. */
  sortDate: string | null;
  /** The date the line names is unconfirmed. */
  unconfirmed: boolean;
  status: RegistrationStatus;
}

/** "All four sessions" speaks for the whole camp; "Session A" doesn't. */
function coversCamp(scope: string | null): boolean {
  return !scope || /^(?:all|every)\b/i.test(scope);
}

const SOON_DAYS = 14;

export function registrationLine(
  card: CampListCard,
  confirmed: boolean,
  now: Date
): RegistrationLine {
  const current = card.registration
    .filter((milestone) => milestone.year === TARGET_SEASON)
    .sort(byMilestoneDate);
  const announced = current.filter((milestone) => milestone.certainty === 'announced');
  const ahead = announced.filter((milestone) => now < upcomingUntil(milestone));
  const passedOpens = announced.filter(
    (milestone) => milestone.kind === 'opens' && now >= upcomingUntil(milestone)
  );
  // A card still on 2026 describes 2026's availability, which says nothing about 2027.
  const availability = card.season.year === TARGET_SEASON ? card.availability : null;
  const campWide = availability && coversCamp(availability.scope) ? availability : null;
  const scoped = availability && !coversCamp(availability.scope) ? availability : null;
  const scopedText = scoped
    ? `${AVAILABILITY_LABELS[scoped.status] ?? scoped.status}: ${scoped.scope}`
    : null;
  const join = (...parts: Array<string | null | false | undefined>) =>
    parts.filter(Boolean).join(' · ') || null;

  const closing = announced.find(
    (milestone) =>
      milestone.audience === 'public' &&
      (milestone.kind === 'closes' || milestone.kind === 'deadline') &&
      now >= upcomingUntil(milestone)
  );
  if (closing) {
    return {
      tone: 'closed',
      text: `2027 registration ${closing.kind === 'closes' ? 'closed' : 'deadline passed'} ${formatDate(closing.date, true)}`,
      detail: null,
      sortDate: null,
      unconfirmed: isUnconfirmed(closing, confirmed),
      status: 'full',
    };
  }

  if (campWide && ['full', 'waitlist', 'closed'].includes(campWide.status)) {
    return {
      tone: 'closed',
      text: `2027: ${AVAILABILITY_LABELS[campWide.status].toLowerCase()}`,
      detail: null,
      sortDate: null,
      unconfirmed: false,
      status: 'full',
    };
  }

  const say = (milestone: CampListMilestone) =>
    `${milestoneLabel(milestone)} ${milestoneWhen(milestone)}`;

  // An opening still ahead: the public one leads, members-first and lottery dates go underneath.
  const opensAhead = ahead.filter((milestone) => milestone.kind === 'opens');
  const next = opensAhead.find((milestone) => milestone.audience === 'public') ?? opensAhead[0];
  if (next) {
    const days = (upcomingUntil(next).getTime() - now.getTime()) / 86400000;
    return {
      tone: 'upcoming',
      text: say(next),
      detail: join(
        ...ahead
          .filter((milestone) => milestone !== next)
          .slice(0, 2)
          .map(say),
        scopedText
      ),
      sortDate: next.date,
      unconfirmed: isUnconfirmed(next, confirmed),
      status: days <= SOON_DAYS ? 'soon' : 'later',
    };
  }

  // Open: an opening has passed, the camp says it's open, or a deadline is still ahead (a
  // deadline means registration is taking place). The deadline leads, being what a parent acts on.
  const deadline = ahead[0];
  if (passedOpens.length > 0 || campWide || deadline) {
    const last =
      passedOpens.findLast((milestone) => milestone.audience === 'public') ?? passedOpens.at(-1);
    // A past opening is history, not proof registration is still open: say when it opened.
    const opened = last
      ? `${milestoneLabel(last, true)} ${last.precision === 'month' ? milestoneWhen(last) : formatDate(last.date, true)}`
      : null;
    const status =
      campWide?.status === 'mixed'
        ? '2027: open, some sessions full'
        : campWide
          ? '2027 registration open'
          : null;
    const lead = deadline ? say(deadline) : (status ?? opened!);
    return {
      tone: 'open',
      text: lead,
      detail: join(
        deadline && status,
        lead !== opened && opened,
        ...ahead.slice(1, 2).map(say),
        scopedText
      ),
      sortDate: deadline?.date ?? null,
      unconfirmed: deadline
        ? isUnconfirmed(deadline, confirmed)
        : !campWide && !!last && isUnconfirmed(last, confirmed),
      status: 'open',
    };
  }

  // "Expected mid-December": worth saying, never a firm date, and history once it's gone.
  const expected = current.find((milestone) => milestone.kind === 'opens');
  if (expected) {
    const live = now < upcomingUntil(expected);
    return {
      tone: live ? 'tentative' : 'unknown',
      text: `Registration ${live ? 'expected' : 'was expected'} ${milestoneWhen(expected)}`,
      detail: join(
        live ? 'Not confirmed by the camp yet' : 'Check the camp’s site for the date',
        scopedText
      ),
      sortDate: live ? expected.date : null,
      unconfirmed: isUnconfirmed(expected, confirmed),
      status: 'not_announced',
    };
  }

  const lastYear = card.last_year_registration_opened
    ? `Last year it opened ${formatDate(card.last_year_registration_opened.date, true)}`
    : null;
  const posted = card.season.year === TARGET_SEASON && card.season.status === 'posted';
  return {
    tone: 'unknown',
    text: posted
      ? '2027 dates posted; registration date not posted yet'
      : '2027 registration not announced yet',
    detail: join(lastYear, scopedText),
    sortDate: null,
    unconfirmed: false,
    status: 'not_announced',
  };
}

/**
 * The 2027 dates still worth a reminder: announced or expected, not yet passed. Empty when the camp
 * hasn't posted one (the button then reads "Registration date not posted yet").
 */
export function reminderMilestones<M extends CampListMilestone>(
  card: { registration: M[] },
  now: Date
): M[] {
  return card.registration
    .filter((milestone) => milestone.year === TARGET_SEASON && now < upcomingUntil(milestone))
    .sort(byMilestoneDate);
}

// ---------------------------------------------------------------------------
// Eligibility (N11: ages and grades are separate; a parent's age is tested against grades by
// converting, never the camp's)
// ---------------------------------------------------------------------------

/** Does a camp take a kid of this age (during summer 2027)? Null when it states no ages. */
export function fitsAge(ages: AgeRange | null, age: number): boolean | null {
  if (!ages || (ages.min === null && ages.max === null)) return null;
  return (ages.min === null || age >= ages.min) && (ages.max === null || age <= ages.max);
}

/**
 * Does a camp take a kid entering this grade in fall 2027 ("rising" grade)? "Completed 2nd" and
 * "current 2nd" (this school year) are both rising 3rd. "3rd-9th" alone could be either, so it
 * fits when either reading does. Null when the camp states no grades.
 */
export function fitsGrade(grades: GradeRange | null, risingGrade: number): boolean | null {
  if (!grades || (grades.min === null && grades.max === null)) return null;
  const within = (grade: number) =>
    (grades.min === null || grade >= grades.min) && (grades.max === null || grade <= grades.max);
  if (grades.basis === 'rising') return within(risingGrade);
  if (grades.basis === 'completed' || grades.basis === 'current') return within(risingGrade - 1);
  return within(risingGrade) || within(risingGrade - 1);
}

/**
 * Does a camp take this kid? Each thing the parent gave is tested against what the camp states,
 * converting when the camp states the other one: a rising 2nd grader is 7 or 8 next summer, and a
 * 7-year-old is a rising 1st or 2nd grader. Null when the camp states neither ages nor grades.
 */
export function fitsKid(
  camp: { ages: AgeRange | null; grades: GradeRange | null },
  kid: { age: number | null; grade: number | null }
): boolean | null {
  const states = (range: AgeRange | GradeRange | null) =>
    !!range && (range.min !== null || range.max !== null);
  const results: Array<boolean | null> = [];
  if (kid.age !== null) {
    results.push(
      states(camp.ages)
        ? fitsAge(camp.ages, kid.age)
        : fitsGrade(camp.grades, kid.age - 5) || fitsGrade(camp.grades, kid.age - 6)
    );
  }
  if (kid.grade !== null) {
    results.push(
      states(camp.grades)
        ? fitsGrade(camp.grades, kid.grade)
        : fitsAge(camp.ages, kid.grade + 5) || fitsAge(camp.ages, kid.grade + 6)
    );
  }
  if (results.includes(false)) return false;
  return results.includes(true) ? true : null;
}

// ---------------------------------------------------------------------------
// Prices and weeks for the filters
// ---------------------------------------------------------------------------

/**
 * A price as dollars a week, where its unit allows: a day is a 5-day week, a session or program
 * is spread over its weeks (when its dates are known). Null when it can't be said.
 */
export function weeklyPrice(
  price: { amount: number; unit: PriceUnit },
  days: number | null
): number | null {
  switch (price.unit) {
    case 'week':
      return price.amount;
    case 'day':
      return price.amount * Math.min(5, days ?? 5);
    case 'month':
      return (price.amount * 12) / 52;
    case 'session':
    case 'program':
      return days ? price.amount / Math.max(1, Math.round(days / 7)) : null;
    default:
      return null;
  }
}

export const PRICE_BANDS = [
  { value: 'free', label: 'Free', test: (week: number) => week === 0 },
  { value: 'under150', label: 'Under $150 a week', test: (week: number) => week > 0 && week < 150 },
  {
    value: '150-300',
    label: '$150–$300 a week',
    test: (week: number) => week >= 150 && week <= 300,
  },
  { value: 'over300', label: 'Over $300 a week', test: (week: number) => week > 300 },
] as const;
export type PriceBand = (typeof PRICE_BANDS)[number]['value'];

/** The summer's weeks for the "week of" filter: Monday to Friday, May 31 - Aug 20, 2027. */
export const SUMMER_WEEKS = Array.from({ length: 12 }, (_, index) => {
  const monday = new Date(Date.UTC(2027, 4, 31 + index * 7));
  const friday = new Date(Date.UTC(2027, 4, 31 + index * 7 + 4));
  const start = monday.toISOString().slice(0, 10);
  return { start, end: friday.toISOString().slice(0, 10), label: `Week of ${formatDate(start)}` };
});

// ---------------------------------------------------------------------------
// Card data for the browser
// ---------------------------------------------------------------------------

/** A value with the summer it describes, for "2026" labels. */
export interface Labeled {
  text: string;
  year: number;
}

/**
 * One row of a card as the filters read it: a week, session or age band, with the eligibility and
 * weekly prices that apply to it. A card listing no rows gets one row for its whole season.
 */
export interface CampRow {
  start: string | null;
  end: string | null;
  ages: AgeRange | null;
  grades: GradeRange | null;
  /** Dollars a week for each price that applies; empty when unknown. */
  weekly: number[];
}

/** What the directory needs per camp: small enough to send to the browser. */
export interface CampCardData {
  id: string;
  slug: string;
  name: string;
  providerName: string;
  type: string;
  categories: string[];
  /** Lowercased text the search box matches. */
  search: string;
  who: string | null;
  /** "Asheville, Hendersonville · 12–30 min drive" */
  place: string | null;
  /** The nearest site's drive from downtown; null when no site is placed. */
  driveMinutes: number | null;
  price: Labeled | null;
  /** The lowest weekly price, for sorting. */
  priceSort: number | null;
  season: Labeled | null;
  hours: string | null;
  care: string | null;
  registration: RegistrationLine;
  /** Support the camp says it has (yes or case by case). */
  support: SupportKey[];
  rows: CampRow[];
  /** The camp lists its own rows (otherwise `rows` is one for the season). */
  listsRows: boolean;
  /** "week" when every row is a week long, else "session". */
  rowNoun: 'week' | 'session';
  views: number;
  websiteUrl: string | null;
  /** A 2027 date still ahead, so "Add reminder" has something to add. */
  hasReminder: boolean;
}

export function supportKeys(card: CampListCard): SupportKey[] {
  const has = (fact: { value: SupportValue } | null) => !!fact && fact.value !== 'no';
  const keys: SupportKey[] = (
    ['financial_aid', 'special_needs', 'lunch', 'transportation'] as const
  ).filter((key) => has(card[key]));
  if (card.extended_care) keys.push('extended_care');
  return keys;
}

/** Rows for the filters, without sites (the drive filter is per camp) and without repeats. */
function campRows(card: CampListCard): CampRow[] {
  const prices = (days: number | null, own: CampListCard['prices'][number] | null) =>
    (own ? [own] : card.prices)
      .map((price) => weeklyPrice(price, days))
      .filter((week): week is number => week !== null);
  // With no rows, a season of two weeks or less is one program a session price can be spread
  // over; a whole summer isn't.
  const seasonDays =
    card.season.start && card.season.end ? daySpan(card.season.start, card.season.end) : null;

  const rows: CampRow[] =
    card.sessions.length > 0
      ? card.sessions.map((session) => {
          // A row states its own eligibility only when it differs from the card's
          const own = !!session.ages || !!session.grades;
          return {
            start: session.start,
            end: session.end,
            ages: own ? session.ages : card.ages,
            grades: own ? session.grades : card.grades,
            weekly: prices(daySpan(session.start, session.end), session.price),
          };
        })
      : [
          {
            start: card.season.start,
            end: card.season.end,
            ages: card.ages,
            grades: card.grades,
            weekly: prices(seasonDays !== null && seasonDays <= 14 ? seasonDays : null, null),
          },
        ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The places a card runs: towns, then the drive range from downtown. */
function placeText(sites: CampSiteInfo[]): string | null {
  const towns = [...new Set(sites.map(siteTown).filter((town): town is string => !!town))];
  const minutes = sites
    .map((site) => site.driveMinutes)
    .filter((value): value is number => value !== null);
  const drive =
    minutes.length === 0
      ? null
      : Math.round(Math.min(...minutes)) === Math.round(Math.max(...minutes))
        ? `${driveLabel(Math.min(...minutes))} drive`
        : `${Math.max(1, Math.round(Math.min(...minutes)))}–${driveLabel(Math.max(...minutes))} drive`;
  const where =
    towns.length > 3 ? `${towns.slice(0, 3).join(', ')} +${towns.length - 3}` : towns.join(', ');
  const count = sites.length > 1 ? plural(sites.length, 'site') : null;
  return [where || null, drive, count].filter(Boolean).join(' · ') || null;
}

/**
 * Prices for the card: the newest summer's tiers, the card's and its rows'. A flat fee (unit
 * "program" or "other", often a registration fee) shows only when there's no weekly-type price.
 */
function priceText(card: CampListCard): Labeled | null {
  const all = [
    ...card.prices,
    ...card.sessions.flatMap((session) => (session.price ? [session.price] : [])),
  ];
  if (all.length === 0) return null;
  const year = Math.max(...all.map((price) => price.year));
  const newest = all.filter((price) => price.year === year);
  const periodic = newest.filter((price) => price.unit !== 'program' && price.unit !== 'other');
  const text = formatPriceRange(periodic.length > 0 ? periodic : newest);
  return text ? { text, year } : null;
}

const isWeekLong = (row: CampRow) => {
  const days = row.start && row.end ? daySpan(row.start, row.end) : 0;
  return days >= 4 && days <= 7;
};

/** "Jun 15 – Aug 7 · 8 weeks · 24 sessions" (three themes a week), with the summer it's for. */
function seasonText(card: CampListCard, rows: CampRow[]): Labeled | null {
  const starts = card.sessions.map((session) => session.start).sort();
  const ends = card.sessions.map((session) => session.end).sort();
  const start = card.season.start ?? starts[0] ?? null;
  const end = card.season.end ?? ends.at(-1) ?? null;
  const weeks = new Set(rows.map((row) => `${row.start} ${row.end}`)).size;
  const counts =
    card.sessions.length < 2
      ? []
      : rows.every(isWeekLong)
        ? [plural(weeks, 'week'), rows.length > weeks && plural(rows.length, 'session')]
        : [plural(rows.length, 'session')];
  const text =
    [formatDateRange(start, end), ...counts].filter(Boolean).join(' · ') || card.season.text;
  return text ? { text, year: card.season.year } : null;
}

export function toCardData(camp: CampListItem, now: Date): CampCardData {
  const { card } = camp;
  const rows = campRows(card);
  const listsRows = card.sessions.length > 0;
  // "Week" only when each row is its own week; three themes in one week are sessions
  const rowNoun =
    listsRows &&
    rows.every(isWeekLong) &&
    new Set(rows.map((row) => `${row.start} ${row.end}`)).size === rows.length
      ? 'week'
      : 'session';
  const minutes = camp.sites
    .map((site) => site.driveMinutes)
    .filter((value): value is number => value !== null);
  const weekly = rows.flatMap((row) => row.weekly);

  return {
    id: camp.id,
    slug: camp.slug,
    name: card.name,
    providerName: camp.providerName,
    type: card.type,
    categories: card.categories,
    search: [
      card.name,
      camp.providerName,
      card.description,
      TYPE_LABELS[card.type],
      ...card.categories.map((category) => CATEGORY_LABELS[category]),
      ...camp.sites.flatMap((site) => [site.name, site.town]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    who: formatWho(card.ages, card.grades),
    place: placeText(camp.sites),
    driveMinutes: minutes.length > 0 ? Math.min(...minutes) : null,
    price: priceText(card),
    priceSort: weekly.length > 0 ? Math.min(...weekly) : null,
    season: seasonText(card, rows),
    hours: formatHours(card.hours),
    care: card.extended_care ? formatExtendedCare(card.extended_care) : null,
    registration: registrationLine(card, camp.confirmed, now),
    support: supportKeys(card),
    rows,
    listsRows,
    rowNoun,
    views: camp.views,
    websiteUrl: card.camp_page_url ?? camp.providerUrl,
    hasReminder: reminderMilestones(card, now).length > 0,
  };
}
