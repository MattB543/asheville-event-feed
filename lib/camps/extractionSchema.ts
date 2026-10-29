/**
 * The strict JSON schema for Sol's extraction call, mirroring `ProviderExtraction` in contract.ts.
 *
 * Strict structured output needs every property listed as required, so an optional value is a
 * required, nullable one. `object<T>()` takes exactly the keys of the contract type: a field added
 * to or removed from contract.ts without a matching change here is a type error.
 */

import {
  AUDIENCES,
  AVAILABILITY_STATUSES,
  CAMP_CATEGORIES,
  CAMP_TYPES,
  CONFIDENCE_LEVELS,
  GRADE_BASES,
  MILESTONE_KINDS,
  PRECISIONS,
  PRICE_UNITS,
  SEASON_STATUSES,
  SUPPORT_VALUES,
  type AgeRange,
  type CampCard,
  type GradeRange,
  type Hours,
  type Milestone,
  type PriceTier,
  type ProviderExtraction,
  type Session,
  type Site,
  type SupportFact,
} from './contract';

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
const int = (description?: string): Schema => ({
  type: 'integer',
  ...(description && { description }),
});
const enumOf = (values: readonly string[], description?: string): Schema => ({
  type: 'string',
  enum: [...values],
  ...(description && { description }),
});
const arrayOf = (items: Schema, description?: string): Schema => ({
  type: 'array',
  items,
  ...(description && { description }),
});

function object<T>(properties: { [K in keyof T]-?: Schema }): Schema {
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

const DATE = 'YYYY-MM-DD';
const TIME = 'HH:MM, 24-hour, Eastern';
const YEAR = 'The summer this describes: 2027, or 2026 when 2027 is not posted.';

const ageRange = object<AgeRange>({
  min: nullableNum('Youngest age in years'),
  max: nullableNum('Oldest age in years'),
});

const gradeRange = object<GradeRange>({
  min: nullableNum('Pre-K -1, kindergarten 0, 1st grade 1 ... 12th grade 12'),
  max: nullableNum(),
  basis: enumOf(GRADE_BASES, '"rising 3rd grade" is rising; "completed 2nd grade" is completed'),
});

const hours = object<Hours>({ start: nullableStr(TIME), end: nullableStr(TIME) });

const priceTier = object<PriceTier>({
  amount: { type: 'number', description: 'Dollars' },
  unit: enumOf(PRICE_UNITS),
  label: nullableStr('Which price this is: "member", "half day", "ages 4-7, non-resident" ...'),
  year: int(YEAR),
});

const site = object<Site>({
  name: str('The venue, e.g. "Asheville Middle School"'),
  address: nullableStr(
    'Street address the venue publishes, e.g. "201 Beaverdam Rd"; search for it when not printed'
  ),
  town: nullableStr('Town or city; always given with an address'),
  state: nullableStr('Two-letter state; always given with an address'),
});

const session = object<Session>({
  label: nullableStr('As the camp lists it: "Week 3: Bugs!", "Session A", "Ages 8-10"'),
  start: str(DATE),
  end: str(DATE),
  year: int(YEAR),
  site: nullableStr("A site name from this card's sites, when the card has several"),
  ages: nullable(ageRange),
  grades: nullable(gradeRange),
  hours: nullable(hours),
  price: nullable(priceTier),
  status: nullable(enumOf(AVAILABILITY_STATUSES)),
});

const milestone = object<Milestone>({
  audience: enumOf(AUDIENCES),
  kind: enumOf(MILESTONE_KINDS),
  date: str(`${DATE}; for precision "month", the 1st of the month`),
  time: nullableStr(`${TIME}; only when the page states a time`),
  precision: enumOf(PRECISIONS),
  certainty: enumOf(['announced', 'expected']),
  text: str(
    'The sentence as the page states it; for audience "other", it says who the date is for'
  ),
  url: str('The page that states it'),
  year: int('The summer it is for (2027); the date itself may fall in 2026'),
  confidence: enumOf(CONFIDENCE_LEVELS),
});

const supportFact = nullable(
  object<SupportFact>({
    value: enumOf(SUPPORT_VALUES),
    text: str("The camp's own wording"),
  })
);

type ExtendedCare = NonNullable<CampCard['extended_care']>;
type CardHours = NonNullable<CampCard['hours']>;
type LastYearOpening = NonNullable<CampCard['last_year_registration_opened']>;
type Availability = NonNullable<CampCard['availability']>;

const card = object<CampCard>({
  name: str(
    'Program name as the camp uses it. Reuse the exact name from "Existing programs" for the same program.'
  ),
  type: enumOf(CAMP_TYPES),
  categories: arrayOf(enumOf(CAMP_CATEGORIES)),
  description: str('One or two plain factual sentences on what campers do'),
  camp_page_url: nullableStr('The official page for this program'),
  registration_url: nullableStr('Where parents register (official site or registration platform)'),
  season: object<CampCard['season']>({
    year: int("The summer the card's dates describe"),
    status: enumOf(SEASON_STATUSES, 'Whether the 2027 information for this program is posted'),
    start: nullableStr(`${DATE}, first day across the rows`),
    end: nullableStr(`${DATE}, last day across the rows`),
    text: nullableStr('What the page says about 2027, e.g. "2027 dates coming in January"'),
  }),
  ages: nullable(ageRange),
  grades: nullable(gradeRange),
  sites: arrayOf(site, 'Where campers are dropped off; not field-trip destinations'),
  hours: nullable(
    object<CardHours>({
      start: nullableStr(TIME),
      end: nullableStr(TIME),
      text: nullableStr('Hours as stated, when they need words ("9-3, Fridays until noon")'),
    })
  ),
  extended_care: nullable(
    object<ExtendedCare>({
      early_dropoff_start: nullableStr(TIME),
      late_pickup_end: nullableStr(TIME),
      cost_text: nullableStr('Extra cost as stated, e.g. "$50/week"'),
    })
  ),
  prices: arrayOf(priceTier, "Tiers that apply across sessions; a row's own price goes on the row"),
  sessions: arrayOf(session, 'Weeks, themes, age bands, sites as rows; [] when none are listed'),
  registration: arrayOf(milestone),
  last_year_registration_opened: nullable(
    object<LastYearOpening>({
      date: str(DATE),
      time: nullableStr(TIME),
      text: str('As the page states it'),
      url: str(),
    })
  ),
  availability: nullable(
    object<Availability>({
      status: enumOf(AVAILABILITY_STATUSES),
      scope: nullableStr('Which sessions the status applies to, when not all'),
      text: str('As the page states it'),
    })
  ),
  financial_aid: supportFact,
  special_needs: supportFact,
  lunch: supportFact,
  transportation: supportFact,
  sources: arrayOf(str(), 'The official pages this card was read from'),
  confidence: enumOf(CONFIDENCE_LEVELS),
  review_notes: nullableStr('What a reviewer should check; null when confidence is high'),
});

export const EXTRACTION_SCHEMA: Schema = object<ProviderExtraction>({
  provider_name: str(),
  website_url: nullableStr("The provider's own website"),
  notes: nullableStr(
    'Anything a reviewer should know about the provider: conflicts, missing 2027 info, pages you could not open.'
  ),
  excluded: arrayOf(
    object<ProviderExtraction['excluded'][number]>({ name: str(), reason: str() }),
    'Offerings you found but left out under the camp rule, with the reason'
  ),
  cards: arrayOf(card),
});
