/**
 * Offline regressions for lib/camps/verify.ts: the wrong-but-"verified" cases the Codex reviews of
 * the pilot reproduced (2026-10-28), against fixed page texts. No network.
 *
 * Usage:
 *   npx tsx scripts/camps/test-verify.ts
 */
import type { PageText, PageTextFetcher } from '../../lib/camps/fetchPageText';
import type { Evidence, ExtractedCard, Extraction } from '../../lib/camps/types';
import { timesInQuote, verifyExtraction } from '../../lib/camps/verify';

const SITE = 'https://www.campgreenville.org/';
const DATES = 'https://www.campgreenville.org/dates-rates';
const CAMPINTOUCH = 'https://campgreenville.campintouch.com/ui/forms/application/camper/App';
const RYZER = 'https://register.ryzer.com/camp.cfm?id=123';
const ULTRACAMP = 'https://www.ultracamp.com/info/sessions.aspx?idCamp=123';
const ACTIVENET = 'https://anc.apm.activecommunities.com/ashevillerec/activity/search';

const GREENVILLE = `Dates + Rates
Registration Timeline
PHASE 1 - October 6, 2026
Summer 2027 registration opens online for all returning camper families (those that attended in Summer 2026).
Registration will open in phases by division (including any relevant Adventure programs):
6:00 PM EST for only D3 level campers (all programs)
7:00 PM EST for all D2 level campers (D3 will remain open)
PHASE 2 - October 13, 2026
Summer 2027 registration opens online for all new camper families and anyone not eligible for earlier registration dates.
Families of 2026 waitlisted campers are invited to register at 6:00 PM. All others may register starting at 7:00 PM.
Session 1 June 13 - 19 Sun - Sat
Summer 2027 registration opens October 6, 2026 for returning families in all programs.
Registration is expected to open on December 7, 2026.
Register By Jun 20, 2027 11:59pm CST
Sessions run June 10 and July 20, 2027.
Members register first ... then everyone else on March 2, 2027.
Day camp $14.99 per snack pack. Week $300.50. Snacks $7.00 each.
Camp runs 9:00-11:00 AM daily. Regular camp day, 8:30-4:30 - $325/wk.
For campers in rising grades 3-5 in 2027.
June 12-16 Mon-Fri; June 7-11 Mon - Fri.
2026 registration opens October 6.
Afternoon camp 12:30-4:30 daily.
Session dates 2027-06-07 to 2027-06-11.
For rising grades K-5 only.
For all campers returning from Summer 2026, registration opens October 6, 2026.
Register by June 20, 2027.
Grades 3-5 welcome.
Registration opens January 10, 2027; register by June 21, 2027.
Grades 4-6 welcome. Current students receive a discount.
Registration opens March 3, 2027 at 9:00.
Registration opens October 2027; last year it opened October 6, 2026.
Summer 2027 registration opens Oct. 6, 2026.
Summer 2027 registration opens 6 October, 2026.
2026 Registration Closed – Sign Up To Be The First To Know When 2027 Registration Opens
Registration for summer 2027 is closed.
Registration is Open!
Register by February 9, 2026.
Camp runs June 3–12, 2027.
Summer Camp (ages 4-7 and 8-16)
For rising grades K–2 and grades 6–8.
Summer 2027 registration opens October 6 (2026).`;

/** A schedule whose only year is the footer's. */
const SCHEDULE = 'https://www.campgreenville.org/schedule';
/** A program page that is explicitly last summer's. */
const PROGRAMS_2026 = 'https://www.campgreenville.org/precollege';

