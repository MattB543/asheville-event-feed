/**
 * What a camp card and detail page show, built from import rows (today the pilot's
 * data/camps/pilot/import.json; later the camps tables). Pure functions, no I/O.
 *
 * Every field shows its newest summer: 2027 when posted, else 2026 with a "2026" label (D12).
 * Two selections per field:
 *   - `published`: the newest *publishable* fact (verified, or checked by hand). Cards, filters and
 *     the registration line use only these, so a newer unconfirmed fact never hides an older
 *     confirmed one, and never reaches a card.
 *   - `facts`: the newest fact that wasn't dropped, for the detail page, marked "check" when it
 *     isn't publishable.
 * Registration milestones need a hand check to be publishable at all (N15).
 */

import { parseAsEastern } from '@/lib/utils/timezone';
import type { AvailabilityRow, CampRow, MilestoneRow, SeasonFacts, SeasonRow } from './importRows';
import {
  isPublishable,
  isPublishableMilestone,
  type Check,
  type Evidence,
  type SessionFact,
} from './types';
import { isTentativeWording } from './wording';

export const TARGET_SEASON = 2027;

export type Fact<T extends Evidence> = T & { publishable: boolean };

export interface CampGeoView {
  lat: number;
  lng: number;
  layer: string;
  source: string;
  driveMinutes: number | null;
  limit: number;
  inRadius: boolean | null;
  nearCutoff: boolean;
  approximate: boolean;
  label: string;
}

export interface RegistrationLine {
  tone: 'upcoming' | 'open' | 'closed' | 'unknown' | 'tentative';
  text: string;
  detail: string | null;
  /** Sort key: the next actionable date, or null when there isn't one. */
  sortDate: string | null;
}

type SingleField = Exclude<keyof SeasonFacts, 'prices' | 'fees' | 'locations' | 'sessions'>;
type ListField = 'prices' | 'fees' | 'locations';
type SingleFact<K extends SingleField> = Fact<NonNullable<SeasonFacts[K]>>;
type ListFact<K extends ListField> = Fact<NonNullable<SeasonFacts[K]>[number]>;

export interface FactSet {
  dates?: SingleFact<'season_dates'>;
  ages?: SingleFact<'ages'>;
  grades?: SingleFact<'grades'>;
  hours?: SingleFact<'hours'>;
  extendedCare?: SingleFact<'extended_care'>;
  prices: Array<ListFact<'prices'>>;
  fees: Array<ListFact<'fees'>>;
  locations: Array<ListFact<'locations'>>;
  financialAid?: SingleFact<'financial_aid'>;
  specialNeeds?: SingleFact<'special_needs'>;
  lunch?: SingleFact<'lunch'>;
  transportation?: SingleFact<'transportation'>;
  lastYearOpened?: SingleFact<'last_year_registration_opened'>;
}

export interface CampListing {
  slug: string;
  providerKey: string;
  providerName: string;
  name: string;
  variant: string | null;
  type: string;
  categories: string[];
  description: string | null;
  websiteUrl: string | null;
  campPageUrl: string | null;
  registrationUrl: string | null;
  /** Newest fact per field that wasn't dropped (detail page). */
  facts: FactSet;
  /** Newest publishable fact per field (cards and filters). */
  published: FactSet;
  availability: AvailabilityRow | null;
  milestones: MilestoneRow[];
  sessions: SessionFact[];
  sessionsYear: number | null;
  geo: CampGeoView | null;
  quality: { total: number; verified: number; review: number; dropped: number };
  providerNotes: string | null;
  registration: RegistrationLine;
  lastChecked: string | null;
}

export interface CampsData {
  generatedAt: string;
  attribution: string;
  providers: Array<{ key: string; notes: string | null }>;
  camps: Array<CampRow & { hidden?: boolean }>;
  seasons: SeasonRow[];
  milestones: MilestoneRow[];
  availability: AvailabilityRow[];
  geo: Record<string, CampGeoView | null>;
  quality: Record<string, { total: number; verified: number; review: number; dropped: number }>;
}

const notDropped = (check: Check | undefined) => check?.status !== 'dropped';

