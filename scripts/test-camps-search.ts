/**
 * Camps chat search regressions (docs/camps/06-ai-chat-plan.md §8): fixed-clock fixtures for the
 * wrong matches that matter (a July week standing in for June, a day rate for a weekly budget, a
 * member date for the public one ...), the where registry, the tool session and the index memo.
 * Offline by default; `--live` adds read-only checks against queryCamps() and the directory.
 *
 * Run alone with `npx tsx scripts/test-camps-search.ts [--live]`; npm run test:camps-chat runs it
 * first (scripts/test-camps-chat.ts awaits runCampSearchTests).
 */
import '../lib/config/env';
import assert from 'node:assert/strict';
import type { CampCard, Milestone, PriceTier, Session } from '../lib/camps/contract';
import {
  SUMMER_WEEKS,
  inTargetSeason,
  kidFit,
  registrationLine,
  toCardData,
  type CampCardData,
} from '../lib/camps/display';
import type { CampListing, CampSiteInfo } from '../lib/db/queries/camps';
import { CARD_FIELDS, WHERE_PATHS } from '../lib/camps/chat/fields';
import { PLACES, findPlace } from '../lib/camps/chat/places';
import { buildCampIndex, campDetails, searchCamps, type CampIndex } from '../lib/camps/chat/search';
import {
  CAMP_CHAT_TOOLS,
  createCampIndexLoader,
  createCampToolSession,
} from '../lib/camps/chat/tools';
import type { CampSearchHit, CampSearchResult } from '../lib/camps/chat/types';
import { parseCampSearchFilters } from '../lib/camps/chat/validation';

const NOW = new Date('2026-10-29T16:00:00Z');
const JUNE = { start: '2027-06-14', end: '2027-06-18' };
const JULY = { start: '2027-07-12', end: '2027-07-16' };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type SiteInput = Partial<CampSiteInfo> & { name: string };
type CardInput = Partial<Omit<CampCard, 'sites'>> & { sites?: SiteInput[] };

