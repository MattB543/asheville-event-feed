/**
 * What a camp card and detail page show, built from import rows (today the pilot's
 * data/camps/pilot/import.json; later the camps tables). Pure functions, no I/O.
 *
 * Every field shows its newest summer: 2027 when posted, else 2026 with a "2026" label (D12).
 * One rule decides what is settled enough to drive a card, a filter or the registration line:
 * `isPublishable` (verified by the checker, or checked by hand). Facts waiting for review appear
 * only on the detail page, marked as such; facts that failed verification never appear.
 */

import { parseAsEastern } from '@/lib/utils/timezone';
import type { AvailabilityRow, CampRow, MilestoneRow, SeasonRow } from './importRows';
import { isPublishable, type CheckStatus, type Evidence, type SessionFact } from './types';

export const TARGET_SEASON = 2027;

export type Fact<T extends Evidence> = T & { status: CheckStatus; publishable: boolean };

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

export interface CampListing {
  slug: string;
  campKey: string;
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
  platform: string | null;
  facts: {
    dates?: Fact<Evidence & { start: string | null; end: string | null }>;
    ages?: Fact<Evidence & { min: number | null; max: number | null }>;
    grades?: Fact<Evidence & { min: number | null; max: number | null; basis: string }>;
    hours?: Fact<Evidence & { start: string | null; end: string | null }>;
    extendedCare?: Fact<
      Evidence & {
        early_dropoff_start: string | null;
        late_pickup_end: string | null;
        cost_text: string | null;
      }
    >;
    prices: Array<Fact<Evidence & { amount: number; unit: string; tier: string | null }>>;
    fees: Array<Fact<Evidence & { amount: number; label: string; per: string }>>;
    locations: Array<
      Fact<
        Evidence & {
          name: string;
          address: string | null;
          town: string | null;
          state: string | null;
        }
      >
    >;
    financialAid?: Fact<Evidence & { available: boolean; details: string | null }>;
    specialNeeds?: Fact<Evidence & { available: boolean; details: string | null }>;
    lunch?: Fact<Evidence & { available: boolean; details: string | null }>;
    transportation?: Fact<Evidence & { available: boolean; details: string | null }>;
    lastYearOpened?: Fact<Evidence & { date: string; time: string | null }>;
  };
  availability: AvailabilityRow | null;
  milestones: MilestoneRow[];
  sessions: SessionFact[];
  sessionsYear: number | null;
  geo: CampGeoView | null;
  quality: { total: number; verified: number; review: number; dropped: number };
  providerNotes: string | null;
  registration: RegistrationLine;
  lastChecked: string | null;
  /** Newest summer any fact is about. */
  latestYear: number | null;
}

export interface CampsData {
  generatedAt: string;
  attribution: string;
  providers: Array<{ key: string; notes: string | null }>;
  camps: CampRow[];
  seasons: SeasonRow[];
  milestones: MilestoneRow[];
  availability: AvailabilityRow[];
  geo: Record<string, CampGeoView | null>;
  quality: Record<string, { total: number; verified: number; review: number; dropped: number }>;
}

type SingleKey =
  | 'season_dates'
  | 'ages'
  | 'grades'
  | 'hours'
  | 'extended_care'
  | 'financial_aid'
  | 'special_needs'
  | 'lunch'
  | 'transportation'
  | 'last_year_registration_opened';
type ListKey = 'prices' | 'fees' | 'locations';

const shown = (evidence: Evidence | undefined): evidence is Evidence =>
  !!evidence && evidence.check?.status !== 'dropped';

function withStatus<T extends Evidence>(evidence: T): Fact<T> {
  return {
    ...evidence,
    status: evidence.check?.status ?? 'review',
    publishable: isPublishable(evidence.check),
  };
}

export function isPublishableMilestone(milestone: MilestoneRow): boolean {
  return milestone.verifyStatus === 'verified' || !!milestone.handCheckedAt;
}