const PAGES: Record<string, { text: string; finalUrl?: string; links?: string[] }> = {
  [SITE]: {
    text: 'YMCA Camp Greenville',
    links: [DATES, CAMPINTOUCH, RYZER, ULTRACAMP, ACTIVENET, 'https://sponsor.org/'],
  },
  [RYZER]: { text: GREENVILLE, finalUrl: 'https://register.ryzer.com/camp.cfm?id=999' },
  'https://www.ultracamp.com/info/sessions.aspx?idCamp=999': { text: GREENVILLE },
  'https://sponsor.org/camp': { text: GREENVILLE },
  'https://oldcamp.org/': { text: 'Moved', finalUrl: 'https://allevents.in/oldcamp' },
  'https://oldcamp.org/dates': { text: GREENVILLE },
  'https://anc.apm.activecommunities.com/othertown/activity/search': { text: GREENVILLE },
  'https://register.ryzer.com/camp.cfm?id=555': {
    text: GREENVILLE,
    finalUrl: 'https://register.ryzer.com/camp.cfm?id=556',
  },
  'https://register.ryzer.com/camp.cfm?id=556': { text: GREENVILLE },
  [DATES]: { text: GREENVILLE },
  [SCHEDULE]: {
    text: `Greatest Show! Circus Meets Stage
July 13-17
$195 per week
© 2027 Camp Greenville. All rights reserved.`,
  },
  [PROGRAMS_2026]: {
    text: `2026 Pre-College Programs
Eligibility: Open to rising high school sophomores, juniors, and seniors
Apply now.`,
  },
  'https://othercamp.campintouch.com/register': { text: GREENVILLE },
  'https://register.ryzer.com/camp.cfm?id=999': { text: GREENVILLE },
  'https://www.campgreenville.org/old-dates': {
    text: GREENVILLE,
    finalUrl: 'https://allevents.in/x/123',
  },
};

const fetcher: PageTextFetcher = {
  async get(url: string): Promise<PageText> {
    const page = PAGES[url] ?? { text: '' };
    return {
      url,
      finalUrl: page.finalUrl ?? url,
      method: 'fetch',
      status: 200,
      kind: 'html',
      title: '',
      text: page.text,
      links: (page.links ?? []).map((href) => ({ href, text: '' })),
      fetchedAt: new Date().toISOString(),
      ms: 0,
      attempts: [],
    };
  },
  async close() {},
};

const evidence = (
  quote: string,
  extra: Record<string, unknown> = {}
): Evidence & Record<string, unknown> => ({
  year: 2027,
  url: DATES,
  quote,
  source_kind: 'official_site',
  ...extra,
});

const milestone = (quote: string, extra: Record<string, unknown> = {}) =>
  evidence(quote, {
    audience: 'returning',
    kind: 'opens',
    date: '2026-10-06',
    time: null,
    precision: 'date',
    ...extra,
  });

function emptyCard(): ExtractedCard {
  return {
    name: 'Base Camp',
    variant: null,
    type: 'overnight',
    categories: ['general'],
    camp_page_url: SITE,
    registration_url: null,
    description: '',
    season_dates: null,
    ages: null,
    grades: null,
    hours: null,
    extended_care: null,
    prices: [],
    fees: [],
    locations: [],
    financial_aid: null,
    special_needs: null,
    lunch: null,
    transportation: null,
    registration_milestones: [],
    availability: null,
    last_year_registration_opened: null,
    sessions: [],
  };
}

interface Case {
  name: string;
  field:
    | 'registration_milestones'
    | 'season_dates'
    | 'prices'
    | 'hours'
    | 'ages'
    | 'grades'
    | 'availability'
    | 'last_year_registration_opened';
  fact: Evidence & Record<string, unknown>;
  expect: 'verified' | 'flagged' | 'dropped';
  flag?: string;
  /** Defaults: the Greenville site as the only seed, and as the website the model named. */
  seeds?: string[];
  website?: string;
}