let ids = 0;
function camp(slug: string, input: CardInput = {}): CampListing {
  const sites: CampSiteInfo[] = (input.sites ?? [{ name: 'Main Site' }]).map((site) => ({
    address: null,
    town: 'Asheville',
    state: 'NC',
    lat: 35.6,
    lng: -82.55,
    driveMinutes: 10,
    driveFromTown: false,
    ...site,
  }));
  const card: CampCard = {
    name: slug.replace(/-/g, ' '),
    type: 'day',
    categories: ['general'],
    description: 'Campers play outside.',
    camp_page_url: 'https://camp.example/page',
    registration_url: null,
    season: { year: 2027, status: 'posted', start: '2027-06-07', end: '2027-08-13', text: null },
    ages: null,
    grades: null,
    hours: null,
    extended_care: null,
    prices: [],
    sessions: [],
    registration: [],
    last_year_registration_opened: null,
    availability: null,
    financial_aid: null,
    special_needs: null,
    lunch: null,
    transportation: null,
    sources: ['https://private.example/source-secretword'],
    confidence: 'low',
    review_notes: 'PRIVATE NOTE secretword',
    ...input,
    sites: sites.map(({ name, address, town, state }) => ({ name, address, town, state })),
  };
  ids++;
  return {
    id: `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`,
    slug,
    campKey: `provider:${slug}`,
    providerKey: 'provider',
    providerName: 'Test Provider (summer camps)',
    providerUrl: 'https://provider.example',
    card,
    sites,
    views: 0,
    confirmed: false,
    checkedAt: '2026-10-20T12:00:00.000Z',
    firstSeenAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
}

function session(dates: { start: string; end: string }, extra: Partial<Session> = {}): Session {
  return {
    label: null,
    start: dates.start,
    end: dates.end,
    year: Number(dates.start.slice(0, 4)),
    site: null,
    ages: null,
    grades: null,
    hours: null,
    price: null,
    status: null,
    ...extra,
  };
}

const tier = (
  amount: number,
  unit: PriceTier['unit'] = 'week',
  label: string | null = null,
  year = 2027
): PriceTier => ({ amount, unit, label, year });

function opening(date: string, extra: Partial<Milestone> = {}): Milestone {
  return {
    audience: 'public',
    kind: 'opens',
    date,
    time: null,
    precision: 'date',
    certainty: 'announced',
    text: `Registration opens ${date}`,
    url: 'https://camp.example/register',
    year: 2027,
    confidence: 'high',
    ...extra,
  };
}

function search(index: CampIndex, args: Record<string, unknown>): CampSearchResult {
  return searchCamps(index, parseCampSearchFilters(args, index.towns), NOW);
}

/** Slugs a search returns, every page. */
function found(index: CampIndex, args: Record<string, unknown>): string[] {
  const slugs: string[] = [];
  for (let page = 1; ; page++) {
    const result = search(index, { ...args, page });
    slugs.push(...result.camps.map((hit) => hit.slug));
    if (!result.hasMore) return slugs.sort();
  }
}

function hitOf(index: CampIndex, args: Record<string, unknown>, slug: string): CampSearchHit {
  const hit = search(index, args).camps.find((one) => one.slug === slug);
  assert(hit, `${slug} should match ${JSON.stringify(args)}`);
  return hit;
}

const has = (list: string[], text: RegExp) => list.some((item) => text.test(item));

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

function keywordTests() {
  const longDescription = `${'Campers hike and swim every day. '.repeat(10)}On Friday they visit the café for Arts & Crafts.`;
  const index = buildCampIndex([
    camp('artists', { name: 'Young Artists Studio', description: longDescription }),
    camp('smart-start', {
      name: 'Smart Start',
      description: 'Kickstart your summer with painting.',
    }),
    camp('kids-corner', { name: 'Kids’ Corner', description: 'Games.' }),
    camp('sibling-tier', {
      name: 'Sibling Fun',
      prices: [tier(250), tier(200, 'week', 'Sibling discount')],
    }),
    camp('scattered', { name: 'Sibling Days', description: 'Ask about a discount.' }),
    camp('coding-july', {
      name: 'Tech Weeks',
      sessions: [session(JUNE, { label: 'Nature Week' }), session(JULY, { label: 'Coding Week' })],
    }),
    camp('two-campuses', {
      name: 'Campus Camp',
      sites: [
        { name: 'Biltmore Campus', driveMinutes: 10 },
        { name: 'Weaverville Campus', town: 'Weaverville', driveMinutes: 40 },
      ],
    }),
    camp('secret', { name: 'Plain Camp', camp_page_url: 'https://secretword.example/' }),
  ]);

  // Word starts, not substrings; the whole description, not the first sentence
  assert.deepEqual(found(index, { keywords: ['art'] }), ['artists']);
  assert.deepEqual(found(index, { keywords: ['cafe'] }), ['artists']);
  assert.deepEqual(found(index, { keywords: ['arts and crafts'] }), ['artists']);
  assert.deepEqual(found(index, { keywords: ['kids'] }), ['kids-corner']);
  assert.deepEqual(found(index, { keywords: ["kid's"] }), ['kids-corner']);
  // A phrase stays together: not "sibling" in the name and "discount" in the description
  assert.deepEqual(found(index, { keywords: ['sibling discount'] }), ['sibling-tier']);
  assert.deepEqual(found(index, { keywords: ['sibling', 'discount'] }).sort(), [
    'scattered',
    'sibling-tier',
  ]);
  // all / any / exclusions (broad: a price label counts)
  assert.deepEqual(found(index, { keywords: ['painting', 'hike'] }), []);
  assert.deepEqual(found(index, { keywords: ['painting', 'hike'], keywordMatch: 'any' }), [
    'artists',
    'smart-start',
  ]);
  assert(!found(index, { excludeKeywords: ['discount'] }).includes('sibling-tier'));
  assert(!found(index, { excludeKeywords: ['discount'] }).includes('scattered'));
  // Private fields and URLs are not searched
  assert.deepEqual(found(index, { keywords: ['secretword'] }), []);
  assert.deepEqual(found(index, { keywords: ['private note'] }), []);

  // Snippets: labelled by field, at most 160 characters, around the match
  const snippet = hitOf(index, { keywords: ['cafe'] }, 'artists').keywordHits[0];
  assert.equal(snippet.field, 'description');
  assert(snippet.text.length <= 160 && /café/.test(snippet.text), snippet.text);

  // A session label only counts on that session: June can't borrow July's coding
  assert.deepEqual(
    found(index, { keywords: ['coding'], dates: { ...JUNE, match: 'overlaps' } }),
    []
  );
  const coding = hitOf(index, { keywords: ['coding'] }, 'coding-july');
  assert.equal(coding.matchedSessions, 1);
  assert.equal(coding.matches[0].label, 'Coding Week');
  assert.equal(coding.keywordHits[0].field, 'sessions[].label');
  // A site name only counts at that site, which must pass the drive filter
  assert.deepEqual(found(index, { keywords: ['weaverville'], maxDriveMinutes: 20 }), []);
  const campus = hitOf(index, { keywords: ['weaverville'], maxDriveMinutes: 45 }, 'two-campuses');
  assert.deepEqual(
    campus.matches.map((match) => match.site),
    ['Weaverville Campus']
  );

  // The parser
  assert.throws(() => parseCampSearchFilters({ keywords: [''] }), /1-80/);
  assert.throws(() => parseCampSearchFilters({ keywords: ['!!!'] }), /letters or digits/);
  assert.throws(() => parseCampSearchFilters({ keywords: ['x'.repeat(81)] }), /1-80/);
  assert.throws(
    () => parseCampSearchFilters({ keywords: ['horseback riding'], excludeKeywords: ['horse'] }),
    /excluded/
  );
  assert.doesNotThrow(() =>
    parseCampSearchFilters({
      keywords: ['horse', 'pony'],
      keywordMatch: 'any',
      excludeKeywords: ['horse'],
    })
  );
  assert.deepEqual(
    parseCampSearchFilters({ keywords: ['Art', 'art', '  art '] }).keywords?.length,
    1
  );
}

// ---------------------------------------------------------------------------
// Eligibility and kids modes
// ---------------------------------------------------------------------------

function eligibilityTests() {
  const index = buildCampIndex([
    camp('grades-session', {
      ages: { min: 5, max: 12 },
      sessions: [
        session(JUNE, { label: 'Middle', grades: { min: 6, max: 8, basis: 'rising' } }),
        session(JULY, { label: 'Open' }),
      ],
    }),
    camp('ages-session', {
      grades: { min: 1, max: 3, basis: 'rising' },
      sessions: [session(JUNE, { label: 'Teens', ages: { min: 13, max: 15 } })],
    }),
    camp('unstated'),
    camp('two-bands', {
      sites: [{ name: 'North' }, { name: 'South', driveMinutes: 40 }],
      sessions: [
        session(JUNE, { label: 'Juniors', ages: { min: 5, max: 8 }, site: 'North' }),
        session(JUNE, { label: 'Seniors', ages: { min: 9, max: 12 }, site: 'South' }),
      ],
    }),
    camp('one-room', {
      ages: { min: 5, max: 12 },
      sites: [{ name: 'North' }, { name: 'South' }],
      sessions: [session(JUNE, { label: 'Everyone' })],
    }),
  ]);

  // A session's grades replace the card's ages too: age 7 fits only the session without its own
  const seven = hitOf(index, { kids: [{ age: 7, grade: null }] }, 'grades-session');
  assert.deepEqual(
    seven.matches.map((match) => match.label),
    ['Open']
  );
  const grade7 = hitOf(index, { kids: [{ age: null, grade: 7 }] }, 'grades-session');
  assert.equal(grade7.matches.find((match) => match.label === 'Middle')?.kidFit, 'fits');
  // A session's ages replace the card's grades
  assert(!found(index, { kids: [{ age: null, grade: 2 }] }).includes('ages-session'));
  // No bounds: may fit, flagged
  const unstated = hitOf(index, { kids: [{ age: 7, grade: null }] }, 'unstated');
  assert.equal(unstated.matches[0].kidFit, 'may_fit');
  assert(has(unstated.matches[0].caveats, /uncertain/));

  // Two kids: any / each / same session, at the session's own site
  const kids = [
    { age: 6, grade: null },
    { age: 10, grade: null },
  ];
  // One example per hit, with counts saying more passed; "each" shows one per child
  const any = hitOf(index, { kids, kidsMode: 'any' }, 'two-bands');
  assert.deepEqual([any.matches.length, any.matchedSessions, any.totalSessions], [1, 2, 2]);
  const each = hitOf(index, { kids, kidsMode: 'each' }, 'two-bands');
  assert.deepEqual(
    each.matches.map((match) => [match.label, match.site, match.kidIndexes]),
    [
      ['Juniors', 'North', [0]],
      ['Seniors', 'South', [1]],
    ]
  );
  assert(!found(index, { kids, kidsMode: 'same_session' }).includes('two-bands'));
  const together = hitOf(index, { kids, kidsMode: 'same_session' }, 'one-room');
  assert.deepEqual(together.matches[0].kidIndexes, [0, 1]);
  // A child no session takes: each fails, any still matches
  const tooOld = [
    { age: 6, grade: null },
    { age: 15, grade: null },
  ];
  assert(!found(index, { kids: tooOld, kidsMode: 'each' }).includes('two-bands'));
  assert(found(index, { kids: tooOld, kidsMode: 'any' }).includes('two-bands'));
  // Twins of one age are two kids
  assert.equal(
    parseCampSearchFilters({
      kids: [
        { age: null, grade: 3 },
        { age: null, grade: 3 },
      ],
    }).kids?.length,
    2
  );
  assert.throws(
    () => parseCampSearchFilters({ kids: [{ age: null, grade: null }] }),
    /age or a grade/
  );
  assert.throws(() => parseCampSearchFilters({ kids: [{ age: 30, grade: null }] }), /1 to 25/);
  assert.throws(() => parseCampSearchFilters({ kids: [{ age: null, grade: 2.5 }] }), /whole/);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function dateTests() {
  const index = buildCampIndex([
    camp('schedule-2026', {
      season: {
        year: 2026,
        status: 'not_posted',
        start: '2026-07-06',
        end: '2026-07-10',
        text: null,
      },
      sessions: [session({ start: '2026-07-06', end: '2026-07-10' }, { label: 'Week 5' })],
      prices: [tier(200, 'week', null, 2026)],
    }),
    camp('season-2027-sessions-2026', {
      sessions: [session({ start: '2026-07-06', end: '2026-07-10' })],
    }),
    camp('schedule-2024', {
      season: {
        year: 2024,
        status: 'not_posted',
        start: '2024-07-08',
        end: '2024-07-12',
        text: null,
      },
      sessions: [session({ start: '2024-07-08', end: '2024-07-12' })],
    }),
    camp('one-week', { sessions: [session(JUNE)] }),
    camp('whole-summer'),
    camp('short-season', {
      season: { year: 2027, status: 'posted', start: JUNE.start, end: JUNE.end, text: null },
    }),
    camp('reversed', {
      season: { year: 2027, status: 'posted', start: '2027-08-13', end: '2027-06-01', text: null },
    }),
    camp('registration-2026', {
      registration: [opening('2026-01-10', { year: 2026 })],
    }),
  ]);
  const target = { start: '2027-07-05', end: '2027-07-09', match: 'overlaps' };

  // An older schedule moves to the same 2027 week, original and projected dates both returned
  const projected = hitOf(index, { dates: target }, 'schedule-2026').matches[0];
  assert.deepEqual(
    [projected.start, projected.projectedStart, projected.projectedEnd],
    ['2026-07-06', '2027-07-05', '2027-07-09']
  );
  assert(has(projected.caveats, /Based on its 2026 schedule; 2027 not posted/));
  // The hit already says the card's prices are 2026's
  assert(!has(projected.caveats, /2026 price/));
  assert(has(hitOf(index, { dates: target }, 'schedule-2026').caveats, /prices are from 2026/));
  // A 2027 season with last summer's session list says just that (LEAF)
  assert.deepEqual(
    hitOf(index, { dates: target }, 'season-2027-sessions-2026').matches[0].caveats,
    ['Based on its 2026 session list; 2027 sessions not posted']
  );
  assert.equal(
    hitOf(index, { dates: target }, 'schedule-2024').matches[0].projectedStart,
    '2027-07-05'
  );
  // A question about 2026 compares the original dates
  const history = hitOf(
    index,
    { dates: { start: '2026-07-06', end: '2026-07-10', match: 'overlaps' } },
    'schedule-2026'
  );
  assert.equal(history.matches[0].projectedStart, null);
  assert(!found(index, { dates: { start: '2026-07-06', end: '2026-07-10' } }).includes('one-week'));

  // overlaps vs covers: one listed session has to span the range
  const covers = (start: string, end: string) =>
    found(index, { dates: { start, end, match: 'covers' } });
  assert(covers('2027-06-15', '2027-06-16').includes('one-week'));
  assert(!covers('2027-06-14', '2027-06-21').includes('one-week'));
  assert(found(index, { dates: { start: '2027-06-14', end: '2027-06-21' } }).includes('one-week'));
  // A summer-long season doesn't prove a given week; a one-week season is that week
  const week = covers(JUNE.start, JUNE.end);
  assert(!week.includes('whole-summer'));
  assert(week.includes('short-season'));
  const envelope = search(index, { dates: { ...JUNE, match: 'covers' } });
  assert((envelope.unknownCounts.dates ?? 0) >= 1);
  const allowed = hitOf(
    index,
    { dates: { ...JUNE, match: 'covers' }, includeUnknown: ['dates'] },
    'whole-summer'
  );
  assert.deepEqual(allowed.matches[0].unknown, ['dates']);
  assert(has(allowed.caveats, /No sessions listed/));
  // A reversed interval is unknown, never repaired
  assert(!found(index, { dates: { ...JUNE, match: 'overlaps' } }).includes('reversed'));
  assert(
    found(index, { dates: { ...JUNE, match: 'overlaps' }, includeUnknown: ['dates'] }).includes(
      'reversed'
    )
  );
  // Registration dates are never projected: a 2026-summer opening never matches
  for (const window of [
    { from: '2027-01-01', to: '2027-01-31' },
    { from: '2026-01-01', to: '2026-01-31' },
  ]) {
    assert(
      !found(index, { registrationOpens: { ...window, audience: 'any' } }).includes(
        'registration-2026'
      )
    );
  }
  assert.throws(
    () => parseCampSearchFilters({ dates: { start: '2027-02-30', end: '2027-03-01' } }),
    /real/
  );
  assert.throws(
    () => parseCampSearchFilters({ dates: { start: '2027-07-02', end: '2027-07-01' } }),
    /on or before/
  );
  assert.equal(
    parseCampSearchFilters({ dates: { start: '2026-01-01', end: '2026-01-02' } }).dates?.match,
    'overlaps'
  );
}

// ---------------------------------------------------------------------------
// Hours and care
// ---------------------------------------------------------------------------

function hoursTests() {
  const workday = { dropoffBy: '08:30', pickupAtOrAfter: '17:00' };
  const index = buildCampIndex([
    camp('care', {
      hours: { start: '09:00', end: '15:00', text: null },
      prices: [tier(300)],
      extended_care: {
        early_dropoff_start: '07:30',
        late_pickup_end: '17:30',
        cost_text: '$50/week',
      },
    }),
    camp('no-care', { hours: { start: '09:00', end: '15:00', text: null } }),
    camp('cost-only', {
      hours: { start: '09:00', end: '15:00', text: null },
      extended_care: { early_dropoff_start: null, late_pickup_end: null, cost_text: 'Extra fee' },
    }),
    camp('no-start', { hours: { start: null, end: '17:30', text: null } }),
    camp('short-morning', { hours: { start: '09:00', end: null, text: null } }),
    camp('session-hours', {
      hours: { start: '09:00', end: '17:00', text: null },
      sessions: [session(JUNE, { hours: { start: '08:00', end: null } })],
    }),
    camp('overnight', { type: 'overnight', hours: { start: '08:00', end: '17:00', text: null } }),
    camp('half-tier', {
      hours: { start: '09:00', end: '17:00', text: null },
      prices: [tier(150, 'week', 'half day'), tier(350, 'week', 'full day')],
    }),
    camp('half-hours', {
      hours: { start: '09:00', end: '12:30', text: null },
      prices: [tier(150, 'week', 'half day'), tier(350, 'week', 'full day')],
    }),
    camp('friday-noon', {
      hours: { start: '08:00', end: '17:00', text: 'Friday pickup at noon' },
    }),
    camp('half-day-type', { type: 'half_day' }),
  ]);

  // Care counts toward the times, with its stated cost, whatever `needs` says
  const care = hitOf(index, { ...workday, price: { min: null, max: 400, per: 'week' } }, 'care');
  assert(has(care.matches[0].caveats, /care cost: \$50\/week/));
  // The camp's own care wording only: some stated prices already include care
  assert(!has(care.matches[0].caveats, /excludes care/));
  assert(has(hitOf(index, { dropoffBy: '08:00' }, 'care').matches[0].caveats, /\$50\/week/));
  const matched = found(index, workday);
  assert(!matched.includes('no-care'));
  assert(!matched.includes('cost-only'), 'Care with no times proves nothing');
  assert(!matched.includes('no-start'));
  const lenient = found(index, { ...workday, includeUnknown: ['hours'] });
  assert(lenient.includes('cost-only') && lenient.includes('no-start'));
  // A stated time that fails beats an unknown end, even with unknowns allowed
  assert(!lenient.includes('short-morning'));
  assert(!lenient.includes('no-care'));
  // Session times override the card's one end at a time
  const inherited = hitOf(index, { dropoffBy: '08:15' }, 'session-hours');
  assert.deepEqual(inherited.matches[0].hours, { start: '08:00', end: '17:00' });
  // Hours filters exclude overnight camps
  assert(!found(index, { dayLength: 'full' }).includes('overnight'));
  assert(!found(index, { dropoffBy: '09:00' }).includes('overnight'));
  // A half-day price can't stand for a full day, nor a pickup after the half day ends; a drop-off
  // time alone it can serve
  const under200 = { price: { min: null, max: 200, per: 'week' } };
  assert(!found(index, { dayLength: 'full', ...under200 }).includes('half-tier'));
  assert(found(index, under200).includes('half-tier'));
  assert(found(index, { dropoffBy: '09:00', ...under200 }).includes('half-tier'));
  assert(!found(index, { pickupAtOrAfter: '17:00', ...under200 }).includes('half-tier'));
  assert(has(hitOf(index, under200, 'half-tier').matches[0].caveats, /hours shown are the full/));
  // Beside full-day hours a half-day price doesn't say when its half day ends (9-12:30? 1-5?)
  assert(!found(index, { pickupAtOrAfter: '13:00', ...under200 }).includes('half-tier'));
  const noon = { dropoffBy: '09:00', pickupAtOrAfter: '12:00' };
  assert.equal(hitOf(index, noon, 'half-tier').matches[0].price?.label, 'full day');
  // Hours that are themselves a half day do
  assert.equal(hitOf(index, noon, 'half-hours').matches[0].price?.label, 'half day');
  assert(found(index, { pickupAtOrAfter: '12:30', ...under200 }).includes('half-hours'));
  assert(!found(index, { pickupAtOrAfter: '13:00', ...under200 }).includes('half-hours'));
  const fullDay = hitOf(index, { dayLength: 'full' }, 'half-tier');
  assert.equal(fullDay.matches[0].price?.label, 'full day', 'Not the half-day price as an example');
  // Hours exceptions stay with the hit, and caveats don't repeat them
  const friday = hitOf(index, { dayLength: 'full' }, 'friday-noon');
  assert.equal(friday.hoursNote, 'Friday pickup at noon');
  assert(!has(friday.caveats, /Friday pickup at noon/));
  assert(found(index, { dayLength: 'half' }).includes('half-day-type'));
  assert.throws(() => parseCampSearchFilters({ dropoffBy: '8:30' }), /HH:MM/);
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

function priceTests() {
  const index = buildCampIndex([
    camp('weekly-250', { sessions: [session(JUNE)], prices: [tier(250)] }),
    camp('all-free', { prices: [tier(0, 'week', 'Free')] }),
    camp('no-price'),
    camp('zero-beside-paid', { prices: [tier(0, 'week', 'Staff children'), tier(300)] }),
    camp('daily-60', { sessions: [session(JUNE)], prices: [tier(60, 'day')] }),
    camp('session-400', { sessions: [session(JUNE, { price: tier(400, 'session') })] }),
    camp('program-sole', {
      season: { year: 2027, status: 'posted', start: JUNE.start, end: JUNE.end, text: null },
      prices: [tier(500, 'program')],
    }),
    camp('program-with-sessions', { sessions: [session(JUNE)], prices: [tier(500, 'program')] }),
    camp('summer-session-price', { prices: [tier(1000, 'session')] }),
    camp('own-price', {
      prices: [tier(100)],
      sessions: [session(JUNE, { price: tier(500) })],
    }),
    camp('member', {
      sessions: [session(JUNE)],
      prices: [tier(200, 'week', 'Member'), tier(300, 'week', 'Non-member', 2026)],
    }),
    camp('labelled', { sessions: [session(JUNE)], prices: [tier(250, 'week', 'from')] }),
    camp('sibling-other', {
      sessions: [session(JUNE, { price: tier(180, 'other', 'Sibling discount') })],
    }),
    camp('member-program', {
      sessions: [session(JUNE)],
      prices: [tier(500, 'program', 'Member rate')],
    }),
    camp('fee-and-weekly', {
      sessions: [session(JUNE)],
      prices: [tier(40, 'other', 'Registration fee per family'), tier(325)],
    }),
    camp('band-tier', {
      ages: { min: 5, max: 14 },
      sessions: [session(JUNE)],
      prices: [tier(250, 'week', 'Ages 11-14, junior counselors'), tier(375)],
    }),
    camp('grade-band-tier', {
      sessions: [session(JUNE)],
      prices: [
        tier(1495, 'session', 'rising grades 7–9'),
        tier(1925, 'session', 'rising grades 10–12'),
      ],
    }),
  ]);
  const week = (min: number | null, max: number | null) => ({ price: { min, max, per: 'week' } });
  const perSession = (min: number | null, max: number | null) => ({
    price: { min, max, per: 'session' },
  });

  assert(found(index, week(null, 299.99)).includes('weekly-250'));
  // The example shows the weekly price, not a cheaper fee
  assert.equal(hitOf(index, {}, 'fee-and-weekly').matches[0].price?.amount, 325);
  // A price for one age band isn't a younger kid's price
  const age = (years: number) => ({ kids: [{ age: years, grade: null }] });
  assert(!found(index, { ...age(7), ...week(null, 300) }).includes('band-tier'));
  assert(found(index, { ...age(12), ...week(null, 300) }).includes('band-tier'));
  assert.equal(hitOf(index, age(7), 'band-tier').matches[0].price?.amount, 375);
  const grade8 = { kids: [{ age: null, grade: 8 }], ...perSession(null, 1500) };
  assert.equal(hitOf(index, grade8, 'grade-band-tier').matches[0].price?.amount, 1495);
  const grade11 = { kids: [{ age: null, grade: 11 }], ...perSession(null, 1500) };
  assert(!found(index, grade11).includes('grade-band-tier'));
  assert(!found(index, week(260, null)).includes('weekly-250'));
  // Free means every stated price is $0; a missing price is unknown, a $0 extra isn't the price
  const free = found(index, week(0, 0));
  assert(free.includes('all-free'));
  assert(!free.includes('no-price') && !free.includes('zero-beside-paid'));
  assert((search(index, week(0, 0)).unknownCounts.price ?? 0) >= 1);
  const unknownPrice = hitOf(index, { ...week(0, 0), includeUnknown: ['price'] }, 'no-price');
  assert.deepEqual(unknownPrice.matches[0].unknown, ['price']);
  // A day rate is five days a week, inclusive bounds, estimate flagged
  assert(!found(index, week(null, 299.99)).includes('daily-60'));
  const daily = hitOf(index, week(null, 300), 'daily-60').matches[0];
  assert.deepEqual(daily.comparedPrice, { amount: 300, per: 'week' });
  assert(has(daily.caveats, /estimated from \$60\/day/));
  // Per session: a stated session price, or the program of a camp listing no sessions; a weekly
  // price never becomes an invented session total
  assert(found(index, perSession(null, 500)).includes('session-400'));
  assert(found(index, perSession(null, 600)).includes('program-sole'));
  assert(!found(index, perSession(null, 600)).includes('program-with-sessions'));
  assert(!found(index, perSession(null, 1000)).includes('weekly-250'));
  // A summer-long season doesn't spread a session price into a cheap week
  assert(!found(index, week(null, 200)).includes('summer-session-price'));
  // A session's own price replaces the card's tiers
  assert(!found(index, week(null, 200)).includes('own-price'));
  // A member price is a possible price, flagged, with its label and year kept
  const member = hitOf(index, week(null, 250), 'member').matches[0];
  assert.equal(member.price?.label, 'Member');
  assert.equal(member.price?.year, 2027);
  assert(has(member.caveats, /may not apply/));
  const nonMember = hitOf(index, week(250, null), 'member').matches[0];
  assert(has(nonMember.caveats, /^2026 price$/));
  // A plain label is on match.price already: no caveat repeats it
  const labelled = hitOf(index, week(null, 300), 'labelled').matches[0];
  assert.deepEqual([labelled.price?.label, labelled.caveats], ['from', []]);
  // A price in no comparable unit is unknown, but its tier keeps its label for keywords and where
  const sibling = { ...week(null, 300), keywords: ['sibling discount'] };
  assert(!found(index, sibling).includes('sibling-other'));
  const unknownTier = hitOf(index, { ...sibling, includeUnknown: ['price'] }, 'sibling-other');
  assert.deepEqual(
    [unknownTier.matches[0].price?.label, unknownTier.matches[0].comparedPrice],
    ['Sibling discount', null]
  );
  assert.deepEqual(unknownTier.matches[0].unknown, ['price']);
  assert(has(unknownTier.matches[0].caveats, /may not apply/));
  assert(
    found(index, {
      ...perSession(null, 600),
      includeUnknown: ['price'],
      where: [{ path: 'prices[].label', op: 'contains', value: 'member' }],
    }).includes('member-program')
  );

  assert.throws(() => parseCampSearchFilters({ price: { min: null, max: null } }), /min or a max/);
  assert.throws(() => parseCampSearchFilters({ price: { min: 300, max: 100 } }), /not be above/);
  assert.throws(() => parseCampSearchFilters({ price: { min: -1, max: null } }), /0 to 100000/);
  assert.equal(parseCampSearchFilters({ price: { min: null, max: 5 } }).price?.per, 'week');
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

function locationTests() {
  const index = buildCampIndex([
    camp('far-young', {
      sites: [
        { name: 'Near', driveMinutes: 10 },
        { name: 'Far', driveMinutes: 50 },
      ],
      sessions: [
        session(JUNE, { label: 'Young', ages: { min: 5, max: 8 }, site: 'Far' }),
        session(JUNE, { label: 'Old', ages: { min: 9, max: 12 }, site: 'Near' }),
      ],
    }),
    camp('unmatched-site', { sessions: [session(JUNE, { site: 'Nowhere Hall' })] }),
    camp('brevard-estimate', {
      sites: [
        {
          name: 'Brevard Church',
          town: 'Brevard',
          lat: null,
          lng: null,
          driveMinutes: 50.1,
          driveFromTown: true,
        },
      ],
    }),
    camp('drive-30-4', { sites: [{ name: 'A', driveMinutes: 30.4 }] }),
    camp('drive-30-6', { sites: [{ name: 'B', driveMinutes: 30.6 }] }),
    camp('cleveland', {
      sites: [{ name: 'Camp', town: 'Cleveland', state: 'SC', driveMinutes: 60 }],
    }),
  ]);

  // Kid, site and drive on the same session
  assert(
    !found(index, { kids: [{ age: 6, grade: null }], maxDriveMinutes: 20 }).includes('far-young')
  );
  assert(
    found(index, { kids: [{ age: 10, grade: null }], maxDriveMinutes: 20 }).includes('far-young')
  );
  // A session naming a site the card lacks is at an unknown site
  assert(!found(index, { maxDriveMinutes: 60 }).includes('unmatched-site'));
  const unknownSite = hitOf(
    index,
    { maxDriveMinutes: 60, includeUnknown: ['location'] },
    'unmatched-site'
  );
  assert.deepEqual(unknownSite.matches[0].unknown, ['location']);
  // A town estimate: the town's centroid, flagged
  const near = hitOf(index, { near: { place: 'brevard', maxMiles: 2 } }, 'brevard-estimate')
    .matches[0];
  assert.equal(near.distance?.estimated, true);
  assert(near.distance!.miles < 2);
  assert.equal(near.driveFromTown, true);
  // Whole minutes, as the directory reads them
  assert.deepEqual(
    found(index, { maxDriveMinutes: 30 }).filter((slug) => slug.startsWith('drive')),
    ['drive-30-4']
  );
  // Towns: case, spacing and ", NC" don't matter; other states keep theirs; unknown names error
  assert.deepEqual(found(index, { towns: ['cleveland,  SC'] }), ['cleveland']);
  assert(found(index, { towns: ['Asheville, NC'] }).includes('drive-30-4'));
  assert.throws(() => search(index, { towns: ['Nowhereville'] }), /Towns with camps: .*Asheville/);
  assert.deepEqual(index.towns, ['Asheville', 'Brevard', 'Cleveland, SC']);
  // Places: aliases, states, neighborhoods
  assert.equal(findPlace('downtown')?.name, 'Downtown Asheville');
  assert.equal(findPlace('ASHEVILLE, NC')?.name, 'Downtown Asheville');
  assert.equal(findPlace('Greenville, SC')?.name, 'Greenville, SC');
  assert.equal(findPlace('Brevard, NC')?.name, 'Brevard');
  assert.equal(findPlace('west asheville')?.lat, 35.581);
  assert(PLACES.length > 50 && !PLACES.some((place) => place.name === 'Asheville'));
  assert.throws(
    () => parseCampSearchFilters({ near: { place: 'My house', maxMiles: 5 } }),
    /Known places/
  );
  assert.equal(
    parseCampSearchFilters({ near: { place: 'Oakley', maxMiles: null } }).near?.maxMiles,
    5
  );
  assert.throws(() => parseCampSearchFilters({ maxDriveMinutes: 200 }), /1 to 180/);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function registrationTests() {
  const index = buildCampIndex([
    camp('members-first', {
      registration: [
        opening('2027-01-05', { audience: 'member', text: 'Members register January 5' }),
        opening('2027-02-01'),
      ],
    }),
    camp('expected', { registration: [opening('2027-01-10', { certainty: 'expected' })] }),
    camp('month-only', { registration: [opening('2027-01-01', { precision: 'month' })] }),
    camp('december-for-2027', { registration: [opening('2026-12-01')] }),
    camp('opened', { registration: [opening('2026-09-01')] }),
    camp('old-availability', {
      season: {
        year: 2026,
        status: 'not_posted',
        start: '2026-06-08',
        end: '2026-08-14',
        text: null,
      },
      availability: { status: 'full', scope: null, text: 'All 2026 sessions are full' },
    }),
    camp('scoped-full', {
      availability: { status: 'full', scope: 'Session A', text: 'Session A is full' },
    }),
    camp('returning-soon', {
      registration: [opening('2026-11-05', { audience: 'returning' }), opening('2027-01-10')],
    }),
  ]);
  const before = (to: string, audience = 'public', from: string | null = null) => ({
    registrationOpens: { from, to, audience },
  });

  // The public window ignores a members' date; "any" takes it, named
  assert(!found(index, before('2027-01-14')).includes('members-first'));
  const member = hitOf(index, before('2027-01-14', 'any'), 'members-first');
  assert(has(member.caveats, /member registration/));
  // Expected and month-only dates match, flagged; a month is never its 1st
  assert(has(hitOf(index, before('2027-01-14'), 'expected').caveats, /expected/));
  assert(has(hitOf(index, before('2027-01-14'), 'month-only').caveats, /only as a month/));
  assert(!found(index, before('2026-12-31')).includes('month-only'));
  // milestone.year is the summer; the date itself can be in the year before
  assert(found(index, before('2026-12-31', 'public', '2026-11-01')).includes('december-for-2027'));
  // "Open" includes openings already passed, which prove nothing about spots
  const opened = hitOf(index, { registration: 'open' }, 'opened');
  assert.equal(opened.registration.status, 'opened');
  assert(has(opened.caveats, /not proof spots remain/));
  // A 2026 card's availability says nothing about 2027
  assert(!found(index, { registration: 'full' }).includes('old-availability'));
  assert(has(hitOf(index, {}, 'old-availability').caveats, /Availability info is from 2026/));
  // Availability scoped to one session is not the whole camp's
  assert(!found(index, { registration: 'full' }).includes('scoped-full'));
  assert(has(hitOf(index, {}, 'scoped-full').caveats, /"Full" applies to Session A/));
  // The directory's "soon" counts a returning campers' date; the hit shows the public line
  const soon = hitOf(index, { registration: 'soon' }, 'returning-soon');
  assert.equal(soon.registration.status, 'later');
  assert.equal(soon.registration.text, 'Registration opens Jan 10, 2027');
  assert(has(soon.caveats, /members, returning campers/));
  assert.deepEqual(
    soon.openingDates.map((date) => [date.audience, date.date, date.unconfirmed]),
    [
      ['returning', '2026-11-05', false],
      ['public', '2027-01-10', false],
    ]
  );
  // Caveats and ranking read the date the where clauses matched, not another opening of the camp:
  // here the unconfirmed public date, not the members' announced one
  const correlated = buildCampIndex([
    camp('c-member-then-unconfirmed', {
      registration: [
        opening('2027-01-05', { audience: 'member' }),
        opening('2027-01-10', { confidence: 'medium' }),
      ],
    }),
    camp('d-public', { registration: [opening('2027-01-12')] }),
    camp('e-expected', { registration: [opening('2027-01-12', { certainty: 'expected' })] }),
  ]);
  const publicOnly = {
    registrationOpens: { from: null, to: '2027-01-31', audience: 'any' },
    where: [{ path: 'registration[].audience', op: 'eq', value: 'public' }],
  };
  const unconfirmed = hitOf(correlated, publicOnly, 'c-member-then-unconfirmed');
  assert(has(unconfirmed.caveats, /unconfirmed/) && !has(unconfirmed.caveats, /member/));
  assert.deepEqual(
    search(correlated, publicOnly).camps.map((hit) => hit.slug),
    ['d-public', 'c-member-then-unconfirmed', 'e-expected']
  );
  // ... with no window too
  const expectedOnly = hitOf(
    correlated,
    { where: [{ path: 'registration[].certainty', op: 'eq', value: 'expected' }] },
    'e-expected'
  );
  assert(has(expectedOnly.caveats, /^Opening date is expected/));
  assert.throws(
    () => parseCampSearchFilters({ registrationOpens: { from: null, to: null } }),
    /from or a to/
  );
  assert.equal(
    parseCampSearchFilters({ registrationOpens: { from: null, to: '2027-01-14' } })
      .registrationOpens?.audience,
    'public'
  );
}

// ---------------------------------------------------------------------------
// Generic where
// ---------------------------------------------------------------------------

/** Every public leaf and container the plan registers (§4.2). */
const EXPECTED_FIELDS: Record<string, string> = {
  ...Object.fromEntries(
    [
      'name',
      'provider',
      'description',
      'camp_page_url',
      'registration_url',
      'season.text',
      'hours.text',
      'extended_care.cost_text',
      'prices[].label',
      'sites[].name',
      'sites[].address',
      'sites[].town',
      'sites[].state',
      'sessions[].label',
      'sessions[].site',
      'sessions[].price.label',
      'registration[].text',
      'registration[].url',
      'last_year_registration_opened.text',
      'last_year_registration_opened.url',
      'availability.scope',
      'availability.text',
      'financial_aid.text',
      'special_needs.text',
      'lunch.text',
      'transportation.text',
    ].map((path) => [path, 'text'])
  ),
  ...Object.fromEntries(
    [
      'season.year',
      'ages.min',
      'ages.max',
      'grades.min',
      'grades.max',
      'prices[].amount',
      'prices[].year',
      'sites[].driveMinutes',
      'sessions[].year',
      'sessions[].ages.min',
      'sessions[].ages.max',
      'sessions[].grades.min',
      'sessions[].grades.max',
      'sessions[].price.amount',
      'sessions[].price.year',
      'registration[].year',
    ].map((path) => [path, 'number'])
  ),
  ...Object.fromEntries(
    [
      'season.start',
      'season.end',
      'sessions[].start',
      'sessions[].end',
      'registration[].date',
      'last_year_registration_opened.date',
    ].map((path) => [path, 'date'])
  ),
  ...Object.fromEntries(
    [
      'hours.start',
      'hours.end',
      'extended_care.early_dropoff_start',
      'extended_care.late_pickup_end',
      'sessions[].hours.start',
      'sessions[].hours.end',
      'registration[].time',
      'last_year_registration_opened.time',
    ].map((path) => [path, 'time'])
  ),
  ...Object.fromEntries(
    [
      'type',
      'categories[]',
      'season.status',
      'grades.basis',
      'prices[].unit',
      'sessions[].grades.basis',
      'sessions[].status',
      'sessions[].price.unit',
      'registration[].audience',
      'registration[].kind',
      'registration[].precision',
      'registration[].certainty',
      'availability.status',
      'financial_aid.value',
      'special_needs.value',
      'lunch.value',
      'transportation.value',
    ].map((path) => [path, 'enum'])
  ),
  'registration[].unconfirmed': 'boolean',
  'sites[].driveFromTown': 'boolean',
  ...Object.fromEntries(
    [
      'season',
      'ages',
      'grades',
      'hours',
      'extended_care',
      'categories',
      'prices',
      'prices[]',
      'sites',
      'sites[]',
      'sessions',
      'sessions[]',
      'sessions[].ages',
      'sessions[].grades',
      'sessions[].hours',
      'sessions[].price',
      'registration',
      'registration[]',
      'last_year_registration_opened',
      'availability',
      'financial_aid',
      'special_needs',
      'lunch',
      'transportation',
    ].map((path) => [path, 'container'])
  ),
};

function whereTests() {
  // The registry is exactly the plan's list
  assert.deepEqual(
    Object.fromEntries(Object.entries(CARD_FIELDS).map(([path, field]) => [path, field.kind])),
    EXPECTED_FIELDS
  );
  for (const old of [
    'season.summer',
    'extendedCare',
    'prices[].per',
    'confidence',
    'review_notes',
    'sources',
  ]) {
    assert(!WHERE_PATHS.includes(old), old);
  }
  const clause = (path: string, op: string, value: string | null = null) => ({ path, op, value });
  const parse = (...where: object[]) => parseCampSearchFilters({ where });
  assert.throws(() => parse(clause('season.summer', 'exists')), /Unknown where path/);
  assert.throws(() => parse(clause('prices[].amount', 'contains', '3')), /allows op/);
  assert.throws(() => parse(clause('prices[].amount', 'lte', 'cheap')), /number/);
  assert.throws(() => parse(clause('season.start', 'gte', '2027-02-30')), /real YYYY-MM-DD/);
  assert.throws(() => parse(clause('hours.start', 'lte', '9am')), /HH:MM/);
  assert.throws(() => parse(clause('type', 'eq', 'sleepaway')), /one of day/);
  assert.throws(() => parse(clause('lunch', 'exists', 'yes')), /value null/);
  assert.throws(() => parse(clause('registration[].unconfirmed', 'eq', 'yes')), /true/);
  assert.equal(parse(clause('prices[].amount', 'lte', '300.50')).where?.[0].value, '300.5');
  // Object's own names are unknown paths, and a number has to be finite
  for (const path of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.throws(() => parse(clause(path, 'exists')), /Unknown where path/, path);
  }
  assert.throws(() => parse(clause('prices[].amount', 'lte', '9'.repeat(400))), /number/);

  const index = buildCampIndex([
    camp('no-prices'),
    camp('member-and-public', {
      prices: [tier(300, 'week', 'member'), tier(350, 'week', 'public')],
    }),
    camp('week-500-day-50', { prices: [tier(500, 'week'), tier(50, 'day')] }),
    camp('week-250', { prices: [tier(250, 'week', 'Standard')] }),
    camp('member-early', {
      registration: [opening('2027-01-05', { audience: 'member' }), opening('2027-03-01')],
    }),
    camp('month-jan', { registration: [opening('2027-01-01', { precision: 'month' })] }),
    camp('coding-june-art-july', {
      sessions: [session(JUNE, { label: 'Coding' }), session(JULY, { label: 'Art' })],
    }),
    camp('two-towns', {
      sites: [
        { name: 'City', driveMinutes: 10 },
        { name: 'Country', town: 'Brevard', driveMinutes: 50 },
      ],
    }),
    camp('lunch-yes', {
      lunch: { value: 'yes', text: 'Lunch provided' },
      extended_care: { early_dropoff_start: null, late_pickup_end: null, cost_text: '' },
    }),
    camp('free-tier', { prices: [tier(0, 'week', 'Free')] }),
    camp('no-sites-no-categories', { sites: [], categories: [] }),
    camp('arts-and-music', { categories: ['arts', 'music'] }),
  ]);
  const where = (...clauses: object[]) => found(index, { where: clauses });

  // missing on an empty array holds; beside a positive clause it still needs one item
  assert(where(clause('sessions[].price', 'missing')).includes('no-prices'));
  assert(where(clause('registration[].date', 'missing')).includes('no-prices'));
  assert(where(clause('prices[].label', 'missing')).includes('no-prices'));
  assert(where(clause('sites[].address', 'missing')).includes('no-sites-no-categories'));
  const noCategory = where(clause('categories[]', 'missing'));
  assert(noCategory.includes('no-sites-no-categories') && !noCategory.includes('no-prices'));
  const codingNoPrice = where(
    clause('sessions[].label', 'contains', 'coding'),
    clause('sessions[].price', 'missing')
  );
  assert.deepEqual(codingNoPrice, ['coding-june-art-july']);
  // Each categories[] clause matches any category, so both can be required
  assert.deepEqual(
    where(clause('categories[]', 'eq', 'arts'), clause('categories[]', 'eq', 'music')),
    ['arts-and-music']
  );

  // A missing array never passes a comparison, even a negative one
  assert(!where(clause('prices[].label', 'not_contains', 'member')).includes('no-prices'));
  // ne / not_contains: a match anywhere excludes the camp
  assert(!where(clause('prices[].label', 'ne', 'member')).includes('member-and-public'));
  assert(where(clause('prices[].label', 'ne', 'member')).includes('week-250'));
  // Positives on one array hold on one item: no $500 week plus $50 day
  assert(
    !where(clause('prices[].unit', 'eq', 'week'), clause('prices[].amount', 'lte', '300')).includes(
      'week-500-day-50'
    )
  );
  assert(
    where(clause('prices[].unit', 'eq', 'week'), clause('prices[].amount', 'lte', '300')).includes(
      'week-250'
    )
  );
  // ... and with the budget, on the tier the budget matched
  assert(
    !found(index, {
      price: { min: null, max: 300, per: 'week' },
      where: [clause('prices[].unit', 'eq', 'week')],
    }).includes('week-500-day-50')
  );
  // One registration date: the member date and the public audience don't combine
  assert(
    !where(
      clause('registration[].audience', 'eq', 'public'),
      clause('registration[].date', 'lte', '2027-01-31')
    ).includes('member-early')
  );
  assert(
    !found(index, {
      registrationOpens: { from: null, to: '2027-01-31', audience: 'any' },
      where: [clause('registration[].audience', 'eq', 'public')],
    }).includes('member-early')
  );
  // A month-only date is no day
  assert(!where(clause('registration[].date', 'eq', '2027-01-01')).includes('month-jan'));
  // Sessions and sites: one item, the same one the typed filters matched
  assert(
    !where(
      clause('sessions[].label', 'contains', 'coding'),
      clause('sessions[].start', 'gte', '2027-07-01')
    ).includes('coding-june-art-july')
  );
  assert(
    !found(index, {
      dates: { ...JULY, match: 'overlaps' },
      where: [clause('sessions[].label', 'contains', 'coding')],
    }).includes('coding-june-art-july')
  );
  assert(
    !where(
      clause('sites[].town', 'eq', 'brevard'),
      clause('sites[].driveMinutes', 'lte', '20')
    ).includes('two-towns')
  );
  assert(
    !found(index, {
      maxDriveMinutes: 20,
      where: [clause('sites[].town', 'eq', 'Brevard')],
    }).includes('two-towns')
  );
  // exists / missing: empty text is missing, 0 is present
  assert(
    where(clause('lunch.value', 'eq', 'yes'), clause('extended_care', 'missing')).includes(
      'lunch-yes'
    )
  );
  assert(where(clause('prices[].amount', 'eq', '0')).includes('free-tier'));
  assert(where(clause('prices', 'missing')).includes('no-prices'));
  assert(!where(clause('prices[]', 'exists')).includes('no-prices'));
  assert(where(clause('provider', 'eq', 'test provider')).length === 12);
}

// ---------------------------------------------------------------------------
// Unknown counts, order, paging, details, privacy
// ---------------------------------------------------------------------------

function resultTests() {
  const listings = Array.from({ length: 25 }, (_, n) =>
    camp(`camp-${String(n).padStart(2, '0')}`, { sessions: [session(JUNE)], prices: [tier(200)] })
  );
  listings.push(
    camp('no-dates-no-price', {
      season: { year: 2027, status: 'posted', start: null, end: null, text: null },
    }),
    camp('stated-fail', { sessions: [session(JULY)], prices: [tier(900)] })
  );
  const index = buildCampIndex(listings);
  const strict = {
    dates: { ...JUNE, match: 'overlaps' },
    price: { min: null, max: 300, per: 'week' },
  };

  // Left out only by unknowns: each unknown counted, overlapping; stated failures never rescued
  const result = search(index, strict);
  assert.equal(result.totalMatches, 25);
  assert.deepEqual(result.unknownCounts, { dates: 1, price: 1 });
  assert(
    !found(index, { ...strict, includeUnknown: ['dates', 'hours', 'price', 'location'] }).includes(
      'stated-fail'
    )
  );
  assert(!found(index, { ...strict, includeUnknown: ['dates'] }).includes('no-dates-no-price'));

  // Paging and a stable order
  assert.equal(result.camps.length, 20);
  assert(result.camps.every((hit) => hit.matches.length === 1));
  assert(result.hasMore);
  const second = search(index, { ...strict, page: 2 });
  assert.equal(second.camps.length, 5);
  assert(!second.hasMore);
  const past = search(index, { ...strict, page: 3 });
  assert.deepEqual([past.camps.length, past.hasMore, past.totalMatches], [0, false, 25]);
  assert(has(past.notes, /past the end/));
  assert.deepEqual(
    search(index, strict).camps.map((hit) => hit.slug),
    result.camps.map((hit) => hit.slug)
  );
  assert.throws(() => parseCampSearchFilters({ page: 0 }), /1 to 200/);
  // Fewer uncertainties first: a projected schedule ranks after a posted one
  const ranked = buildCampIndex([
    camp('b-2026', {
      season: {
        year: 2026,
        status: 'not_posted',
        start: '2026-06-15',
        end: '2026-06-19',
        text: null,
      },
      sessions: [session({ start: '2026-06-15', end: '2026-06-19' })],
    }),
    camp('a-may-fit', { sessions: [session(JUNE)] }),
    camp('c-posted', { sessions: [session(JUNE)], ages: { min: 5, max: 10 } }),
  ]);
  assert.deepEqual(
    search(ranked, {
      kids: [{ age: 7, grade: null }],
      dates: { ...JUNE, match: 'overlaps' },
    }).camps.map((hit) => hit.slug),
    ['c-posted', 'a-may-fit', 'b-2026']
  );

  // The all-null object is an unfiltered search
  const nulls = Object.fromEntries(
    Object.keys(parseCampSearchFilters({})).map((key) => [key, null])
  );
  assert.deepEqual(parseCampSearchFilters(nulls), parseCampSearchFilters({}));
  assert.equal(search(index, nulls).totalMatches, 27);
  assert.throws(() => parseCampSearchFilters(null), /object/);
  assert.throws(() => parseCampSearchFilters({ sort: 'price' }), /Unknown search_camps field sort/);
  assert.deepEqual(parseCampSearchFilters({ towns: [], types: [] }).towns, null);

  // Details: a slug, its path or an AVL GO link to exactly it; nothing else
  const slug = 'camp-03';
  const details = campDetails(
    index,
    [
      slug,
      `/camps/${slug}`,
      `https://www.avlgo.com/camps/${slug}`,
      'https://avlgo.com/camps/camp-04',
      'https://evil.example/camps/camp-05',
      'https://www.avlgo.com/camps/camp-05/extra',
      'Not A Slug',
      'no-such-camp',
    ],
    NOW
  );
  assert.deepEqual(
    details.camps.map((detail) => detail.card.name),
    ['camp 03', 'camp 04']
  );
  assert.equal(details.notFound.length, 4);
  assert.equal(details.camps[0].hit.url, '/camps/camp-03');
  assert.equal(details.camps[0].card.provider, 'Test Provider');

  // Nothing private, however deep
  const sent = JSON.stringify([search(index, {}), details]);
  for (const key of [
    'confidence',
    'review_notes',
    'sources',
    'lat',
    'lng',
    'campKey',
    'providerKey',
    'override',
    'views',
  ]) {
    assert(!sent.includes(`"${key}"`), `${key} leaked`);
  }
  assert(!/PRIVATE NOTE|private\.example/.test(sent));
}

// ---------------------------------------------------------------------------
// Tool schemas, the session and the memo
// ---------------------------------------------------------------------------

function strictSchema(schema: unknown, path: string) {
  if (Array.isArray(schema))
    return schema.forEach((item, i) => strictSchema(item, `${path}[${i}]`));
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;
  if (node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'))) {
    assert.equal(node.additionalProperties, false, `${path} allows extra properties`);
    assert.deepEqual(
      node.required,
      Object.keys(node.properties as object),
      `${path} optional fields`
    );
  }
  for (const [key, value] of Object.entries(node)) strictSchema(value, `${path}.${key}`);
}

async function toolTests() {
  assert.deepEqual(
    CAMP_CHAT_TOOLS.map((tool) => (tool.type === 'function' ? tool.function.name : '')),
    ['search_camps', 'get_camp_details']
  );
  for (const tool of CAMP_CHAT_TOOLS) {
    assert(tool.type === 'function' && tool.function.strict === true);
    strictSchema(tool.function.parameters, tool.function.name);
  }
  const searchTool = CAMP_CHAT_TOOLS[0];
  assert(searchTool.type === 'function');
  // The model is told categories[] clauses don't correlate like the other arrays
  assert(/categories\[\] clause is checked on its own/.test(JSON.stringify(searchTool)));
  assert.deepEqual(
    Object.keys(searchTool.function.parameters?.properties as object).sort(),
    Object.keys(parseCampSearchFilters({})).sort()
  );

  const index = buildCampIndex([
    camp('art-camp', { description: 'Painting and art.' }),
    camp('pottery-camp', { description: 'Pottery and art.' }),
  ]);
  let loads = 0;
  const load = () => {
    loads++;
    return Promise.resolve(index);
  };
  const session = createCampToolSession({ now: NOW, load });
  await assert.rejects(session.execute('search_camps', { page: 0 }), /page/);
  await assert.rejects(
    session.execute('search_camps', { towns: ['Atlantis'] }),
    /Towns with camps/
  );
  await session.execute('search_camps', { keywords: ['pottery'] });
  await session.execute('search_camps', { keywords: ['art'] });
  await session.execute('get_camp_details', { slugs: ['art-camp', 'nope'] });
  await assert.rejects(session.execute('get_camp_details', { slugs: [] }), /1-3/);
  await assert.rejects(session.execute('find_camps', {}), /Unknown tool/);
  assert.equal(loads, 1, 'One lazy load per session');
  const evidence = session.snapshot();
  assert.deepEqual(
    evidence.lastSearch?.keywords,
    ['pottery'],
    'The first search is the requested one'
  );
  assert.deepEqual(
    evidence.searches.map((one) => [one.filters.keywords, one.totalMatches]),
    [
      [['pottery'], 1],
      [['art'], 2],
    ]
  );
  assert.deepEqual(
    evidence.camps.map((hit) => hit.slug),
    ['pottery-camp', 'art-camp']
  );

  // Details alone keep the previous search; finding nothing is no evidence
  const previous = parseCampSearchFilters({ keywords: ['art'] });
  const detailsOnly = createCampToolSession({ now: NOW, previousSearch: previous, load });
  await detailsOnly.execute('get_camp_details', { slugs: ['nope'] });
  assert.deepEqual(detailsOnly.snapshot(), { lastSearch: previous, searches: [], camps: [] });
  await detailsOnly.execute('get_camp_details', { slugs: ['/camps/art-camp'] });
  assert.deepEqual(
    detailsOnly.snapshot().camps.map((hit) => hit.slug),
    ['art-camp']
  );
  assert.equal(detailsOnly.snapshot().lastSearch, previous);

  // A failed load is retried on the next call
  let attempts = 0;
  const flaky = createCampToolSession({
    now: NOW,
    load: () => (++attempts === 1 ? Promise.reject(new Error('db down')) : Promise.resolve(index)),
  });
  await assert.rejects(flaky.execute('search_camps', {}), /db down/);
  assert.equal(flaky.snapshot().searches.length, 0);
  await flaky.execute('search_camps', {});
  assert.equal(flaky.snapshot().searches.length, 1);
}

async function memoTests() {
  let clock = 0;
  const calls: Array<{ resolve: (value: CampListing[]) => void; reject: (error: Error) => void }> =
    [];
  const loader = createCampIndexLoader(
    () => new Promise((resolve, reject) => calls.push({ resolve, reject })),
    () => clock
  );
  const day1 = new Date('2026-10-30T03:59:00Z'); // Oct 29, 11:59 PM Eastern
  const day2 = new Date('2026-10-30T04:01:00Z'); // Oct 30, 12:01 AM Eastern
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // Same-day callers share one load
  const first = loader(day1);
  const second = loader(day1);
  assert.equal(calls.length, 1);
  calls[0].resolve([camp('memo-a')]);
  assert.equal(await first, await second);
  // Kept for 10 minutes, then reloaded (never served stale)
  clock = 9 * 60_000;
  assert.equal(await loader(day1), await first);
  assert.equal(calls.length, 1);
  clock = 10 * 60_000 + 1;
  const reload = loader(day1);
  assert.equal(calls.length, 2);
  // A failed load is forgotten
  calls[1].reject(new Error('db down'));
  await assert.rejects(reload, /db down/);
  const retry = loader(day1);
  assert.equal(calls.length, 3);
  calls[2].resolve([camp('memo-b')]);
  assert.deepEqual(
    (await retry).camps.map((one) => one.listing.slug),
    ['memo-b']
  );
  // Eastern midnight starts a new day; an older day's late load can't replace it
  const older = loader(new Date('2026-10-28T12:00:00Z'));
  const newer = loader(day2);
  assert.equal(calls.length, 5);
  calls[4].resolve([camp('memo-new')]);
  await newer;
  calls[3].resolve([camp('memo-old')]);
  await older;
  await settle();
  assert.deepEqual(
    (await loader(day2)).camps.map((one) => one.listing.slug),
    ['memo-new']
  );
  assert.equal(calls.length, 5);
}

// ---------------------------------------------------------------------------
// Live: read-only checks against the real camps (--live)
// ---------------------------------------------------------------------------

/** The directory's row match for one probe (components/camps/CampDirectory.tsx rowWays/isListed). */
function directoryListed(
  data: CampCardData,
  probe: {
    kid?: { age: number | null; grade: number | null };
    week?: { start: string; end: string };
    band?: (week: number) => boolean;
    drive?: number;
    hours?: 'workday' | 'full' | 'half';
  }
): boolean {
  return data.rows.some((row) => {
    if (probe.kid && kidFit(row, probe.kid) === 'no') return false;
    const tests: Array<boolean | null> = [];
    if (probe.week) {
      tests.push(
        !row.start || !row.end
          ? null
          : inTargetSeason(row.start) <= probe.week.end &&
              inTargetSeason(row.end) >= probe.week.start
      );
    }
    if (probe.band) tests.push(row.weekly.length === 0 ? null : row.weekly.some(probe.band));
    if (probe.hours) {
      tests.push(
        probe.hours === 'workday'
          ? row.workday
          : row.length === null
            ? null
            : row.length === probe.hours
      );
    }
    const sites =
      probe.drive !== undefined && row.sites.length > 0
        ? row.sites.map((i) => data.sites[i])
        : [null];
    return sites.some((site) => {
      const atSite = [...tests];
      if (probe.drive !== undefined) {
        atSite.push(!site || site.drive === null ? null : site.drive <= probe.drive);
      }
      return atSite.every((test) => test === true);
    });
  });
}

async function liveTests() {
  const { queryCamps } = await import('../lib/db/queries/camps');
  let started = performance.now();
  const listings = await queryCamps();
  const queryMs = Math.round(performance.now() - started);
  started = performance.now();
  const index = buildCampIndex(listings);
  const buildMs = Math.round(performance.now() - started);
  const now = new Date();
  console.log(
    `live: ${listings.length} camps, queryCamps ${queryMs}ms, index ${buildMs}ms, ${index.towns.length} towns`
  );

  // The index is exactly queryCamps' camps
  assert.deepEqual(
    index.camps.map((one) => one.listing.slug),
    listings.map((one) => one.slug)
  );
  const all = searchCamps(index, parseCampSearchFilters({}), now);
  assert.equal(all.totalMatches, listings.length);

  // Round trips: name, town, a generic clause, details
  const every = (args: Record<string, unknown>) => {
    const filters = parseCampSearchFilters(args, index.towns);
    const pages = Math.ceil(searchCamps(index, filters, now).totalMatches / 20);
    return Array.from({ length: pages }, (_, page) =>
      searchCamps(index, { ...filters, page: page + 1 }, now).camps.map((hit) => hit.slug)
    ).flat();
  };
  for (const listing of listings.filter((_, n) => n % 50 === 0)) {
    const { name } = listing.card;
    assert(
      every({ where: [{ path: 'name', op: 'eq', value: name }] }).includes(listing.slug),
      name
    );
    if (name.length <= 80) assert(every({ keywords: [name] }).includes(listing.slug), name);
    const detail = campDetails(index, [`https://www.avlgo.com/camps/${listing.slug}`], now);
    assert.equal(detail.camps[0]?.card.name, listing.card.name);
  }
  for (const town of index.towns) {
    const result = searchCamps(index, parseCampSearchFilters({ towns: [town] }, index.towns), now);
    assert(result.totalMatches > 0, town);
    for (const hit of result.camps) {
      const card = index.camps.find((one) => one.listing.slug === hit.slug)!.card;
      assert(
        card.sites.some(
          (site) =>
            (site.state && site.state !== 'NC' ? `${site.town}, ${site.state}` : site.town) === town
        )
      );
    }
  }

  // Directory parity on full rows: the same camps for the same row filters
  const cards = new Map(listings.map((listing) => [listing.slug, toCardData(listing, now)]));
  const dayCamps = new Set(
    listings.filter((one) => one.card.type !== 'overnight').map((one) => one.slug)
  );
  const probes: Array<{
    name: string;
    args: Record<string, unknown>;
    probe: Parameters<typeof directoryListed>[1];
    dayOnly?: boolean;
  }> = [
    {
      name: 'age 7',
      args: { kids: [{ age: 7, grade: null }] },
      probe: { kid: { age: 7, grade: null } },
    },
    {
      name: 'rising 3rd',
      args: { kids: [{ age: null, grade: 3 }] },
      probe: { kid: { age: null, grade: 3 } },
    },
    ...[SUMMER_WEEKS[2], SUMMER_WEEKS[7]].map((week) => ({
      name: `week ${week.start}`,
      args: { dates: { start: week.start, end: week.end, match: 'overlaps' } },
      probe: { week },
    })),
    {
      name: '$150-300/week',
      args: { price: { min: 150, max: 300, per: 'week' } },
      probe: { band: (week: number) => week >= 150 && week <= 300 },
    },
    {
      name: 'free',
      args: { price: { min: 0, max: 0, per: 'week' } },
      probe: { band: (week: number) => week === 0 },
    },
    { name: 'drive 30', args: { maxDriveMinutes: 30 }, probe: { drive: 30 } },
    {
      name: 'workday',
      args: { dropoffBy: '08:30', pickupAtOrAfter: '17:00' },
      probe: { hours: 'workday' },
      dayOnly: true,
    },
    { name: 'full day', args: { dayLength: 'full' }, probe: { hours: 'full' }, dayOnly: true },
    { name: 'half day', args: { dayLength: 'half' }, probe: { hours: 'half' }, dayOnly: true },
    {
      name: 'age 9, Jul 5 week, 45 min, $150-300',
      args: {
        kids: [{ age: 9, grade: null }],
        dates: { start: SUMMER_WEEKS[5].start, end: SUMMER_WEEKS[5].end, match: 'overlaps' },
        maxDriveMinutes: 45,
        price: { min: 150, max: 300, per: 'week' },
      },
      probe: {
        kid: { age: 9, grade: null },
        week: SUMMER_WEEKS[5],
        drive: 45,
        band: (week: number) => week >= 150 && week <= 300,
      },
    },
  ];
  for (const { name, args, probe, dayOnly } of probes) {
    const chat = new Set(every(args));
    const directory = [...cards.entries()]
      .filter(([slug, data]) => (!dayOnly || dayCamps.has(slug)) && directoryListed(data, probe))
      .map(([slug]) => slug);
    const chatSlugs = [...chat].filter((slug) => !dayOnly || dayCamps.has(slug));
    const missing = directory.filter((slug) => !chat.has(slug));
    const extra = chatSlugs.filter((slug) => !directory.includes(slug));
    assert.deepEqual([missing, extra], [[], []], `directory parity: ${name}`);
    console.log(`live parity ${name}: ${directory.length} camps`);
  }

  // Deliberate differences: covers is narrower than overlaps; hits carry the public line
  const week = { start: SUMMER_WEEKS[3].start, end: SUMMER_WEEKS[3].end };
  const overlaps = searchCamps(
    index,
    parseCampSearchFilters({ dates: { ...week, match: 'overlaps' } }),
    now
  );
  const covers = searchCamps(
    index,
    parseCampSearchFilters({ dates: { ...week, match: 'covers' } }),
    now
  );
  assert(covers.totalMatches <= overlaps.totalMatches);
  for (const hit of all.camps) {
    const listing = listings.find((one) => one.slug === hit.slug)!;
    assert.deepEqual(hit.registration, registrationLine(listing.card, listing.confirmed, now));
  }
  const soon = searchCamps(index, parseCampSearchFilters({ registration: 'soon' }), now);
  console.log(
    `live: covers ${covers.totalMatches} <= overlaps ${overlaps.totalMatches}; directory "soon" ${soon.totalMatches}, ${soon.camps.filter((hit) => hit.registration.status !== 'soon').length} on page 1 with another public status`
  );

  // Timing and privacy over real data
  for (const [name, args] of [
    ['unfiltered', {}],
    [
      'horse 8-5 week under $300 near West Asheville',
      {
        keywords: ['horse', 'equestrian', 'riding', 'pony'],
        keywordMatch: 'any',
        kids: [{ age: 7, grade: null }],
        dates: { start: '2027-06-14', end: '2027-06-18', match: 'covers' },
        dropoffBy: '08:00',
        pickupAtOrAfter: '17:00',
        price: { min: null, max: 299.99, per: 'week' },
        near: { place: 'West Asheville', maxMiles: 5 },
      },
    ],
    [
      'registration before Jan 15',
      { registrationOpens: { from: null, to: '2027-01-14', audience: 'public' } },
    ],
  ] as const) {
    started = performance.now();
    const result = searchCamps(index, parseCampSearchFilters(args, index.towns), now);
    console.log(
      `live search ${name}: ${result.totalMatches} matches in ${Math.round(performance.now() - started)}ms, ${JSON.stringify(result).length} bytes, unknown ${JSON.stringify(result.unknownCounts)}`
    );
  }
  const sent = JSON.stringify([
    all,
    campDetails(
      index,
      listings.slice(0, 3).map((one) => one.slug),
      now
    ),
  ]);
  for (const key of [
    'confidence',
    'review_notes',
    'sources',
    'lat',
    'lng',
    'campKey',
    'providerKey',
  ]) {
    assert(!sent.includes(`"${key}"`), `${key} leaked`);
  }
}

// ---------------------------------------------------------------------------

export async function runCampSearchTests({ live = false }: { live?: boolean } = {}): Promise<void> {
  keywordTests();
  eligibilityTests();
  dateTests();
  hoursTests();
  priceTests();
  locationTests();
  registrationTests();
  whereTests();
  resultTests();
  await toolTests();
  await memoTests();
  console.log('Camps search offline tests passed.');
  if (live) {
    await liveTests();
    console.log('Camps search live checks passed.');
  }
}

if (require.main === module) {
  runCampSearchTests({ live: process.argv.includes('--live') })
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