export function buildListings(data: CampsData, now: Date): CampListing[] {
  const notesByProvider = new Map(data.providers.map((provider) => [provider.key, provider.notes]));

  return data.camps
    .filter((camp) => !camp.hidden)
    .map((camp) => {
      const seasons = data.seasons
        .filter((season) => season.campKey === camp.campKey)
        .sort((a, b) => b.seasonYear - a.seasonYear);

      const single = <K extends SingleKey>(key: K) => {
        for (const season of seasons) {
          const evidence = season.facts[key];
          if (shown(evidence)) return withStatus(evidence) as never;
        }
        return undefined;
      };
      const list = <K extends ListKey>(key: K) => {
        for (const season of seasons) {
          const items = (season.facts[key] ?? []).filter(shown);
          if (items.length > 0) return items.map(withStatus) as never;
        }
        return [] as never;
      };
      const sessionSeason = seasons.find((season) => (season.facts.sessions ?? []).length > 0);

      const milestones = data.milestones
        .filter(
          (milestone) => milestone.campKey === camp.campKey && milestone.verifyStatus !== 'dropped'
        )
        .sort((a, b) => a.date.localeCompare(b.date));
      const availability =
        data.availability
          .filter((row) => row.campKey === camp.campKey)
          .sort((a, b) => b.seasonYear - a.seasonYear)[0] ?? null;

      const facts: CampListing['facts'] = {
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

      const checkedDates = seasons
        .flatMap((season) => Object.values(season.facts).flat())
        .map((evidence) => (evidence as Evidence | undefined)?.check?.checkedAt)
        .filter((value): value is string => !!value)
        .sort();

      return {
        slug: camp.slug,
        campKey: camp.campKey,
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
        platform: camp.platform,
        facts,
        availability,
        milestones,
        sessions: sessionSeason?.facts.sessions ?? [],
        sessionsYear: sessionSeason?.seasonYear ?? null,
        geo: data.geo[camp.campKey] ?? null,
        quality: data.quality[camp.campKey] ?? { total: 0, verified: 0, review: 0, dropped: 0 },
        providerNotes: notesByProvider.get(camp.providerKey) ?? null,
        registration: registrationLine(milestones, availability, facts, seasons, now),
        lastChecked: checkedDates.at(-1) ?? null,
        latestYear: seasons[0]?.seasonYear ?? null,
      };
    });
}

// ---------------------------------------------------------------------------
// Registration status (plan §4.3): milestones first, then availability, then what's posted
// ---------------------------------------------------------------------------

/**
 * "Expected", "tentative": a date the camp hasn't committed to. The extraction schema has no field
 * for this yet (pilot finding; a `certainty` field is on the Nov 5 list), so it is read from the
 * quote.
 */
export function isTentative(milestone: MilestoneRow): boolean {
  return /\b(expect|expected|expects|tentative|tentatively|anticipat\w*|plan to|plans to|estimated|approximately|should open|likely|hope to)\b/i.test(
    milestone.quote
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

function registrationLine(
  allMilestones: MilestoneRow[],
  availability: AvailabilityRow | null,
  facts: CampListing['facts'],
  seasons: SeasonRow[],
  now: Date
): RegistrationLine {
  const current = allMilestones.filter((milestone) => milestone.seasonYear === TARGET_SEASON);
  const milestones = current.filter(isPublishableMilestone);
  const opens = milestones.filter((milestone) => milestone.kind === 'opens');
  const firm = opens.filter((milestone) => !isTentative(milestone));
  const upcoming = firm.filter((milestone) => now < upcomingUntil(milestone));
  const passed = firm.filter((milestone) => now >= upcomingUntil(milestone));
  const today = now.toISOString().slice(0, 10);
  // Availability drives the headline only when settled, and a reading about some sessions never
  // speaks for the whole camp.
  const currentAvailability =
    availability?.seasonYear === TARGET_SEASON &&
    (availability.verifyStatus === 'verified' || availability.handCheckedAt)
      ? availability
      : null;
  const scopedFull =
    !!currentAvailability?.scope && ['full', 'waitlist'].includes(currentAvailability.status);

  const closing = milestones.find(
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

  if (
    currentAvailability &&
    !scopedFull &&
    ['full', 'waitlist', 'closed'].includes(currentAvailability.status)
  ) {
    const text =
      currentAvailability.status === 'full'
        ? '2027: full'
        : currentAvailability.status === 'waitlist'
          ? '2027: waitlist only'
          : '2027 registration closed';
    return { tone: 'closed', text, detail: currentAvailability.scope, sortDate: null };
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

  if (
    passed.length > 0 ||
    currentAvailability?.status === 'available' ||
    currentAvailability?.status === 'mixed' ||
    scopedFull
  ) {
    const last = passed.find((milestone) => milestone.audience === 'public') ?? passed.at(-1);
    // A past opening is history, not proof that registration is still open.
    const opened = last
      ? `2027 registration opened ${last.precision === 'month' ? `in ${formatMilestoneWhen(last)}` : formatDate(last.date, true)}`
      : null;
    return {
      tone: 'open',
      text:
        currentAvailability?.status === 'mixed' || scopedFull
          ? '2027 registration open; some sessions full'
          : currentAvailability?.status === 'available'
            ? '2027 registration open'
            : opened!,
      detail:
        [
          currentAvailability && opened ? opened : null,
          last && last.audience !== 'public' ? `For ${audienceLabel(last.audience)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      sortDate: today,
    };
  }

  // An "expected" date is never settled (the checker flags it), but saying it's expected, and not
  // confirmed, is still the most useful thing to show.
  const tentative = current.find(
    (milestone) =>
      milestone.kind === 'opens' && milestone.verifyStatus !== 'dropped' && isTentative(milestone)
  );
  if (tentative) {
    return {
      tone: 'tentative',
      text: `Registration expected ${formatMilestoneWhen(tentative)}`,
      detail: 'Not confirmed by the camp yet',
      sortDate: tentative.date,
    };
  }

  if (current.length > milestones.length) {
    return {
      tone: 'unknown',
      text: 'Registration date found, not confirmed yet',
      detail: 'Shown on the details page once checked',
      sortDate: null,
    };
  }

  const lastYear =
    facts.lastYearOpened?.publishable === true
      ? `Opened ${formatDate(facts.lastYearOpened.date, true)} last year`
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

/** Does a camp take a kid of this age (during summer 2027)? Null when it states no ages. */
export function fitsAge(ages: AgeRange | null, age: number): boolean | null {
  if (!ages || (ages.min === null && ages.max === null)) return null;
  return (ages.min === null || age >= ages.min) && (ages.max === null || age <= ages.max);
}

/**
 * Does a camp take a kid entering this grade in fall 2027 ("rising" grade)? Compared only with
 * stated grades, never ages (N11). "Completed 2nd" and "current 2nd" (this school year) are both
 * rising 3rd. Null when the camp states no grades.
 */
export function fitsGrade(grades: GradeRange | null, risingGrade: number): boolean | null {
  if (!grades || (grades.min === null && grades.max === null)) return null;
  const grade =
    grades.basis === 'completed' || grades.basis === 'current' ? risingGrade - 1 : risingGrade;
  return (
    (grades.min === null || grade >= grades.min) && (grades.max === null || grade <= grades.max)
  );
}

export interface AgeRange {
  min: number | null;
  max: number | null;
}
export interface GradeRange extends AgeRange {
  basis: string;
}

/** A value with the summer it describes, for "2026" labels. */
export interface Labeled {
  text: string;
  year: number;
  unconfirmed: boolean;
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
  driveLimit: number | null;
  inRadius: boolean | null;
  eligibility: Labeled | null;
  ages: AgeRange | null;
  grades: GradeRange | null;
  price: Labeled | null;
  priceMin: number | null;
  dates: Labeled | null;
  hours: Labeled | null;
  registration: RegistrationLine;
  websiteUrl: string | null;
  tags: string[];
}

/** The geocode is a real site (an address, street or named venue), not just the town. */
export function isSiteLevel(geo: Pick<CampGeoView, 'layer'>): boolean {
  return ['address', 'street', 'venue'].includes(geo.layer);
}

function labeled(text: string | null, fact: Fact<Evidence> | undefined): Labeled | null {
  return text && fact ? { text, year: fact.year, unconfirmed: !fact.publishable } : null;
}

export function toCardData(listing: CampListing): CampCardData {
  const pub = <T extends { publishable: boolean }>(fact: T | undefined): T | undefined =>
    fact?.publishable ? fact : undefined;
  const all = listing.facts;
  const facts = {
    ...all,
    dates: pub(all.dates),
    ages: pub(all.ages),
    grades: pub(all.grades),
    hours: pub(all.hours),
    extendedCare: pub(all.extendedCare),
    prices: all.prices.filter((price) => price.publishable),
    locations: all.locations.filter((location) => location.publishable),
    financialAid: pub(all.financialAid),
    specialNeeds: pub(all.specialNeeds),
    lunch: pub(all.lunch),
    transportation: pub(all.transportation),
  };
  const eligibility = [
    facts.grades ? formatGrades(facts.grades) : null,
    facts.ages ? formatAges(facts.ages) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const location = facts.locations[0];
  const hours = facts.hours
    ? [formatTime(facts.hours.start), formatTime(facts.hours.end)].filter(Boolean).join(' – ')
    : '';
  const care = facts.extendedCare?.late_pickup_end
    ? `care until ${formatTime(facts.extendedCare.late_pickup_end)}`
    : '';

  const tags: string[] = [];
  if (facts.financialAid?.available) tags.push('Financial aid');
  if (facts.specialNeeds?.available) tags.push('Special-needs support');
  if (facts.extendedCare) tags.push('Extended care');
  if (facts.lunch?.available) tags.push('Lunch included');
  if (facts.transportation?.available) tags.push('Transportation');

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
    driveLimit: listing.geo?.limit ?? null,
    inRadius: listing.geo?.inRadius ?? null,
    eligibility: labeled(eligibility || null, facts.grades ?? facts.ages),
    ages: facts.ages ? { min: facts.ages.min, max: facts.ages.max } : null,
    grades: facts.grades
      ? { min: facts.grades.min, max: facts.grades.max, basis: facts.grades.basis }
      : null,
    price: labeled(formatPriceRange(facts.prices), facts.prices[0]),
    priceMin: facts.prices.length ? Math.min(...facts.prices.map((price) => price.amount)) : null,
    dates: labeled(
      facts.dates ? formatDateRange(facts.dates.start, facts.dates.end) : null,
      facts.dates
    ),
    hours: labeled(
      [hours, care].filter(Boolean).join(', ') || null,
      facts.hours ?? facts.extendedCare
    ),
    registration: listing.registration,
    websiteUrl: listing.campPageUrl ?? listing.websiteUrl,
    tags,
  };
}
