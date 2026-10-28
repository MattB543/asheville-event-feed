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
June 12-16 Mon-Fri; June 7-11 Mon - Fri.`;

const PAGES: Record<string, { text: string; finalUrl?: string; links?: string[] }> = {
  [SITE]: { text: 'YMCA Camp Greenville', links: [DATES, CAMPINTOUCH, RYZER] },
  [DATES]: { text: GREENVILLE },
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
  field: 'registration_milestones' | 'season_dates' | 'prices' | 'hours' | 'grades';
  fact: Evidence & Record<string, unknown>;
  expect: 'verified' | 'flagged' | 'dropped';
  flag?: string;
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
      website_url: SITE,
      notes: null,
      excluded: [],
      cards: [card],
    };
    await verifyExtraction(extraction, { fetcher, seedUrls: [SITE] });
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