function factSet(seasons: SeasonRow[], accept: (check: Check | undefined) => boolean): FactSet {
  const toFact = <T extends Evidence>(evidence: T): Fact<T> => ({
    ...evidence,
    publishable: isPublishable(evidence.check),
  });
  const single = <K extends SingleField>(key: K): SingleFact<K> | undefined => {
    for (const season of seasons) {
      const evidence = season.facts[key] as NonNullable<SeasonFacts[K]> | undefined;
      if (evidence && accept(evidence.check)) return toFact(evidence);
    }
    return undefined;
  };
  const list = <K extends ListField>(key: K): Array<ListFact<K>> => {
    for (const season of seasons) {
      const items = (
        (season.facts[key] ?? []) as Array<NonNullable<SeasonFacts[K]>[number]>
      ).filter((evidence) => accept(evidence.check));
      if (items.length > 0) return items.map(toFact);
    }
    return [];
  };
  return {
    dates: single('season_dates'),
    ages: single('ages'),
    grades: single('grades'),
    hours: single('hours'),
    extendedCare: single('extended_care'),
    prices: list('prices'),
    fees: list('fees'),
    locations: list('locations'),
    financialAid: single('financial_aid'),
    specialNeeds: single('special_needs'),
    lunch: single('lunch'),
    transportation: single('transportation'),
    lastYearOpened: single('last_year_registration_opened'),
  };
}

export function buildListings(data: CampsData, now: Date): CampListing[] {
  const notesByProvider = new Map(data.providers.map((provider) => [provider.key, provider.notes]));

  return data.camps
    .filter((camp) => !camp.hidden)
    .map((camp) => {
      const seasons = data.seasons
        .filter((season) => season.campKey === camp.campKey)
        .sort((a, b) => b.seasonYear - a.seasonYear);
      const sessionSeason = seasons.find((season) => (season.facts.sessions ?? []).length > 0);
      const milestones = data.milestones
        .filter((row) => row.campKey === camp.campKey && row.verifyStatus !== 'dropped')
        .sort((a, b) => a.date.localeCompare(b.date));
      const availability =
        data.availability
          .filter((row) => row.campKey === camp.campKey)
          .sort((a, b) => b.seasonYear - a.seasonYear)[0] ?? null;
      const published = factSet(seasons, isPublishable);

      const checkedDates = seasons
        .flatMap((season) => Object.values(season.facts).flat())
        .map((evidence) => (evidence as Evidence | undefined)?.check?.checkedAt)
        .filter((value): value is string => !!value)
        .sort();

      return {
        slug: camp.slug,
        providerKey: camp.providerKey,
        providerName: camp.providerName,
        name: camp.name,
        variant: camp.variant,
        type: camp.type,
        categories: camp.categories,
        description: camp.description,
        websiteUrl: camp.websiteUrl,
        campPageUrl: camp.campPageUrl,
        registrationUrl: camp.registrationUrl,
        facts: factSet(seasons, notDropped),
        published,
        availability,
        milestones,
        sessions: sessionSeason?.facts.sessions ?? [],
        sessionsYear: sessionSeason?.seasonYear ?? null,
        geo: data.geo[camp.campKey] ?? null,
        quality: data.quality[camp.campKey] ?? { total: 0, verified: 0, review: 0, dropped: 0 },
        providerNotes: notesByProvider.get(camp.providerKey) ?? null,
        registration: registrationLine(milestones, availability, published, seasons, now),
        lastChecked: checkedDates.at(-1) ?? null,
      };
    });
}

// ---------------------------------------------------------------------------
// Registration status (plan §4.3): milestones first, then availability, then what's posted
// ---------------------------------------------------------------------------

export function milestonePublishable(milestone: MilestoneRow): boolean {
  return isPublishableMilestone({
    status: milestone.verifyStatus,
    handCheckedAt: milestone.handCheckedAt ?? undefined,
  });
}

/** Said with "expected", "tentative" or "mid-": never a firm date. */
export function isTentative(milestone: MilestoneRow): boolean {
  return milestone.flags.includes('tentative_wording') || isTentativeWording(milestone.quote);
}

/** Flags that don't make a found quote doubtful on their own. */
const BENIGN_FLAGS = new Set(['needs_hand_check', 'weekday_supports_year', 'tentative_wording']);

/** The quote is on the page and from an official source; only its certainty is in question. */
function acceptedButTentative(milestone: MilestoneRow): boolean {
  return (
    milestone.verifyStatus !== 'dropped' &&
    isTentative(milestone) &&
    milestone.flags.every((flag) => BENIGN_FLAGS.has(flag))
  );
}