const CASES: Case[] = [
  {
    name: 'correct Phase 1 date',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026'),
    expect: 'verified',
  },
  {
    name: 'wrong calendar year (2027-10-06)',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', { date: '2027-10-06' }),
    expect: 'flagged',
  },
  {
    name: 'year bound to its date, not the season ("Summer 2027 ... October 6, 2026")',
    field: 'registration_milestones',
    fact: milestone(
      'Summer 2027 registration opens October 6, 2026 for returning families in all programs.',
      { date: '2027-10-06' }
    ),
    expect: 'flagged',
    flag: 'value_not_in_quote:date',
  },
  {
    name: 'time read from the day number (06:00)',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', { time: '06:00', precision: 'datetime' }),
    expect: 'flagged',
    flag: 'value_not_in_quote:time',
  },
  {
    name: 'returning relabeled as public',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', { audience: 'public' }),
    expect: 'flagged',
    flag: 'audience_context_conflict',
  },
  {
    name: '"returning families in all programs" relabeled public',
    field: 'registration_milestones',
    fact: milestone(
      'Summer 2027 registration opens October 6, 2026 for returning families in all programs.',
      { audience: 'public' }
    ),
    expect: 'flagged',
    flag: 'audience_context_conflict',
  },
  {
    name: 'opening relabeled as a deadline',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', { kind: 'deadline' }),
    expect: 'flagged',
    flag: 'kind_not_in_context',
  },
  {
    name: 'deadline relabeled as an opening',
    field: 'registration_milestones',
    fact: milestone('Register By Jun 20, 2027 11:59pm CST', {
      audience: 'public',
      date: '2027-06-20',
    }),
    expect: 'flagged',
    flag: 'kind_conflict',
  },
  {
    name: '"expected" outside the quote',
    field: 'registration_milestones',
    fact: milestone('December 7, 2026', { audience: 'public', date: '2026-12-07' }),
    expect: 'flagged',
    flag: 'tentative_wording',
  },
  {
    name: 'other tenant on a linked platform host',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', {
      url: 'https://othercamp.campintouch.com/register',
    }),
    expect: 'flagged',
    flag: 'platform_tenant_not_linked',
  },
  {
    name: 'other Ryzer event on the linked host',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', {
      url: 'https://register.ryzer.com/camp.cfm?id=999',
    }),
    expect: 'flagged',
    flag: 'platform_tenant_not_linked',
  },
  {
    name: 'own-site link redirecting to a listing site',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', {
      url: 'https://www.campgreenville.org/old-dates',
    }),
    expect: 'dropped',
  },
  {
    name: 'invented short fragment between real ones ("May 9")',
    field: 'registration_milestones',
    fact: milestone('Members register first ... May 9 ... then everyone else on March 2, 2027.', {
      audience: 'public',
      date: '2027-03-02',
    }),
    expect: 'dropped',
  },
  {
    name: 'June 20 from "June 10 and July 20"',
    field: 'season_dates',
    fact: evidence('Sessions run June 10 and July 20, 2027.', { start: '2027-06-20', end: null }),
    expect: 'flagged',
    flag: 'value_not_in_quote:start',
  },
  {
    name: '$1499 from "$14.99"',
    field: 'prices',
    fact: evidence('Day camp $1499 per snack pack.', { amount: 1499, unit: 'week', tier: null }),
    expect: 'dropped',
  },
  {
    name: '$300 from "$300.50"',
    field: 'prices',
    fact: evidence('Week $300.50.', { amount: 300, unit: 'week', tier: null }),
    expect: 'flagged',
    flag: 'value_not_in_quote:amount',
  },
  {
    name: '19:00 from "$7.00"',
    field: 'hours',
    fact: evidence('Snacks $7.00 each.', { start: '19:00', end: null }),
    expect: 'flagged',
    flag: 'value_not_in_quote:start',
  },
  {
    name: '21:00 from "9:00-11:00 AM"',
    field: 'hours',
    fact: evidence('Camp runs 9:00-11:00 AM daily.', { start: '21:00', end: '11:00' }),
    expect: 'flagged',
    flag: 'value_not_in_quote:start',
  },
  {
    name: 'correct "9:00-11:00 AM"',
    field: 'hours',
    fact: evidence('Camp runs 9:00-11:00 AM daily.', { start: '09:00', end: '11:00' }),
    expect: 'verified',
  },
  {
    name: 'unlabeled camp day "8:30-4:30"',
    field: 'hours',
    fact: evidence('Regular camp day, 8:30-4:30 - $325/wk.', { start: '08:30', end: '16:30' }),
    expect: 'verified',
  },
  {
    name: '"rising grades 3-5" read as completed K-12',
    field: 'grades',
    fact: evidence('For campers in rising grades 3-5 in 2027.', {
      min: 0,
      max: 12,
      basis: 'completed',
    }),
    expect: 'flagged',
  },
  {
    name: 'correct rising 3-5',
    field: 'grades',
    fact: evidence('For campers in rising grades 3-5 in 2027.', {
      min: 3,
      max: 5,
      basis: 'rising',
    }),
    expect: 'verified',
  },
  {
    name: 'Friday start from "June 12-16 Mon-Fri" (2026)',
    field: 'season_dates',
    fact: evidence('June 12-16 Mon-Fri', { year: 2026, start: '2026-06-12', end: '2026-06-16' }),
    expect: 'flagged',
    flag: 'weekday_mismatch:fri',
  },
  {
    name: 'weekday next to the date supports 2027',
    field: 'season_dates',
    fact: evidence('June 7-11 Mon - Fri', { start: '2027-06-07', end: '2027-06-11' }),
    expect: 'verified',
    flag: 'weekday_supports_year',
  },
  // Confirmation gate (second round)
  {
    name: '2027-10-06 from "2026 registration opens October 6"',
    field: 'registration_milestones',
    fact: milestone('2026 registration opens October 6.', {
      audience: 'public',
      date: '2027-10-06',
    }),
    expect: 'flagged',
    flag: 'date_year_not_in_quote:date',
  },
  {
    name: 'October 2027 (month precision) from "... October 6, 2026"',
    field: 'registration_milestones',
    fact: milestone(
      'Summer 2027 registration opens October 6, 2026 for returning families in all programs.',
      { date: '2027-10-01', precision: 'month' }
    ),
    expect: 'flagged',
    flag: 'value_not_in_quote:date',
  },
  {
    name: 'noon start in "12:30-4:30"',
    field: 'hours',
    fact: evidence('Afternoon camp 12:30-4:30 daily.', { start: '12:30', end: '16:30' }),
    expect: 'verified',
  },
  {
    name: 'midnight start from "12:30-4:30"',
    field: 'hours',
    fact: evidence('Afternoon camp 12:30-4:30 daily.', { start: '00:30', end: '16:30' }),
    expect: 'flagged',
    flag: 'value_not_in_quote:start',
  },
  {
    name: 'ISO dates "2027-06-07 to 2027-06-11"',
    field: 'season_dates',
    fact: evidence('Session dates 2027-06-07 to 2027-06-11.', {
      start: '2027-06-07',
      end: '2027-06-11',
    }),
    expect: 'verified',
  },
  {
    name: '"rising grades K-5"',
    field: 'grades',
    fact: evidence('For rising grades K-5 only.', { min: 0, max: 5, basis: 'rising' }),
    expect: 'verified',
  },
  {
    name: '"current" basis with no evidence ("Grades 3-5")',
    field: 'grades',
    fact: evidence('Grades 3-5 welcome.', { min: 3, max: 5, basis: 'current' }),
    expect: 'flagged',
    flag: 'grade_basis_not_in_quote',
  },
  {
    name: '"all campers returning from Summer 2026" relabeled public',
    field: 'registration_milestones',
    fact: milestone(
      'For all campers returning from Summer 2026, registration opens October 6, 2026.',
      { audience: 'public' }
    ),
    expect: 'flagged',
    flag: 'audience_context_conflict',
  },
  {
    name: 'deadline date quoted alone, called an opening',
    field: 'registration_milestones',
    fact: milestone('June 20, 2027', { audience: 'public', date: '2027-06-20' }),
    expect: 'flagged',
    flag: 'kind_conflict',
  },
  {
    name: 'linked Ryzer event redirecting to another event',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', { url: RYZER }),
    expect: 'flagged',
    flag: 'platform_tenant_not_linked',
  },
  {
    name: 'another UltraCamp camp on a linked host',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', {
      url: 'https://www.ultracamp.com/info/sessions.aspx?idCamp=999',
    }),
    expect: 'flagged',
    flag: 'platform_tenant_not_linked',
  },
  {
    name: 'linked website the model named, not yet reviewed',
    field: 'season_dates',
    fact: evidence('June 7-11 Mon - Fri', {
      url: 'https://sponsor.org/camp',
      start: '2027-06-07',
      end: '2027-06-11',
    }),
    website: 'https://sponsor.org/',
    expect: 'flagged',
    flag: 'domain_not_reviewed',
  },
  {
    name: 'seed that redirects to a listing site extends nothing',
    field: 'season_dates',
    fact: evidence('June 7-11 Mon - Fri', {
      url: 'https://oldcamp.org/dates',
      start: '2027-06-07',
      end: '2027-06-11',
    }),
    seeds: ['https://oldcamp.org/'],
    expect: 'flagged',
    flag: 'unrecognized_domain',
  },
  // Second confirmation gate (third round)
  {
    name: 'another ActiveNet account on the same host',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', {
      url: 'https://anc.apm.activecommunities.com/othertown/activity/search',
    }),
    expect: 'flagged',
    flag: 'platform_tenant_not_linked',
  },
  {
    name: 'deadline clause sharing a sentence with an opening',
    field: 'registration_milestones',
    fact: milestone('June 21, 2027', { audience: 'public', date: '2027-06-21' }),
    expect: 'flagged',
    flag: 'kind_conflict',
  },
  {
    name: '"current" basis from "Current students receive a discount"',
    field: 'grades',
    fact: evidence('Grades 4-6 welcome. Current students receive a discount.', {
      min: 4,
      max: 6,
      basis: 'current',
    }),
    expect: 'flagged',
    flag: 'grade_basis_not_in_quote',
  },
  {
    name: 'registration time with no am/pm',
    field: 'registration_milestones',
    fact: milestone('Registration opens March 3, 2027 at 9:00.', {
      audience: 'public',
      date: '2027-03-03',
      time: '09:00',
      precision: 'datetime',
    }),
    expect: 'flagged',
    flag: 'time_ambiguous',
  },
  {
    name: 'a seed redirecting to another Ryzer event authorizes nothing there',
    field: 'registration_milestones',
    fact: milestone('PHASE 1 - October 6, 2026', {
      url: 'https://register.ryzer.com/camp.cfm?id=556',
    }),
    seeds: ['https://register.ryzer.com/camp.cfm?id=555'],
    expect: 'flagged',
    flag: 'platform_tenant_not_linked',
  },
  {
    name: '"opens October 2027" beside last year\'s "October 6, 2026"',
    field: 'registration_milestones',
    fact: milestone('Registration opens October 2027; last year it opened October 6, 2026.', {
      audience: 'public',
      date: '2027-10-01',
      precision: 'month',
    }),
    expect: 'verified',
  },
  // Final confirmation gate
  {
    name: 'October 2027 (month) from "Oct. 6, 2026"',
    field: 'registration_milestones',
    fact: milestone('Summer 2027 registration opens Oct. 6, 2026.', {
      audience: 'public',
      date: '2027-10-01',
      precision: 'month',
    }),
    expect: 'flagged',
    flag: 'value_not_in_quote:date',
  },
  {
    name: 'October 2027 (month) from "6 October, 2026"',
    field: 'registration_milestones',
    fact: milestone('Summer 2027 registration opens 6 October, 2026.', {
      audience: 'public',
      date: '2027-10-01',
      precision: 'month',
    }),
    expect: 'flagged',
    flag: 'value_not_in_quote:date',
  },
  // Final deep review (gate 8)
  {
    name: "availability: 2026's closed status read as 2027's",
    field: 'availability',
    fact: evidence(
      '2026 Registration Closed – Sign Up To Be The First To Know When 2027 Registration Opens',
      { status: 'closed', scope: null }
    ),
    expect: 'flagged',
    flag: 'availability_year_conflict',
  },
  {
    name: 'availability: the same quote as 2026 closed',
    field: 'availability',
    fact: evidence(
      '2026 Registration Closed – Sign Up To Be The First To Know When 2027 Registration Opens',
      { year: 2026, status: 'closed', scope: null }
    ),
    expect: 'verified',
  },
  {
    name: 'availability: "is closed" read as open',
    field: 'availability',
    fact: evidence('Registration for summer 2027 is closed.', { status: 'available', scope: null }),
    expect: 'flagged',
    flag: 'availability_status_not_in_quote',
  },
  {
    name: 'availability: "Registration is Open!"',
    field: 'availability',
    fact: evidence('Registration is Open!', { status: 'available', scope: null }),
    expect: 'verified',
  },
  {
    name: 'season year only in a "© 2027" footer',
    field: 'season_dates',
    fact: evidence('July 13-17', { url: SCHEDULE, start: '2027-07-13', end: '2027-07-17' }),
    expect: 'flagged',
    flag: 'year_not_on_page',
  },
  {
    name: 'grades labeled 2027 on a 2026 program page',
    field: 'grades',
    fact: evidence('Eligibility: Open to rising high school sophomores, juniors, and seniors', {
      url: PROGRAMS_2026,
      min: 10,
      max: 12,
      basis: 'rising',
    }),
    expect: 'flagged',
    flag: 'year_not_on_page',
  },
  {
    name: 'grades labeled 2026 on that page',
    field: 'grades',
    fact: evidence('Eligibility: Open to rising high school sophomores, juniors, and seniors', {
      url: PROGRAMS_2026,
      year: 2026,
      min: 10,
      max: 12,
      basis: 'rising',
    }),
    expect: 'verified',
  },
  {
    name: "last year's opening needs a hand check",
    field: 'last_year_registration_opened',
    fact: evidence('Registration opens October 2027; last year it opened October 6, 2026.', {
      year: 2026,
      date: '2026-10-06',
      time: null,
    }),
    expect: 'verified',
    flag: 'needs_hand_check',
  },
  {
    name: 'last year’s "opening" from "Register by February 9, 2026"',
    field: 'last_year_registration_opened',
    fact: evidence('Register by February 9, 2026.', { year: 2026, date: '2026-02-09', time: null }),
    expect: 'flagged',
    flag: 'kind_conflict',
  },
  {
    name: 'ages 3-12 from "June 3–12, 2027"',
    field: 'ages',
    fact: evidence('Camp runs June 3–12, 2027.', { min: 3, max: 12 }),
    expect: 'flagged',
    flag: 'value_not_in_quote:age_range',
  },
  {
    name: 'ages 8-16 from "ages 4-7 and 8-16"',
    field: 'ages',
    fact: evidence('Summer Camp (ages 4-7 and 8-16)', { min: 8, max: 16 }),
    expect: 'verified',
  },
  {
    name: 'ages 4-16 across two ranges',
    field: 'ages',
    fact: evidence('Summer Camp (ages 4-7 and 8-16)', { min: 4, max: 16 }),
    expect: 'flagged',
    flag: 'value_not_in_quote:age_range',
  },
  {
    name: 'rising K-8 from "K–2 and grades 6–8"',
    field: 'grades',
    fact: evidence('For rising grades K–2 and grades 6–8.', { min: 0, max: 8, basis: 'rising' }),
    expect: 'flagged',
    flag: 'value_not_in_quote:grade_range',
  },
  {
    name: 'rising 6-8 from "K–2 and grades 6–8"',
    field: 'grades',
    fact: evidence('For rising grades K–2 and grades 6–8.', { min: 6, max: 8, basis: 'rising' }),
    expect: 'verified',
  },
  {
    name: 'parenthesized year: "October 6 (2026)" is not October 2027',
    field: 'registration_milestones',
    fact: milestone('Summer 2027 registration opens October 6 (2026).', {
      audience: 'public',
      date: '2027-10-01',
      precision: 'month',
    }),
    expect: 'flagged',
    flag: 'value_not_in_quote:date',
  },
  {
    name: 'parenthesized year: the right date',
    field: 'registration_milestones',
    fact: milestone('Summer 2027 registration opens October 6 (2026).', { audience: 'public' }),
    expect: 'verified',
  },
];

