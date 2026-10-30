/**
 * What /camps and /camps/[slug] show, from v2 program cards (lib/camps/contract.ts). Pure
 * functions, no I/O: the directory's client component imports them too.
 *
 * A card describes one summer (`season.year`): 2027 when the camp has posted it, else 2026, and
 * prices and weeks from 2026 carry a "2026" label (D12). The helpers take the directory's trimmed
 * card (CampListCard); a full CampCard fits that shape too. Both have been through cleanCard, so
 * every date and time in them is well-formed.
 */

import { parseAsEastern } from '@/lib/utils/timezone';
import type {
  AgeRange,
  Audience,
  CampCard,
  GradeRange,
  Hours,
  MilestoneKind,
  PriceTier,
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
// Malformed dates and times (from extraction or an override) read as unknown
// ---------------------------------------------------------------------------

/** A real calendar date as YYYY-MM-DD, else null ("2027-13-10" is null). */
export function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

/** HH:MM on a 24-hour clock, else null. */
export function validTime(value: unknown): string | null {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function cleanHours<H extends Hours>(hours: H | null): H | null {
  return hours && { ...hours, start: validTime(hours.start), end: validTime(hours.end) };
}

/**
 * The card with every malformed date or time treated as unknown, so one bad value can't take down
 * the directory, a camp page or a calendar: a registration date or a session with a bad date is
 * left out, and a bad season date or time becomes null (a datetime without its time is a date).
 * Every well-formed time stays, an early-morning one too: "00:59" is an 11:59 PM Central
 * deadline in Eastern time, and a time the extraction doubts is in its review notes.
 */
export function cleanCard(card: CampCard): CampCard {
  const lastYear = card.last_year_registration_opened;
  return {
    ...card,
    season: {
      ...card.season,
      start: validDate(card.season.start),
      end: validDate(card.season.end),
    },
    hours: cleanHours(card.hours),
    extended_care: card.extended_care && {
      ...card.extended_care,
      early_dropoff_start: validTime(card.extended_care.early_dropoff_start),
      late_pickup_end: validTime(card.extended_care.late_pickup_end),
    },
    sessions: card.sessions.flatMap((session) => {
      const start = validDate(session.start);
      if (!start) return [];
      return [
        {
          ...session,
          start,
          end: validDate(session.end) ?? start,
          hours: cleanHours(session.hours),
        },
      ];
    }),
    registration: card.registration.flatMap((milestone) => {
      if (!validDate(milestone.date)) return [];
      const time = validTime(milestone.time);
      const precision =
        milestone.precision === 'datetime' && !time ? ('date' as const) : milestone.precision;
      return [{ ...milestone, time, precision }];
    }),
    last_year_registration_opened:
      lastYear && validDate(lastYear.date) ? { ...lastYear, time: validTime(lastYear.time) } : null,
  };
}

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

/** Chip order after the type chip: faith, then the activity, then further details. */
const CATEGORY_CHIP_ORDER = [
  'faith_based',
  'nature_outdoor',
  'sports',
  'arts',
  'music',
  'theater',
  'dance',
  'stem',
  'horses',
  'cooking',
  'academic',
  'special_needs',
];

/**
 * The categories the pages show, always in `CATEGORY_CHIP_ORDER` (the extraction lists them in
 * any order). "General" tells a parent nothing, so it's left off the chips and the Category filter
 * (the data and the exports keep it).
 */
export function shownCategories<C extends string>(categories: C[]): C[] {
  const rank = (category: string) => {
    const index = CATEGORY_CHIP_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_CHIP_ORDER.length : index;
  };
  return categories.filter((category) => category !== 'general').sort((a, b) => rank(a) - rank(b));
}

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

/** "13:00" -> "1 PM", "08:30" -> "8:30 AM" (minutes only when not :00), anything else -> null. */
export function formatTime(time: string | null | undefined): string | null {
  if (!validTime(time)) return null;
  const [hour, minute] = time!.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${suffix}`;
}

/** "7:30 AM – 5:30 PM"; one end alone when that's all the camp says. */
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

/** "Drop-off from 7 AM, pickup until 6 PM" from a card's extended care. */
export function formatExtendedCare(care: CampListCard['extended_care']): string | null {
  if (!care) return null;
  const parts = [
    care.early_dropoff_start && `drop-off from ${formatTime(care.early_dropoff_start)}`,
    care.late_pickup_end && `pickup until ${formatTime(care.late_pickup_end)}`,
  ].filter(Boolean);
  return parts.length > 0 ? capitalize(parts.join(', ')) : 'Extended care offered';
}

/** Extended care's times for a card's hours line: "7 AM & 6 PM", "from 7 AM", "until 6 PM". */
function careTimes(care: CampListCard['extended_care']): string | null {
  if (!care) return null;
  const dropoff = formatTime(care.early_dropoff_start);
  const pickup = formatTime(care.late_pickup_end);
  if (dropoff && pickup) return `${dropoff} & ${pickup}`;
  return dropoff ? `from ${dropoff}` : pickup ? `until ${pickup}` : null;
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
  const { min, max } = grades;
  const prefix =
    grades.basis === 'rising' ? 'Rising ' : grades.basis === 'completed' ? 'Finished ' : '';
  // School ends at 12th: past it ("rising 13th") is a high-school graduate
  if (min !== null && min > 12) return 'High-school graduates';
  if (max !== null && max > 12) {
    return min === null
      ? 'Up to high-school graduates'
      : `${prefix}${gradeLabel(min)} grade – graduates`;
  }
  const range =
    min !== null && max !== null
      ? min === max
        ? gradeLabel(min)
        : `${gradeLabel(min)}–${gradeLabel(max)}`
      : min !== null
        ? `${gradeLabel(min)} grade and up`
        : `up to ${gradeLabel(max!)} grade`;
  return `${prefix}${range}${min !== null && max !== null ? ' grade' : ''}`;
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

/** "$1,523": money is shown to the nearest dollar everywhere ($522.50 is $523). */
export function formatPrice(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
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
      // In dollars, so $549.50 and $550 are one price
      const min = Math.round(Math.min(...amounts));
      const max = Math.round(Math.max(...amounts));
      if (max === 0) return 'Free';
      const range = min === max ? formatPrice(min) : `${formatPrice(min)}–${formatPrice(max)}`;
      return `${range}${UNIT_LABEL[unit] ?? ''}`;
    })
    .join(' · ');
}

/**
 * A drive time as shown: to the nearest 5 minutes (62 is 60), since it's an estimate without
 * traffic, and never under 5. The filters read the exact minutes.
 */
function roundDrive(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/** "60 min" */
export function driveLabel(minutes: number): string {
  return `${roundDrive(minutes)} min`;
}

/**
 * The site's drive time is from its town's center, not the site itself (the site isn't placed),
 * so it shows as "~N min". `=== true`: a list cached before the field existed lacks it.
 */
export function isDriveFromTown(site: CampSiteInfo): boolean {
  return site.driveFromTown === true;
}

/**
 * The provider's name as shown: without the trailing note discovery adds to tell two providers
 * apart ("YMCA of WNC (summer day camps)" is "YMCA of WNC").
 */
export function providerLabel(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, '') || name;
}

/** "Junior Camp (YMCA of WNC)", or the name alone when it already names the provider. */
export function campWithProvider(campName: string, providerName: string): string {
  const provider = providerLabel(providerName);
  return campName.toLowerCase().includes(provider.toLowerCase())
    ? campName
    : `${campName} (${provider})`;
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
 * `past`). A date for 'other' families (scholarship applications, staff families ...) can only be
 * named in the camp's own words, so it is its `text` when there is one.
 */
export function milestoneLabel(
  milestone: { audience: Audience; kind: MilestoneKind; text?: string },
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
  if (milestone.audience === 'other')
    return milestone.text ?? `${capitalize(what)} (some families)`;
  return capitalize(who[milestone.audience] ? `${who[milestone.audience]} ${what}` : what);
}

/** "Jan 10, 2027, 9 AM", "Jan 10, 2027", or "in December 2026" for a month. */
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

/**
 * The directory's registration filter. 'opened' (a public opening has passed, and the camp hasn't
 * said it's still open) is matched by "Open or opened": the card itself says which. 'later' (opens
 * in more than 14 days) has no filter of its own.
 */
export type RegistrationStatus = 'open' | 'opened' | 'soon' | 'later' | 'not_announced' | 'full';

export const REGISTRATION_FILTERS: Array<{ value: RegistrationStatus; label: string }> = [
  { value: 'open', label: 'Open or opened' },
  { value: 'soon', label: 'Opens within 14 days' },
  { value: 'not_announced', label: 'Not announced' },
  { value: 'full', label: 'Waitlist, full or closed' },
];

/** One line of text, with its own "unconfirmed" label when it names a date that is. */
/** Whether a camp's status passes the registration filter. */
export function matchesRegistration(
  status: RegistrationStatus,
  filter: RegistrationStatus
): boolean {
  return status === filter || (filter === 'open' && status === 'opened');
}

export interface RegistrationNote {
  text: string;
  unconfirmed: boolean;
}

export interface RegistrationLine {
  tone: 'upcoming' | 'open' | 'tentative' | 'unknown' | 'closed';
  text: string;
  /** The date `text` names is unconfirmed. */
  unconfirmed: boolean;
  /** Smaller lines underneath: other dates (members first, deadlines, lottery), availability. */
  details: RegistrationNote[];
  /** The date the line is about, for sorting; null when there isn't one. */
  sortDate: string | null;
  status: RegistrationStatus;
}

/** "All four sessions" speaks for the whole camp; "Session A" doesn't. */
function coversCamp(scope: string | null): boolean {
  return !scope || /^(?:all|every)\b/i.test(scope);
}

/**
 * A scope that is a registration system's label ("BikeReg registration categories") rather than
 * who or what it covers ("Session 1", "New campers", "Bunkhouse"): the directory's card leaves it
 * out (the camp page shows every scope).
 */
const SYSTEM_SCOPE =
  /\b(?:bikereg|campminder|ultracamp|sawyer|jackrabbit|activenet|webtrac|registration categor(?:y|ies))\b/i;

/**
 * Whose dates set the public status: everyone, or everyone by lottery. Member, returning-camper,
 * resident and early-bird dates are shown underneath, never as "Open now".
 */
const PUBLIC_AUDIENCES = new Set<Audience>(['public', 'lottery']);

const SOON_DAYS = 14;
const MAX_DETAILS = 3;

/**
 * The registration line. The 2027 dates are split by kind and audience: the public dates, in
 * order, say where registration stands today (each opening starts a window, a close ends it, a
 * deadline ends it unless a later end is ahead, and only an opening reopens it); lottery results,
 * and dates for members or returning campers, are only details. What the camp says about the whole
 * camp now (open, waitlist, full, closed) wins over the dates. "Open now" needs the camp saying
 * it's open: an opening that has passed, with nothing said since, is history ("Registration opened
 * Jan 10").
 *
 * `earliestOpening` (the directory's cards, Matt's call): the opening that leads is the earliest
 * still ahead for anyone, members, returning campers and 'other' families (staff, scholarship ...)
 * included, named without its audience ("Registration opens Jan 5, 2027" for a returning-camper
 * date); the sort and the "opens within 14 days" filter go by it too. The camp page keeps the
 * public one and lists each audience's in its own words.
 */
export function registrationLine(
  card: CampListCard,
  confirmed: boolean,
  now: Date,
  { earliestOpening = false }: { earliestOpening?: boolean } = {}
): RegistrationLine {
  // A date for 'other' families (scholarships, staff ...) needs the camp's wording, which the
  // directory's cards don't carry: the camp page lists it. Only the earliest opening counts it.
  const season = card.registration
    .filter((milestone) => milestone.year === TARGET_SEASON)
    .sort(byMilestoneDate);
  const current = season.filter((milestone) => milestone.audience !== 'other');
  const past = (milestone: CampListMilestone) => now >= upcomingUntil(milestone);
  const isPublic = (milestone: CampListMilestone) => PUBLIC_AUDIENCES.has(milestone.audience);
  const isEnd = (milestone: CampListMilestone) =>
    milestone.kind === 'closes' || milestone.kind === 'deadline';
  const announced = current.filter((milestone) => milestone.certainty === 'announced');
  const ahead = announced.filter((milestone) => !past(milestone));
  const publicDates = announced.filter(
    (milestone) => isPublic(milestone) && milestone.kind !== 'lottery_results'
  );
  const lastOpened = publicDates
    .filter((milestone) => milestone.kind === 'opens' && past(milestone))
    .at(-1);
  const nextOpen = (
    earliestOpening
      ? season.filter((milestone) => milestone.certainty === 'announced')
      : publicDates
  ).find((milestone) => milestone.kind === 'opens' && !past(milestone));
  const nextEnd = publicDates.find((milestone) => isEnd(milestone) && !past(milestone));
  // Where the public dates passed so far leave registration, in order: an opening opens it, a close
  // closes it, and a deadline closes it only when no later end is ahead (an early-bird deadline
  // before a final one doesn't). Only an opening reopens it: a later deadline never does, but it
  // becomes the date the closure names ("deadline passed Apr 30", not the first one in Feb).
  let closedBy: CampListMilestone | null = null;
  for (const milestone of publicDates.filter(past)) {
    if (milestone.kind === 'opens') closedBy = null;
    else if (closedBy || milestone.kind === 'closes' || !nextEnd) closedBy = milestone;
  }

  // A card still on 2026 describes 2026's availability, which says nothing about 2027.
  const availability = card.season.year === TARGET_SEASON ? card.availability : null;
  const campWide = availability && coversCamp(availability.scope) ? availability : null;
  const scoped =
    availability?.scope && !coversCamp(availability.scope) && !SYSTEM_SCOPE.test(availability.scope)
      ? availability
      : null;

  /** "Member registration opens Jan 10, 2027, 9 AM"; a past date without its time. */
  const say = (milestone: CampListMilestone): RegistrationNote => {
    const passed = past(milestone);
    const when =
      passed && milestone.precision !== 'month'
        ? formatDate(milestone.date, true)
        : milestoneWhen(milestone);
    return {
      text: `${milestoneLabel(milestone, passed)} ${when}`,
      unconfirmed: isUnconfirmed(milestone, confirmed),
    };
  };
  const plain = (text: string): RegistrationNote => ({ text, unconfirmed: false });
  /** The lead's details: `first`, then the other dates still ahead, then scoped availability. */
  const details = (
    leads: Array<CampListMilestone | null | undefined>,
    first: Array<RegistrationNote | null | undefined | false> = []
  ) =>
    [
      ...first,
      ...ahead.filter((milestone) => !leads.includes(milestone)).map(say),
      scoped && plain(`${AVAILABILITY_LABELS[scoped.status] ?? scoped.status}: ${scoped.scope}`),
    ]
      .filter((note): note is RegistrationNote => !!note)
      .slice(0, MAX_DETAILS);

  // The camp says it's full or waitlisted, or closed with no opening ahead (closed before an
  // opening is just "not open yet", and the opening leads below)
  if (
    campWide &&
    (campWide.status === 'full' ||
      campWide.status === 'waitlist' ||
      (campWide.status === 'closed' && !nextOpen))
  ) {
    return {
      tone: 'closed',
      text: `2027: ${AVAILABILITY_LABELS[campWide.status].toLowerCase()}`,
      unconfirmed: false,
      details: details([], [lastOpened && say(lastOpened)]),
      sortDate: null,
      status: 'full',
    };
  }

  // Open: the camp says so. A deadline still ahead leads, being what a parent acts on.
  if (campWide && (campWide.status === 'available' || campWide.status === 'mixed')) {
    const status = plain(
      campWide.status === 'mixed' ? '2027: open, some sessions full' : '2027 registration open'
    );
    const lead = nextEnd ? say(nextEnd) : status;
    return {
      tone: 'open',
      ...headline(lead),
      details: details([nextEnd], [lead !== status && status, lastOpened && say(lastOpened)]),
      sortDate: nextEnd?.date ?? null,
      status: 'open',
    };
  }

  // A public opening still ahead (or a reopening) leads; members-first, deadline and lottery dates
  // go underneath.
  if (nextOpen) {
    const days = (upcomingUntil(nextOpen).getTime() - now.getTime()) / 86400000;
    // A members' or returning campers' date named as plain registration (lottery keeps its name)
    const lead: CampListMilestone = isPublic(nextOpen)
      ? nextOpen
      : { ...nextOpen, audience: 'public' };
    return {
      tone: 'upcoming',
      ...headline(say(lead)),
      details: details([nextOpen]),
      sortDate: nextOpen.date,
      status: days <= SOON_DAYS ? 'soon' : 'later',
    };
  }

  // The public dates passed closed registration, and none reopened it: closed
  if (closedBy) {
    return {
      tone: 'closed',
      text: `2027 registration ${closedBy.kind === 'closes' ? 'closed' : 'deadline passed'} ${formatDate(closedBy.date, true)}`,
      unconfirmed: isUnconfirmed(closedBy, confirmed),
      details: details([]),
      sortDate: null,
      status: 'full',
    };
  }

  // A public opening has passed and its window hasn't closed, but the camp doesn't say it's still
  // open: history, never "Open now". A deadline still ahead goes underneath.
  if (lastOpened) {
    return {
      tone: 'tentative',
      ...headline(say(lastOpened)),
      details: details([]),
      sortDate: nextEnd?.date ?? null,
      status: 'opened',
    };
  }

  // A public deadline with no opening date: announced, but not proof registration is open yet.
  if (nextEnd) {
    return {
      tone: 'upcoming',
      ...headline(say(nextEnd)),
      details: details([nextEnd], [plain('Opening date not posted')]),
      sortDate: nextEnd.date,
      status: 'later',
    };
  }

  // "Expected mid-December": worth saying, never a firm date, and history once it's gone.
  const expectedOpens = current.filter(
    (milestone) =>
      isPublic(milestone) && milestone.kind === 'opens' && milestone.certainty === 'expected'
  );
  const expected = expectedOpens.find((milestone) => !past(milestone)) ?? expectedOpens.at(-1);
  if (expected) {
    const live = !past(expected);
    return {
      tone: live ? 'tentative' : 'unknown',
      text: `Registration ${live ? 'expected' : 'was expected'} ${milestoneWhen(expected)}`,
      unconfirmed: isUnconfirmed(expected, confirmed),
      details: details(
        [],
        [plain(live ? 'Not confirmed by the camp yet' : 'Check the camp’s site for the date')]
      ),
      sortDate: live ? expected.date : null,
      status: 'not_announced',
    };
  }

  // No public date. Dates for members or returning campers still show, the last one as history;
  // with nothing for 2027 at all, last year's opening leads (01 §4.3).
  const lastYear = card.last_year_registration_opened
    ? `Opened ${formatDate(card.last_year_registration_opened.date)} last year`
    : null;
  const history = ahead.length === 0 ? announced.at(-1) : undefined;
  const posted = card.season.year === TARGET_SEASON && card.season.status === 'posted';
  const text =
    announced.length > 0
      ? 'Public registration date not posted yet'
      : posted
        ? '2027 dates posted; registration date not posted yet'
        : (lastYear ?? '2027 dates not posted yet');
  return {
    tone: 'unknown',
    text,
    unconfirmed: false,
    details: details(
      [],
      [history && say(history), lastYear && lastYear !== text ? plain(lastYear) : null]
    ),
    sortDate: null,
    status: 'not_announced',
  };
}

function headline(note: RegistrationNote): Pick<RegistrationLine, 'text' | 'unconfirmed'> {
  return { text: note.text, unconfirmed: note.unconfirmed };
}

/**
 * A registration date worth a calendar event (01 §4.4, N14): one the camp has announced for summer
 * 2027, to the day. "Expected mid-December" or a month alone never becomes one, since the event
 * would invent the day. The one rule for the "Add reminder" button, its .ics download and the
 * saved-camps calendar feed.
 */
export function isRemindable(
  milestone: Pick<CampListMilestone, 'year' | 'certainty' | 'precision'>
): boolean {
  return (
    milestone.year === TARGET_SEASON &&
    milestone.certainty === 'announced' &&
    (milestone.precision === 'date' || milestone.precision === 'datetime')
  );
}

/**
 * The remindable dates for one audience not yet passed (N10: the public dates by default; members',
 * returning families' or lottery dates are their own reminders). Empty when the camp hasn't posted
 * one (no button then).
 */
export function reminderMilestones<M extends CampListMilestone>(
  card: { registration: M[] },
  now: Date,
  audience: Audience = 'public'
): M[] {
  return card.registration
    .filter(
      (milestone) =>
        milestone.audience === audience && isRemindable(milestone) && now < upcomingUntil(milestone)
    )
    .sort(byMilestoneDate);
}

/**
 * A date in a reminder's calendar menu: its own Google Calendar link names it by kind, date and
 * time (the menu's audience is the fourth part).
 */
export interface ReminderDate {
  kind: MilestoneKind;
  date: string;
  time: string | null;
  /** "Registration opens Jan 10", with its time when another date in the menu shares the day */
  label: string;
}

/** reminderMilestones, as the calendar menu lists them. */
export function reminderDates(
  card: { registration: CampListMilestone[] },
  now: Date,
  audience: Audience = 'public'
): ReminderDate[] {
  const milestones = reminderMilestones(card, now, audience);
  return milestones.map((milestone) => {
    const time = milestone.precision === 'datetime' ? formatTime(milestone.time) : null;
    const shared = milestones.filter((other) => other.date === milestone.date).length > 1;
    return {
      kind: milestone.kind,
      date: milestone.date,
      time: milestone.time,
      label: `${milestoneLabel(milestone)} ${formatDate(milestone.date)}${shared && time ? `, ${time}` : ''}`,
    };
  });
}

/** The reminder buttons: "Add reminder" for the public dates, one per other audience. */
export const REMINDER_LABELS: Record<Audience, string> = {
  public: 'Add reminder',
  member: 'Add member reminder',
  returning: 'Add returning-camper reminder',
  lottery: 'Add lottery reminder',
  resident: 'Add resident reminder',
  early_bird: 'Add early-bird reminder',
  // The camp page names these in the camp's words (milestoneLabel)
  other: 'Add reminder for other dates',
};

// ---------------------------------------------------------------------------
// Eligibility. The pilot's UX review found the age filter useless without converting between ages
// and grades (most camps state only one), so it converts (overriding N11); a match that rests on
// a conversion, or on a camp stating neither, is only "may fit".
// ---------------------------------------------------------------------------

/** Does a camp take a kid of this age (during summer 2027)? Null when it states no ages. */
export function fitsAge(ages: AgeRange | null, age: number): boolean | null {
  if (!ages || (ages.min === null && ages.max === null)) return null;
  return (ages.min === null || age >= ages.min) && (ages.max === null || age <= ages.max);
}

/**
 * 'fits' when the camp states the thing the parent gave (an age, or a grade) and the kid is in
 * range; 'may_fit' when it only fits by converting (a rising 2nd grader is 7 or 8 next summer, a
 * 7-year-old a rising 1st or 2nd grader), by one reading of grades that don't say rising or
 * completed, or the camp states neither; 'no' otherwise.
 */
export type KidFit = 'fits' | 'may_fit' | 'no';

/**
 * Does a camp take a kid entering this grade in fall 2027 ("rising" grade)? "Completed 2nd" and
 * "current 2nd" (this school year) are both rising 3rd. "3rd-9th" alone could be either, so it
 * fits when both readings do and may fit when one does. Null when the camp states no grades.
 */
export function fitsGrade(grades: GradeRange | null, risingGrade: number): KidFit | null {
  if (!grades || (grades.min === null && grades.max === null)) return null;
  const within = (grade: number) =>
    (grades.min === null || grade >= grades.min) && (grades.max === null || grade <= grades.max);
  const readings =
    grades.basis === 'rising'
      ? [within(risingGrade)]
      : grades.basis === 'completed' || grades.basis === 'current'
        ? [within(risingGrade - 1)]
        : [within(risingGrade), within(risingGrade - 1)];
  return readings.every(Boolean) ? 'fits' : readings.some(Boolean) ? 'may_fit' : 'no';
}

export function kidFit(
  camp: { ages: AgeRange | null; grades: GradeRange | null },
  kid: { age: number | null; grade: number | null }
): KidFit {
  const direct = kid.age !== null ? fitsAge(camp.ages, kid.age) : null;
  const directGrade = kid.grade !== null ? fitsGrade(camp.grades, kid.grade) : null;
  if (direct !== null || directGrade !== null) {
    if (direct === false || directGrade === 'no') return 'no';
    return directGrade === 'may_fit' ? 'may_fit' : 'fits';
  }
  const converted =
    kid.age !== null
      ? [fitsGrade(camp.grades, kid.age - 5), fitsGrade(camp.grades, kid.age - 6)]
      : kid.grade !== null
        ? [fitsAge(camp.ages, kid.grade + 5), fitsAge(camp.ages, kid.grade + 6)]
        : [];
  return converted.length > 0 && converted.every((fit) => fit === false || fit === 'no')
    ? 'no'
    : 'may_fit';
}

// ---------------------------------------------------------------------------
// Prices, weeks and hours for the filters
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

/** Every price on a card: the card's tiers and its rows' own. */
function allPrices(card: CampListCard): PriceTier[] {
  return [
    ...card.prices,
    ...card.sessions.flatMap((session) => (session.price ? [session.price] : [])),
  ];
}

/**
 * Whether a tier counts as the camp's price. A $0 tier beside paid ones is a scholarship, a
 * deposit credit or "free for staff kids", not what the camp costs, so it counts only when every
 * tier is $0 (a free camp, e.g. VBS). The detail page still lists it, with its label.
 */
function countsAsPrice(card: CampListCard): (price: PriceTier) => boolean {
  const paid = allPrices(card).some((price) => price.amount > 0);
  return (price) => !paid || price.amount > 0;
}

/** The summer's weeks for the "week of" filter: Monday to Friday, May 31 - Aug 20, 2027. */
export const SUMMER_WEEKS = Array.from({ length: 12 }, (_, index) => {
  const monday = new Date(Date.UTC(2027, 4, 31 + index * 7));
  const friday = new Date(Date.UTC(2027, 4, 31 + index * 7 + 4));
  const start = monday.toISOString().slice(0, 10);
  return {
    start,
    end: friday.toISOString().slice(0, 10),
    // The field is "Week", and a phone has room for this much
    label: formatDate(start, true),
  };
});

/**
 * A date from an earlier summer moved to the same week of TARGET_SEASON, weekday kept (364 days
 * a year: Mon Jul 6, 2026 is Mon Jul 5, 2027), so the week filter can read a 2026 schedule.
 */
export function inTargetSeason(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year >= TARGET_SEASON) return date;
  return new Date(Date.UTC(year, month - 1, day + 364 * (TARGET_SEASON - year)))
    .toISOString()
    .slice(0, 10);
}

export const HOURS_FILTERS = [
  { value: 'workday', label: 'Covers a workday' },
  { value: 'full', label: 'Full day' },
  { value: 'half', label: 'Half day' },
] as const;
export type HoursFilter = (typeof HOURS_FILTERS)[number]['value'];

/** Drop-off by 8:30 and pickup at 5:00 or later, extended care counted. */
const WORKDAY = { dropoff: '08:30', pickup: '17:00' };
/** Five hours or more is a full day. */
const FULL_DAY_MINUTES = 300;

function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/** 'full' or 'half' from the hours; an overnight camp is full, a half-day camp half. */
function dayLength(hours: Hours, type: string): 'full' | 'half' | null {
  if (type === 'overnight') return 'full';
  if (hours.start && hours.end && minutesOf(hours.end) > minutesOf(hours.start)) {
    return minutesOf(hours.end) - minutesOf(hours.start) >= FULL_DAY_MINUTES ? 'full' : 'half';
  }
  return type === 'half_day' ? 'half' : null;
}

/**
 * Can a working parent use it: drop-off by 8:30 and pickup at 5:00 or later, counting extended
 * care. Null when it can't be told, e.g. the camp offers care but doesn't say until when.
 */
function coversWorkday(
  hours: Hours,
  care: CampListCard['extended_care'],
  type: string
): boolean | null {
  if (type === 'overnight') return true;
  // One end of the day: met when any stated time meets it; short when the times that could meet
  // it are all stated and none does.
  const end = (base: string | null, extra: string | null, meets: (time: string) => boolean) => {
    const known = [base, extra].filter((time): time is string => !!time);
    if (known.some(meets)) return true;
    return base && (!care || extra) ? false : null;
  };
  const dropoff = end(hours.start, care?.early_dropoff_start ?? null, (t) => t <= WORKDAY.dropoff);
  const pickup = end(hours.end, care?.late_pickup_end ?? null, (t) => t >= WORKDAY.pickup);
  if (dropoff === false || pickup === false) return false;
  return dropoff && pickup ? true : null;
}

// ---------------------------------------------------------------------------
// Card data for the browser
// ---------------------------------------------------------------------------

/** A value with the summer it describes, for "2026" labels. */
export interface Labeled {
  text: string;
  year: number;
}

/** A site as the filters read it. */
export interface CampSiteData {
  town: string | null;
  /** Minutes from downtown; null when the site isn't placed. */
  drive: number | null;
}

/**
 * One row of a card as the filters read it: a week, session, age band or site, with the
 * eligibility, weekly prices, sites and hours that apply to it. A card listing no rows gets one
 * row for its whole season. Every filter is tested on the same row, so "age 7 within 15 minutes"
 * needs a row that is both.
 */
export interface CampRow {
  start: string | null;
  end: string | null;
  ages: AgeRange | null;
  grades: GradeRange | null;
  /** Dollars a week for each price that applies; empty when unknown. */
  weekly: number[];
  /**
   * The sites it may run at (indexes into CampCardData.sites); empty when unknown: the camp names
   * none, or the row names one the card doesn't list.
   */
  sites: number[];
  length: 'full' | 'half' | null;
  workday: boolean | null;
}

/** What the directory needs per camp: small enough to send to the browser. */
export interface CampCardData {
  id: string;
  slug: string;
  name: string;
  providerName: string;
  type: string;
  categories: string[];
  /** The description's first sentence, the card's summary ('' when there's no description). */
  summary: string;
  /**
   * Lowercased text the search box matches besides what the card already holds (name, provider,
   * type, categories, towns, summary: campSearchText adds those in the browser): the rest of the
   * description and site names. Every camp goes to the browser, so it isn't sent twice.
   */
  search: string;
  who: string | null;
  /** "Asheville, Hendersonville · 2 sites" */
  location: string | null;
  /** "~10–30 min drive" */
  drive: string | null;
  sites: CampSiteData[];
  /** The nearest site's drive from downtown; null when no site is placed. */
  driveMinutes: number | null;
  price: Labeled | null;
  /** What the price is for, in the camp's words ("Half day", "Starting at"). */
  priceNote: string | null;
  /** The lowest weekly price, for sorting. */
  priceSort: number | null;
  season: Labeled | null;
  hours: string | null;
  /** The camp's own words on hours, when they say more than the times ("Friday pickup at noon"). */
  hoursNote: string | null;
  /** Extended care in words ("Drop-off from 7 AM, pickup until 6 PM"), null without it. */
  care: string | null;
  /** Its times, for the card ("7 AM & 6 PM"); null when the camp doesn't give them. */
  careTimes: string | null;
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
  /** The remindable public 2027 dates still ahead, for "Add reminder" (none: no button). */
  reminders: ReminderDate[];
}

/** Everything the search box matches for a camp, lowercased. */
export function campSearchText(camp: CampCardData): string {
  return [
    camp.name,
    camp.providerName,
    TYPE_LABELS[camp.type],
    ...camp.categories.map((category) => CATEGORY_LABELS[category]),
    ...camp.sites.map((site) => site.town),
    camp.summary,
    camp.search,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function supportKeys(card: CampListCard): SupportKey[] {
  const has = (fact: { value: SupportValue } | null) => !!fact && fact.value !== 'no';
  const keys: SupportKey[] = (
    ['financial_aid', 'special_needs', 'lunch', 'transportation'] as const
  ).filter((key) => has(card[key]));
  if (card.extended_care) keys.push('extended_care');
  return keys;
}

/** Rows for the filters. */
function campRows(card: CampListCard, sites: CampSiteInfo[]): CampRow[] {
  const counts = countsAsPrice(card);
  const prices = (days: number | null, own: PriceTier | null) =>
    (own ? [own] : card.prices)
      .filter(counts)
      .map((price) => weeklyPrice(price, days))
      .filter((week): week is number => week !== null);
  // A row names its site when the camp has several; a row that doesn't may run at any of them. A
  // name that matches none of the card's sites is an unknown site, not every site.
  const everySite = sites.map((_, index) => index);
  const rowSites = (name: string | null) => {
    if (!name) return everySite;
    const index = sites.findIndex((site) => site.name === name);
    return index >= 0 ? [index] : [];
  };
  const withHours = (hours: Hours | null) => {
    const merged = {
      start: hours?.start ?? card.hours?.start ?? null,
      end: hours?.end ?? card.hours?.end ?? null,
    };
    return {
      length: dayLength(merged, card.type),
      workday: coversWorkday(merged, card.extended_care, card.type),
    };
  };
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
            sites: rowSites(session.site),
            ...withHours(session.hours),
          };
        })
      : [
          {
            start: card.season.start,
            end: card.season.end,
            ages: card.ages,
            grades: card.grades,
            weekly: prices(seasonDays !== null && seasonDays <= 14 ? seasonDays : null, null),
            sites: everySite,
            ...withHours(null),
          },
        ];
  // The same week at four sites is one row at those four sites: a row matches on any of its
  // sites, so this changes no verdict, and "3 of 9 weeks" counts weeks, not weeks times sites. A
  // row at an unknown site stays apart, so it stays unknown.
  const merged = new Map<string, CampRow>();
  for (const row of rows) {
    const key = JSON.stringify({ ...row, sites: row.sites.length === 0 });
    const seen = merged.get(key);
    if (seen) seen.sites = [...new Set([...seen.sites, ...row.sites])].sort((a, b) => a - b);
    else merged.set(key, row);
  }
  // Each row gets its own objects: the page's RSC payload writes an object it has already sent
  // (the card's ages, every-site list) as a path back to it, which is longer than the object.
  return [...merged.values()].map((row) => ({
    ...row,
    ages: row.ages && { ...row.ages },
    grades: row.grades && { ...row.grades },
    sites: [...row.sites],
  }));
}

/** The places a card runs: its towns, and how many sites when there are several. */
function locationText(sites: CampSiteInfo[]): string | null {
  const towns = [...new Set(sites.map(siteTown).filter((town): town is string => !!town))];
  const where =
    towns.length > 3 ? `${towns.slice(0, 3).join(', ')} +${towns.length - 3}` : towns.join(', ');
  const count = sites.length > 1 ? plural(sites.length, 'site') : null;
  return [where || null, count].filter(Boolean).join(' · ') || null;
}

/** "~10–30 min drive": the range from downtown over the card's placed sites. */
function driveText(sites: CampSiteInfo[]): string | null {
  const minutes = sites
    .map((site) => site.driveMinutes)
    .filter((value): value is number => value !== null);
  if (minutes.length === 0) return null;
  // "~" when a time is from a town's center rather than the site itself
  const about = sites.some((site) => site.driveMinutes !== null && isDriveFromTown(site))
    ? '~'
    : '';
  const low = roundDrive(Math.min(...minutes));
  const high = roundDrive(Math.max(...minutes));
  return `${about}${low === high ? low : `${low}–${high}`} min drive`;
}

/** Words whose period isn't a sentence's end ("St. Lawrence", "Dr. Lee"). */
const ABBREVIATIONS = new Set([
  'st',
  'mt',
  'ft',
  'dr',
  'mr',
  'mrs',
  'ms',
  'jr',
  'sr',
  'rev',
  'vs',
  'ave',
  'rd',
  'inc',
  'approx',
]);

/**
 * The description's first sentence: up to the first ".", "!" or "?" before a space or the end,
 * except the period of initials ("A.C.", "U.S.", "e.g.") or an abbreviation ("St.", "Dr.").
 */
export function firstSentence(description: string): string {
  const text = description.trim();
  const ends = /[.!?](?=\s|$)/g;
  for (let end = ends.exec(text); end; end = ends.exec(text)) {
    if (text[end.index] === '.') {
      // The word the period ends: "A.C" in "by A.C. Reynolds", "St" in "(St. Lawrence"
      const word = (/\S*$/.exec(text.slice(0, end.index))?.[0] ?? '')
        .replace(/^[("“'‘[]+/, '')
        .toLowerCase();
      if (/^(?:[a-z]\.)*[a-z]$/.test(word) || ABBREVIATIONS.has(word)) continue;
    }
    return text.slice(0, end.index + 1);
  }
  return text;
}

/**
 * The prices the card shows: the newest summer's tiers, the card's and its rows', without $0
 * extras (countsAsPrice). A flat fee (unit "program" or "other", often a registration fee) shows
 * only when there's no weekly-type price.
 */
function shownPrices(card: CampListCard): PriceTier[] {
  const counted = allPrices(card).filter(countsAsPrice(card));
  if (counted.length === 0) return [];
  const year = Math.max(...counted.map((price) => price.year));
  const newest = counted.filter((price) => price.year === year);
  const periodic = newest.filter((price) => price.unit !== 'program' && price.unit !== 'other');
  return periodic.length > 0 ? periodic : newest;
}

/**
 * What the shown prices are for, in the camp's words, so "$175/week" never reads as the full-day
 * price when it's a half day: one tier's label, or up to three tiers with theirs.
 */
function priceNote(prices: PriceTier[]): string | null {
  if (!prices.some((price) => price.label)) return null;
  const tiers = [
    ...new Map(
      prices.map((price) => [`${price.amount} ${price.unit} ${price.label ?? ''}`, price])
    ).values(),
  ].sort((a, b) => a.amount - b.amount);
  if (tiers.length === 1) return tiers[0].label;
  const listed = tiers
    .slice(0, 3)
    .map((price) => `${formatPriceTier(price)}${price.label ? ` ${price.label}` : ''}`);
  return [...listed, tiers.length > 3 && `+${tiers.length - 3} more`].filter(Boolean).join(' · ');
}

/** The camp's wording on hours, unless it only restates the times ("9AM - 3PM"). */
function hoursNote(hours: CampListCard['hours']): string | null {
  const text = hours?.text?.trim();
  if (!text) return null;
  // No lookbehind: older iOS Safari can't parse it, and this module ships to the browser
  const times = /(^|[^a-z])(?:[ap]\.?m\.?|noon)(?![a-z])/gi;
  return /[a-z]/i.test(text.replace(times, '$1')) ? text : null;
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
  const rows = campRows(card, camp.sites);
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
  const prices = shownPrices(card);
  const priceRange = formatPriceRange(prices);
  const summary = firstSentence(card.description);

  return {
    id: camp.id,
    slug: camp.slug,
    name: card.name,
    providerName: providerLabel(camp.providerName),
    type: card.type,
    categories: shownCategories(card.categories),
    summary,
    search: [card.description.trim().slice(summary.length), ...camp.sites.map((site) => site.name)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    who: formatWho(card.ages, card.grades),
    location: locationText(camp.sites),
    drive: driveText(camp.sites),
    // Whole minutes for the drive filter, which reads them exactly (the card rounds to 5)
    sites: camp.sites.map((site) => ({
      town: siteTown(site),
      drive: site.driveMinutes === null ? null : Math.round(site.driveMinutes),
    })),
    driveMinutes: minutes.length > 0 ? Math.round(Math.min(...minutes)) : null,
    price: priceRange ? { text: priceRange, year: prices[0].year } : null,
    priceNote: priceNote(prices),
    priceSort: weekly.length > 0 ? Math.min(...weekly) : null,
    season: seasonText(card, rows),
    hours: formatHours(card.hours),
    hoursNote: hoursNote(card.hours),
    care: card.extended_care ? formatExtendedCare(card.extended_care) : null,
    careTimes: careTimes(card.extended_care),
    registration: registrationLine(card, camp.confirmed, now, { earliestOpening: true }),
    support: supportKeys(card),
    rows,
    listsRows,
    rowNoun,
    views: camp.views,
    websiteUrl: card.camp_page_url ?? camp.providerUrl,
    reminders: reminderDates(card, now),
  };
}