/**
 * Until when an opening still reads as upcoming: its stated time; a date with no time, the whole
 * day; a month, the whole month. Eastern time.
 */
function upcomingUntil(milestone: MilestoneRow): Date {
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

function availabilityText(status: string): string {
  return (
    (
      {
        full: 'full',
        waitlist: 'waitlist only',
        closed: 'registration closed',
        available: 'registration open',
        mixed: 'some sessions full',
      } as Record<string, string>
    )[status] ?? status
  );
}

function registrationLine(
  allMilestones: MilestoneRow[],
  availability: AvailabilityRow | null,
  published: FactSet,
  seasons: SeasonRow[],
  now: Date
): RegistrationLine {
  const current = allMilestones.filter((milestone) => milestone.seasonYear === TARGET_SEASON);
  const settled = current
    .filter(milestonePublishable)
    .filter((milestone) => !isTentative(milestone));
  const opens = settled.filter((milestone) => milestone.kind === 'opens');
  const upcoming = opens.filter((milestone) => now < upcomingUntil(milestone));
  const passed = opens.filter((milestone) => now >= upcomingUntil(milestone));
  const today = now.toISOString().slice(0, 10);
  const currentAvailability =
    availability?.seasonYear === TARGET_SEASON &&
    isPublishable({
      status: availability.verifyStatus,
      match: 'exact',
      flags: availability.flags,
      checkedAt: availability.checkedAt,
      handCheckedAt: availability.handCheckedAt ?? undefined,
    })
      ? availability
      : null;
  // A reading about some sessions ("Session A: full") never speaks for the whole camp.
  const campWide = currentAvailability && !currentAvailability.scope ? currentAvailability : null;
  const scoped = currentAvailability?.scope ? currentAvailability : null;

  const closing = settled.find(
    (milestone) =>
      (milestone.kind === 'deadline' || milestone.kind === 'closes') &&
      milestone.audience === 'public' &&
      now >= upcomingUntil(milestone)
  );
  if (closing) {
    return {
      tone: 'closed',
      text: `2027 registration ${closing.kind === 'closes' ? 'closed' : 'deadline passed'} ${formatDate(closing.date, true)}`,
      detail: null,
      sortDate: null,
    };
  }

  if (campWide && ['full', 'waitlist', 'closed'].includes(campWide.status)) {
    return {
      tone: 'closed',
      text: `2027: ${availabilityText(campWide.status)}`,
      detail: null,
      sortDate: null,
    };
  }

  if (upcoming.length > 0) {
    const next = upcoming.find((milestone) => milestone.audience === 'public') ?? upcoming[0];
    const others = upcoming.filter((milestone) => milestone !== next);
    return {
      tone: 'upcoming',
      text: `Registration opens ${formatMilestoneWhen(next)}`,
      detail:
        [
          next.audience !== 'public' ? `For ${audienceLabel(next.audience)}` : null,
          ...others.map(
            (milestone) =>
              `${capitalize(audienceLabel(milestone.audience))}: ${formatMilestoneWhen(milestone)}`
          ),
        ]
          .filter(Boolean)
          .join(' · ') || null,
      sortDate: next.date,
    };
  }

  if (passed.length > 0 || campWide?.status === 'available' || campWide?.status === 'mixed') {
    const last = passed.find((milestone) => milestone.audience === 'public') ?? passed.at(-1);
    // A past opening is history, not proof that registration is still open.
    const opened = last
      ? `2027 registration opened ${last.precision === 'month' ? `in ${formatMilestoneWhen(last)}` : formatDate(last.date, true)}`
      : null;
    return {
      tone: 'open',
      text: campWide ? `2027 ${availabilityText(campWide.status)}` : opened!,
      detail:
        [
          campWide && opened ? opened : null,
          last && last.audience !== 'public' ? `For ${audienceLabel(last.audience)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      sortDate: today,
    };
  }

  if (scoped) {
    return {
      tone: 'unknown',
      text: `2027: ${scoped.scope}: ${availabilityText(scoped.status)}`,
      detail: 'Other sessions not stated',
      sortDate: null,
    };
  }

  // "Expected mid-December": worth saying, never a firm date, and history once the month is gone.
  const tentative = current.find(
    (milestone) => milestone.kind === 'opens' && acceptedButTentative(milestone)
  );
  if (tentative) {
    const live = now < upcomingUntil(tentative);
    return {
      tone: live ? 'tentative' : 'unknown',
      text: `Registration ${live ? 'expected' : 'was expected'} ${formatMilestoneWhen(tentative)}`,
      detail: live ? 'Not confirmed by the camp yet' : 'Not confirmed; check the camp’s site',
      sortDate: live ? tentative.date : null,
    };
  }

  if (current.length > 0) {
    return {
      tone: 'unknown',
      text: 'Registration date found, not confirmed yet',
      detail: 'Shown on the details page once checked',
      sortDate: null,
    };
  }

  const lastYear = published.lastYearOpened
    ? `Opened ${formatDate(published.lastYearOpened.date, true)} last year`
    : null;
  const posted2027 = seasons.some(
    (season) =>
      season.seasonYear === TARGET_SEASON &&
      Object.values(season.facts)
        .flat()
        .some((fact) => isPublishable((fact as Evidence | undefined)?.check))
  );
  return {
    tone: 'unknown',
    text: posted2027
      ? '2027 details posted; registration date not posted yet'
      : '2027 not announced yet',
    detail: lastYear,
    sortDate: null,
  };
}

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
export function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number);
  const suffix = hour >= 12 ? 'p.m.' : 'a.m.';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${suffix}`;
}

export function formatMilestoneWhen(
  milestone: Pick<MilestoneRow, 'date' | 'time' | 'precision'>
): string {
  if (milestone.precision === 'month') {
    const [year, month] = milestone.date.split('-').map(Number);
    return `${MONTHS_LONG[month - 1]} ${year}`;
  }
  const time = milestone.precision === 'datetime' ? formatTime(milestone.time) : null;
  return `${formatDate(milestone.date, true)}${time ? `, ${time}` : ''}`;
}

export function audienceLabel(audience: string): string {
  return (
    (
      {
        public: 'everyone',
        member: 'members',
        returning: 'returning families',
        lottery: 'the lottery',
        resident: 'residents',
        early_bird: 'early bird',
        other: 'some families',
      } as Record<string, string>
    )[audience] ?? audience
  );
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

export function formatGrades(grades: {
  min: number | null;
  max: number | null;
  basis: string;
}): string | null {
  if (grades.min === null && grades.max === null) return null;
  const range =
    grades.min !== null && grades.max !== null
      ? grades.min === grades.max
        ? gradeLabel(grades.min)
        : `${gradeLabel(grades.min)}–${gradeLabel(grades.max)}`
      : grades.min !== null
        ? `${gradeLabel(grades.min)} and up`
        : `up to ${gradeLabel(grades.max!)}`;
  const prefix =
    grades.basis === 'rising' ? 'Rising ' : grades.basis === 'completed' ? 'Finished ' : '';
  return `${prefix}${range} grade`;
}

export function formatAges(ages: { min: number | null; max: number | null }): string | null {
  if (ages.min === null && ages.max === null) return null;
  if (ages.min !== null && ages.max !== null)
    return ages.min === ages.max ? `Age ${ages.min}` : `Ages ${ages.min}–${ages.max}`;
  return ages.min !== null ? `Ages ${ages.min}+` : `Up to age ${ages.max}`;
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Eligibility filters (N11: ages and grades are separate; grades are never converted)
// ---------------------------------------------------------------------------

export interface AgeRange {
  min: number | null;
  max: number | null;
}
export interface GradeRange extends AgeRange {
  basis: string;
}

/** Does a camp take a kid of this age (during summer 2027)? Null when it states no ages. */
export function fitsAge(ages: AgeRange | null, age: number): boolean | null {
  if (!ages || (ages.min === null && ages.max === null)) return null;
  return (ages.min === null || age >= ages.min) && (ages.max === null || age <= ages.max);
}

/**
 * Does a camp take a kid entering this grade in fall 2027 ("rising" grade)? "Completed 2nd" and
 * "current 2nd" (this school year) are both rising 3rd. Null when the camp states no grades, or
 * doesn't say whether its grades are rising or completed: "3rd-9th" alone could be either.
 */
export function fitsGrade(grades: GradeRange | null, risingGrade: number): boolean | null {
  if (!grades || (grades.min === null && grades.max === null)) return null;
  if (grades.basis !== 'rising' && grades.basis !== 'completed' && grades.basis !== 'current') {
    return null;
  }
  const grade = grades.basis === 'rising' ? risingGrade : risingGrade - 1;
  return (
    (grades.min === null || grade >= grades.min) && (grades.max === null || grade <= grades.max)
  );
}

// ---------------------------------------------------------------------------
// Card data for the browser
// ---------------------------------------------------------------------------

/** A value with the summer it describes, for "2026" labels. */
export interface Labeled {
  text: string;
  year: number;
}

/** What the directory needs per card: small enough to send to the browser. */
export interface CampCardData {
  slug: string;
  name: string;
  variant: string | null;
  providerName: string;
  type: string;
  categories: string[];
  town: string | null;
  state: string | null;
  /** Where we placed it when the camp's pages state no site: "Greenville County, SC". */
  approximatePlace: string | null;
  driveMinutes: number | null;
  /** Grades and ages, each labeled with its own summer. */
  eligibility: Labeled[];
  ages: AgeRange | null;
  grades: GradeRange | null;
  price: Labeled | null;
  priceMin: number | null;
  dates: Labeled | null;
  /** Hours and extended care, each labeled with its own summer. */
  hours: Labeled[];
  registration: RegistrationLine;
  websiteUrl: string | null;
  tags: Labeled[];
}

/** The geocode is a real site (an address, street or named venue), not just the town. */
export function isSiteLevel(geo: Pick<CampGeoView, 'layer'>): boolean {
  return ['address', 'street', 'venue'].includes(geo.layer);
}

function labeled(text: string | null | undefined, fact: Evidence | undefined): Labeled | null {
  return text && fact ? { text, year: fact.year } : null;
}

export function toCardData(listing: CampListing): CampCardData {
  const facts = listing.published;
  const location = facts.locations[0];
  const hours = facts.hours
    ? [formatTime(facts.hours.start), formatTime(facts.hours.end)].filter(Boolean).join(' – ')
    : null;
  const care = facts.extendedCare?.late_pickup_end
    ? `care until ${formatTime(facts.extendedCare.late_pickup_end)}`
    : facts.extendedCare
      ? 'extended care'
      : null;

  const tags = [
    labeled(facts.financialAid?.available ? 'Financial aid' : null, facts.financialAid),
    labeled(facts.specialNeeds?.available ? 'Special-needs support' : null, facts.specialNeeds),
    labeled(facts.lunch?.available ? 'Lunch included' : null, facts.lunch),
    labeled(facts.transportation?.available ? 'Transportation' : null, facts.transportation),
  ].filter((tag): tag is Labeled => !!tag);

  return {
    slug: listing.slug,
    name: listing.name,
    variant: listing.variant,
    providerName: listing.providerName,
    type: listing.type,
    categories: listing.categories,
    town: location?.town ?? null,
    state: location?.state ?? null,
    approximatePlace: !location && listing.geo ? listing.geo.label.replace(/, USA$/, '') : null,
    // A town-centroid match says nothing about the drive: the Arboretum came out at 2 minutes.
    driveMinutes: listing.geo && isSiteLevel(listing.geo) ? listing.geo.driveMinutes : null,
    eligibility: [
      labeled(facts.grades && formatGrades(facts.grades), facts.grades),
      labeled(facts.ages && formatAges(facts.ages), facts.ages),
    ].filter((item): item is Labeled => !!item),
    ages: facts.ages ? { min: facts.ages.min, max: facts.ages.max } : null,
    grades: facts.grades
      ? { min: facts.grades.min, max: facts.grades.max, basis: facts.grades.basis }
      : null,
    price: labeled(formatPriceRange(facts.prices), facts.prices[0]),
    priceMin: facts.prices.length ? Math.min(...facts.prices.map((price) => price.amount)) : null,
    dates: labeled(facts.dates && formatDateRange(facts.dates.start, facts.dates.end), facts.dates),
    hours: [labeled(hours, facts.hours), labeled(care, facts.extendedCare)].filter(
      (item): item is Labeled => !!item
    ),
    registration: listing.registration,
    websiteUrl: listing.campPageUrl ?? listing.websiteUrl,
    tags,
  };
}