async function main() {
  let failures = 0;

  const times = [...timesInQuote('Opens Oct 6 at 7pm; camp runs 8:30-4:30; snacks $7.00')].sort();
  const expectedTimes = ['08:30', '16:30', '19:00'];
  const timesOk = JSON.stringify(times) === JSON.stringify(expectedTimes);
  if (!timesOk) failures++;
  console.log(`${timesOk ? '✓' : '✗'} timesInQuote: ${times.join(', ')}`);

  for (const testCase of CASES) {
    const card = emptyCard();
    const target = card as unknown as Record<string, unknown>;
    target[testCase.field] = ['registration_milestones', 'prices'].includes(testCase.field)
      ? [testCase.fact]
      : testCase.fact;
    const extraction: Extraction = {
      provider_name: 'YMCA Camp Greenville',
      website_url: testCase.website ?? SITE,
      notes: null,
      excluded: [],
      cards: [card],
    };
    await verifyExtraction(extraction, { fetcher, seedUrls: testCase.seeds ?? [SITE] });
    const check = testCase.fact.check!;
    const flags = check.flags.filter(
      (flag) => !['needs_hand_check', 'weekday_supports_year'].includes(flag)
    );
    const got =
      check.status === 'dropped'
        ? 'dropped'
        : check.status === 'verified' && flags.length === 0
          ? 'verified'
          : 'flagged';
    const ok = got === testCase.expect && (!testCase.flag || check.flags.includes(testCase.flag));
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${testCase.name}: ${check.status} [${check.flags.join(', ')}]`);
  }

  if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll verify regressions pass');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
