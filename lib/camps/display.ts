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

/** "13:00" -> "1 p.m.", "08:30" -> "8:30 a.m.", anything else -> null. */
export function formatTime(time: string | null | undefined): string | null {
  if (!validTime(time)) return null;
  const [hour, minute] = time!.split(':').map(Number);
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

/** One line of text, with its own "unconfirmed" label when it names a date that is. */
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
 * Whose dates set the public status: everyone, or everyone by lottery. Member, returning-camper,
 * resident and early-bird dates are shown underneath, never as "Open now".
 */
const PUBLIC_AUDIENCES = new Set<Audience>(['public', 'lottery']);

const SOON_DAYS = 14;
const MAX_DETAILS = 3;

/**
 * The registration line. The 2027 dates are split by kind and audience: the public opening and
 * public close or deadline set the status; lottery results, and dates for members or returning
 * campers, are only details. "Open now" needs evidence: a public opening that has passed (with no
 * public close passed and no word the camp is full), or the camp saying it's open.
 */
export function registrationLine(
  card: CampListCard,
  confirmed: boolean,
  now: Date
): RegistrationLine {
  const current = card.registration
    .filter((milestone) => milestone.year === TARGET_SEASON)
    .sort(byMilestoneDate);
  const past = (milestone: CampListMilestone) => now >= upcomingUntil(milestone);
  const isPublic = (milestone: CampListMilestone) => PUBLIC_AUDIENCES.has(milestone.audience);
  const announced = current.filter((milestone) => milestone.certainty === 'announced');
  const ahead = announced.filter((milestone) => !past(milestone));
  const publicOpens = announced.filter(
    (milestone) => isPublic(milestone) && milestone.kind === 'opens'
  );
  const publicEnds = announced.filter(
    (milestone) =>
      isPublic(milestone) && (milestone.kind === 'closes' || milestone.kind === 'deadline')
  );
  const nextOpen = publicOpens.find((milestone) => !past(milestone));
  const lastOpened = publicOpens.filter(past).at(-1);
  const nextEnd = publicEnds.find((milestone) => !past(milestone));
  const lastEnd = publicEnds.at(-1);

  // A card still on 2026 describes 2026's availability, which says nothing about 2027.
  const availability = card.season.year === TARGET_SEASON ? card.availability : null;
  const campWide = availability && coversCamp(availability.scope) ? availability : null;
  const scoped = availability && !coversCamp(availability.scope) ? availability : null;

  /** "Member registration opens Jan 10, 2027, 9 a.m."; a past date without its time. */
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

  // The last public close or deadline has passed, and no public opening is ahead
  if (lastEnd && past(lastEnd) && !nextOpen) {
    return {
      tone: 'closed',
      text: `2027 registration ${lastEnd.kind === 'closes' ? 'closed' : 'deadline passed'} ${formatDate(lastEnd.date, true)}`,
      unconfirmed: isUnconfirmed(lastEnd, confirmed),
      details: details([]),
      sortDate: null,
      status: 'full',
    };
  }

  if (campWide && ['full', 'waitlist', 'closed'].includes(campWide.status)) {
    return {
      tone: 'closed',
      text: `2027: ${AVAILABILITY_LABELS[campWide.status].toLowerCase()}`,
      unconfirmed: false,
      details: details([], [lastOpened && say(lastOpened)]),
      sortDate: null,
      status: 'full',
    };
  }

  // The public opening still ahead leads; members-first, deadline and lottery dates go underneath.
  if (nextOpen) {
    const days = (upcomingUntil(nextOpen).getTime() - now.getTime()) / 86400000;
    return {
      tone: 'upcoming',
      ...headline(say(nextOpen)),
      details: details([nextOpen]),
      sortDate: nextOpen.date,
      status: days <= SOON_DAYS ? 'soon' : 'later',
    };
  }

  // Open: a public opening has passed, or the camp says it's open. A deadline still ahead leads,
  // being what a parent acts on.
  if (lastOpened || campWide) {
    const status =
      campWide?.status === 'mixed'
        ? plain('2027: open, some sessions full')
        : campWide
          ? plain('2027 registration open')
          : null;
    const opened = lastOpened ? say(lastOpened) : null;
    const lead = nextEnd ? say(nextEnd) : (status ?? opened!);
    return {
      tone: 'open',
      ...headline(lead),
      details: details([nextEnd], [lead !== status && status, lead !== opened && opened]),
      sortDate: nextEnd?.date ?? null,
      status: 'open',
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

  // No public date. Dates for members or returning campers still show, the last one as history.
  const lastYear = card.last_year_registration_opened
    ? plain(`Last year it opened ${formatDate(card.last_year_registration_opened.date, true)}`)
    : null;
  const history = ahead.length === 0 ? announced.at(-1) : undefined;
  const posted = card.season.year === TARGET_SEASON && card.season.status === 'posted';
  return {
    tone: 'unknown',
    text:
      announced.length > 0
        ? 'Public registration date not posted yet'
        : posted
          ? '2027 dates posted; registration date not posted yet'
          : '2027 registration not announced yet',
    unconfirmed: false,
    details: details([], [history && say(history), lastYear]),
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
 * The remindable dates not yet passed. Empty when the camp hasn't posted one (no "Add reminder"
 * button then).
 */
export function reminderMilestones<M extends CampListMilestone>(
  card: { registration: M[] },
  now: Date
): M[] {
  return card.registration
    .filter((milestone) => isRemindable(milestone) && now < upcomingUntil(milestone))
    .sort(byMilestoneDate);
}

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
 * 'fits' when the camp states the thing the parent gave (an age, or a grade) and the kid is in
 * range; 'may_fit' when it only fits by converting (a rising 2nd grader is 7 or 8 next summer, a
 * 7-year-old a rising 1st or 2nd grader) or the camp states neither; 'no' otherwise.
 */
export type KidFit = 'fits' | 'may_fit' | 'no';

export function kidFit(
  camp: { ages: AgeRange | null; grades: GradeRange | null },
  kid: { age: number | null; grade: number | null }
): KidFit {
  const direct = kid.age !== null ? fitsAge(camp.ages, kid.age) : null;
  const directGrade = kid.grade !== null ? fitsGrade(camp.grades, kid.grade) : null;
  if (direct !== null || directGrade !== null)
    return direct === false || directGrade === false ? 'no' : 'fits';
  const converted =
    kid.age !== null
      ? fitsGrade(camp.grades, kid.age - 5) || fitsGrade(camp.grades, kid.age - 6)
      : kid.grade !== null
        ? fitsAge(camp.ages, kid.grade + 5) || fitsAge(camp.ages, kid.grade + 6)
        : null;
  return converted === false ? 'no' : 'may_fit';
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
  return { start, end: friday.toISOString().slice(0, 10), label: `Week of ${formatDate(start)}` };
});

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
  /** The sites it may run at (indexes into CampCardData.sites); empty when the camp names none. */
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
  /** Lowercased text the search box matches. */
  search: string;
  who: string | null;
  /** "Asheville, Hendersonville · 12–30 min drive" */
  place: string | null;
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
  /** A remindable 2027 date still ahead, so "Add reminder" has something to add. */
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

/** Rows for the filters. */
function campRows(card: CampListCard, sites: CampSiteInfo[]): CampRow[] {
  const counts = countsAsPrice(card);
  const prices = (days: number | null, own: PriceTier | null) =>
    (own ? [own] : card.prices)
      .filter(counts)
      .map((price) => weeklyPrice(price, days))
      .filter((week): week is number => week !== null);
  // A row names its site when the camp has several; a row that doesn't may run at any of them
  const everySite = sites.map((_, index) => index);
  const rowSites = (name: string | null) => {
    const index = name ? sites.findIndex((site) => site.name === name) : -1;
    return index >= 0 ? [index] : everySite;
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
  // sites, so this changes no verdict, and "3 of 9 weeks" counts weeks, not weeks times sites.
  const merged = new Map<string, CampRow>();
  for (const row of rows) {
    const key = JSON.stringify({ ...row, sites: null });
    const seen = merged.get(key);
    if (seen) seen.sites = [...new Set([...seen.sites, ...row.sites])].sort((a, b) => a - b);
    else merged.set(key, row);
  }
  return [...merged.values()];
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
    sites: camp.sites.map((site) => ({ town: siteTown(site), drive: site.driveMinutes })),
    driveMinutes: minutes.length > 0 ? Math.min(...minutes) : null,
    price: priceRange ? { text: priceRange, year: prices[0].year } : null,
    priceNote: priceNote(prices),
    priceSort: weekly.length > 0 ? Math.min(...weekly) : null,
    season: seasonText(card, rows),
    hours: formatHours(card.hours),
    hoursNote: hoursNote(card.hours),
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
