/**
 * Offline regressions for lib/camps/verify.ts: the wrong-but-"verified" cases the Codex review of
 * the pilot reproduced (2026-10-28), against a fixed copy of Camp Greenville's registration text.
 *
 * Usage:
 *   npx tsx scripts/camps/test-verify.ts
 */
import type { PageText, PageTextFetcher } from '../../lib/camps/fetchPageText';
import type { ExtractedCard, Extraction, Milestone } from '../../lib/camps/types';
import { timesInQuote, verifyExtraction } from '../../lib/camps/verify';

const SITE = 'https://www.campgreenville.org/';
const DATES_PAGE = 'https://www.campgreenville.org/dates-rates';
const PAGE_TEXT = `Dates + Rates
Registration Timeline
PHASE 1 - October 6, 2026
Summer 2027 registration opens online for all returning camper families (those that attended in Summer 2026).
Registration will open in phases by division (including any relevant Adventure programs):
6:00 PM EST for only D3 level campers (all programs)
7:00 PM EST for all D2 level campers (D3 will remain open)
PHASE 2 - October 13, 2026
Summer 2027 registration opens online for all new camper families and anyone not eligible for earlier registration dates.
Families of 2026 waitlisted campers are invited to register at 6:00 PM. All others may register starting at 7:00 PM.
Base Camp: $1525
Session 1 June 13 - 19 Sun - Sat`;

const fetcher: PageTextFetcher = {
  async get(url: string): Promise<PageText> {
    return {
      url,
      finalUrl: url,
      method: 'fetch',
      status: 200,
      kind: 'html',
      title: '',
      text: url === DATES_PAGE ? PAGE_TEXT : `Camp Greenville <a> ${DATES_PAGE}`,
      links: [{ href: DATES_PAGE, text: 'Dates + Rates' }],
      fetchedAt: new Date().toISOString(),
      ms: 0,
      attempts: [],
    };
  },
  async close() {},
};

function milestone(overrides: Partial<Milestone>): Milestone {
  return {
    year: 2027,
    url: DATES_PAGE,
    quote: 'PHASE 1 - October 6, 2026',
    source_kind: 'official_site',
    audience: 'returning',
    kind: 'opens',
    date: '2026-10-06',
    time: null,
    precision: 'date',
    ...overrides,
  };
}

function card(milestones: Milestone[]): ExtractedCard {
  return {
    name: 'Base Camp',
    variant: null,
    type: 'overnight',
    categories: ['general'],
    camp_page_url: SITE,
    registration_url: null,
    description: '',
    season_dates: {
      year: 2027,
      url: DATES_PAGE,
      quote: 'Session 1 June 13 - 19 Sun - Sat',
      source_kind: 'official_site',
      start: '2027-06-13',
      end: '2027-06-19',
    },
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
    registration_milestones: milestones,
    availability: null,
    last_year_registration_opened: null,
    sessions: [],
  };
}

const CASES: Array<{ name: string; milestone: Milestone; expect: 'verified' | 'flagged' }> = [
  { name: 'correct Phase 1 date', milestone: milestone({}), expect: 'verified' },
  {
    name: 'wrong calendar year (2027-10-06)',
    milestone: milestone({ date: '2027-10-06' }),
    expect: 'flagged',
  },
  {
    name: 'time read from the day number (06:00)',
    milestone: milestone({ time: '06:00', precision: 'datetime' }),
    expect: 'flagged',
  },
  {
    name: 'returning relabeled as public',
    milestone: milestone({ audience: 'public' }),
    expect: 'flagged',
  },
  {
    name: 'opening relabeled as a deadline',
    milestone: milestone({ kind: 'deadline' }),
    expect: 'flagged',
  },
  {
    name: 'correct public 7 PM opening',
    milestone: milestone({
      quote:
        'Families of 2026 waitlisted campers are invited to register at 6:00 PM. All others may register starting at 7:00 PM.',
      audience: 'public',
      date: '2026-10-13',
      time: '19:00',
      precision: 'datetime',
    }),
    expect: 'flagged', // date not in that quote: the date/time split the schema can't hold yet
  },
  {
    name: 'other tenant on a known platform',
    milestone: milestone({
      url: 'https://othercamp.campintouch.com/register',
      quote: 'PHASE 1 - October 6, 2026',
    }),
    expect: 'flagged',
  },
];

async function main() {
  let failures = 0;
  const times = [...timesInQuote('Registration opens Oct 6 at 7pm; camp runs 8:30-4:30')].sort();
  const expectedTimes = ['04:30', '08:30', '16:30', '19:00', '20:30'];
  if (JSON.stringify(times) !== JSON.stringify(expectedTimes)) {
    failures++;
    console.log(`✗ timesInQuote: ${times.join(', ')} (expected ${expectedTimes.join(', ')})`);
  } else {
    console.log('✓ timesInQuote ignores bare day numbers');
  }

  for (const testCase of CASES) {
    const extraction: Extraction = {
      provider_name: 'YMCA Camp Greenville',
      website_url: SITE,
      notes: null,
      excluded: [],
      cards: [card([testCase.milestone])],
    };
    await verifyExtraction(extraction, { fetcher, seedUrls: [SITE] });
    const check = extraction.cards[0].registration_milestones[0].check!;
    const flags = check.flags.filter((flag) => flag !== 'needs_hand_check');
    const got = check.status === 'verified' && flags.length === 0 ? 'verified' : 'flagged';
    const ok = got === testCase.expect;
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${testCase.name}: ${check.status} [${check.flags.join(', ')}]`);
  }

  const season = (() => {
    const extraction: Extraction = {
      provider_name: 'YMCA Camp Greenville',
      website_url: SITE,
      notes: null,
      excluded: [],
      cards: [card([])],
    };
    return verifyExtraction(extraction, { fetcher, seedUrls: [SITE] }).then(
      () => extraction.cards[0].season_dates!.check!
    );
  })();
  const seasonCheck = await season;
  const seasonOk =
    seasonCheck.flags.includes('weekday_supports_year') && seasonCheck.status === 'verified';
  if (!seasonOk) failures++;
  console.log(
    `${seasonOk ? '✓' : '✗'} weekday next to the date supports 2027: ${seasonCheck.status} [${seasonCheck.flags.join(', ')}]`
  );

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
