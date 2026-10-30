/**
 * The camps chat's tools (docs/camps/06-ai-chat-plan.md §4-5): the strict schemas the model
 * calls, the warm-instance index memo, and one tool session per provider attempt, which records
 * what the attempt verified. Server-only: it reads the database through queryCamps().
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { CAMP_CATEGORIES, CAMP_TYPES } from '@/lib/camps/contract';
import { SUPPORT_LABELS } from '@/lib/camps/display';
import { queryCamps, type CampListing } from '@/lib/db/queries/camps';
import { getDateStringEastern } from '@/lib/utils/timezone';
import { isRecord, isStringArray } from '@/lib/utils/validation';
import { WHERE_OPS, WHERE_PATHS } from './fields';
import { buildCampIndex, campDetails, searchCamps, type CampIndex } from './search';
import type {
  CampDetailsResult,
  CampSearchFilters,
  CampSearchHit,
  CampSearchResult,
  CampSearchSummary,
  CampToolSession,
} from './types';
import { parseCampSearchFilters } from './validation';

// ---------------------------------------------------------------------------
// Schemas: strict, every property required, null for "no filter"
// ---------------------------------------------------------------------------

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });
const nullableEnum = (values: readonly string[], description: string) => ({
  type: ['string', 'null'],
  enum: [...values, null],
  description,
});
const nullableList = (items: object, description: string) => ({
  type: ['array', 'null'],
  items,
  description,
});
/** A strict object: every property required, nothing else allowed. */
const object = (properties: Record<string, object>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullableObject = (properties: Record<string, object>, description: string) => ({
  anyOf: [object(properties), { type: 'null' }],
  description,
});

const searchProperties = {
  keywords: nullableList(
    { type: 'string' },
    'Up to 10 short words or phrases (1-80 chars), matched at word starts across names, descriptions, session labels, price labels, sites, registration and support wording: "art" finds arts/artist, not start; "sibling discount" must appear together. Use short synonyms with keywordMatch any (horse, equestrian, riding, pony), never whole sentences. null: no keyword filter.'
  ),
  keywordMatch: nullableEnum(
    ['all', 'any'],
    'all (default) needs every keyword; any needs at least one.'
  ),
  excludeKeywords: nullableList(
    { type: 'string' },
    'Up to 10 words or phrases; a camp is dropped when any appears anywhere in its public text. null: none.'
  ),
  kids: nullableList(
    object({
      age: nullable('number', 'Years old during camp, 1-25; null when only a grade is known.'),
      grade: nullable(
        'integer',
        'Grade entering the fall after camp (rising): -1 pre-K, 0 K, 1-12, 13 graduate; null when only an age is known.'
      ),
    }),
    'Up to 6 children, each with an age or a grade. null: no eligibility filter.'
  ),
  kidsMode: nullableEnum(
    ['any', 'each', 'same_session'],
    'any (default): one child fits; each: every child has a fitting session; same_session: one session at one site takes every child.'
  ),
  dates: nullableObject(
    {
      start: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
      end: { type: 'string', description: 'YYYY-MM-DD, inclusive, on or after start.' },
      match: {
        type: ['string', 'null'],
        enum: ['overlaps', 'covers', null],
        description:
          'overlaps (default): a session overlaps the range; covers: one listed session spans all of it.',
      },
    },
    'When camp runs. For 2027 dates, a 2026 schedule is read as the same 2027 week (flagged). null: any dates.'
  ),
  dropoffBy: nullable(
    'string',
    'HH:MM 24h: drop-off at or before this time, early care counted. Excludes overnight camps. null: none.'
  ),
  pickupAtOrAfter: nullable(
    'string',
    'HH:MM 24h: pickup at or after this time, late care counted. Excludes overnight camps. null: none.'
  ),
  dayLength: nullableEnum(
    ['full', 'half'],
    'full: 5+ hours a day; half: under 5. Excludes overnight camps. null: either.'
  ),
  price: nullableObject(
    {
      min: nullable('number', 'Inclusive minimum in dollars, or null.'),
      max: nullable(
        'number',
        'Inclusive maximum in dollars (<= 100000), or null. Under $300 is 299.99.'
      ),
      per: {
        type: ['string', 'null'],
        enum: ['week', 'session', null],
        description:
          'week (default): weekly cost (a day rate x5, a session spread over its weeks); session: a stated per-session price.',
      },
    },
    'Bounds on one applicable price tier. Free is min 0, max 0. A missing price never counts as free. null: any price.'
  ),
  maxDriveMinutes: nullable(
    'integer',
    'Whole minutes of driving from downtown (Pack Square) without traffic, 1-180. null: any.'
  ),
  near: nullableObject(
    {
      place: { type: 'string', description: 'A known place: an Asheville neighborhood or a town.' },
      maxMiles: nullable('number', 'Straight-line miles, 0.5-60; null means 5.'),
    },
    'Within straight-line miles of a known place. Never an address. null: anywhere.'
  ),
  towns: nullableList(
    { type: 'string' },
    'Up to 10 town names, any of ("Brevard"; other states keep theirs: "Greenville, SC"). null: any town.'
  ),
  types: nullableList(
    { type: 'string', enum: [...CAMP_TYPES] },
    'Any of these camp types. null: all.'
  ),
  categories: nullableList(
    { type: 'string', enum: [...CAMP_CATEGORIES] },
    'Any of these categories. null: all. Prefer keywords for a specific activity.'
  ),
  needs: nullableList(
    { type: 'string', enum: Object.keys(SUPPORT_LABELS) },
    'Every one required: financial_aid, special_needs, lunch, transportation, extended_care (before/after care). Case-by-case counts; its wording is returned. null: none.'
  ),
  registration: nullableEnum(
    ['open', 'soon', 'not_announced', 'full'],
    "The directory's registration status: open (includes openings already passed), soon (any audience's opening within 14 days), not_announced, full (waitlist, full or closed). null: any."
  ),
  registrationOpens: nullableObject(
    {
      from: nullable('string', 'YYYY-MM-DD, inclusive, or null.'),
      to: nullable(
        'string',
        'YYYY-MM-DD, inclusive, or null. Before Jan 15, 2027 is to 2027-01-14.'
      ),
      audience: {
        type: ['string', 'null'],
        enum: ['public', 'any', null],
        description:
          'public (default): public or lottery openings; any: members, returning campers and others too.',
      },
    },
    'A 2027-summer registration opening dated in this window. A month-only date overlapping it is a possible match. null: none.'
  ),
  where: nullableList(
    object({
      path: { type: 'string', enum: WHERE_PATHS },
      op: { type: 'string', enum: [...WHERE_OPS] },
      value: nullable(
        'string',
        'null for exists/missing; otherwise text, a number ("300"), a date (YYYY-MM-DD), a time (HH:MM), an enum value or true/false.'
      ),
    }),
    "Up to 8 clauses on public card fields. Clauses on one array (sessions[], sites[], prices[], registration[]) must hold on the same item, which is also the session, site and price tier the other filters matched; an empty array passes only missing. Each categories[] clause is checked on its own against any of the camp's categories, so two eq clauses require both (arts and music). ne and not_contains drop the camp when the value appears anywhere. No OR: search again for alternatives. null: none."
  ),
  includeUnknown: nullableList(
    { type: 'string', enum: ['dates', 'hours', 'price', 'location'] },
    'Keep camps that do not state these facts (flagged). Never overrides a stated fact that fails. null: none.'
  ),
  page: nullable(
    'integer',
    '1-200, 20 camps a page; null is 1. Increase only for more of the same search.'
  ),
};

export const CAMP_CHAT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_camps',
      description:
        'Search every listed Asheville-area camp using complete filters; null means no filter. Eligibility, dates, hours, price, site predicates and session text must fit the same session/site. Returns stored-data candidates, exact candidate totals and uncertainty labels, 20 per page. Historical schedules are included. Projected weeks, conditional prices and opening milestones are not verified attendance, eligibility or availability.',
      strict: true,
      parameters: object(searchProperties),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_camp_details',
      description:
        'Read the full public card of up to 3 camps: every session, price tier, site, registration date with its wording, and support text. Use it for "tell me about the second one" and for questions about specific dates, sessions or qualifiers. Does not change the current search.',
      strict: true,
      parameters: object({
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description:
            '1-3 camp slugs, /camps/<slug> paths, or AVL GO camp links from results or the conversation.',
        },
      }),
    },
  },
];

// ---------------------------------------------------------------------------
// The index memo
// ---------------------------------------------------------------------------

const MEMO_MS = 10 * 60 * 1000;

/**
 * A loader that keeps the built index for 10 minutes after it loads, keyed by the Eastern date.
 * Same-day callers share one load in flight; a failed load is forgotten; a load for an older
 * date never replaces a newer date's index; expired data is reloaded, never served. Per warm
 * instance only: the camps cache tag doesn't clear it, so an admin edit can lag 10 minutes.
 */
export function createCampIndexLoader(
  load: () => Promise<CampListing[]> = () => queryCamps(),
  clock: () => number = Date.now
): (now?: Date) => Promise<CampIndex> {
  let memo: { day: string; index: CampIndex; expires: number } | null = null;
  let pending: { day: string; promise: Promise<CampIndex> } | null = null;
  return (now = new Date()) => {
    const day = getDateStringEastern(now);
    if (memo && memo.day === day && clock() < memo.expires) return Promise.resolve(memo.index);
    if (pending && pending.day === day) return pending.promise;
    const promise: Promise<CampIndex> = load()
      .then((listings) => {
        const index = buildCampIndex(listings);
        if (!memo || memo.day <= day) memo = { day, index, expires: clock() + MEMO_MS };
        return index;
      })
      .finally(() => {
        if (pending?.promise === promise) pending = null;
      });
    pending = { day, promise };
    return promise;
  };
}

export const loadCampIndex = createCampIndexLoader();

// ---------------------------------------------------------------------------
// One provider attempt's tools and evidence
// ---------------------------------------------------------------------------

const MAX_DETAILS = 3;

function parseSlugs(args: unknown): string[] {
  if (!isRecord(args) || Object.keys(args).some((key) => key !== 'slugs')) {
    throw new Error('get_camp_details takes { slugs: [...] } only.');
  }
  const slugs: unknown = args.slugs;
  if (
    !isStringArray(slugs) ||
    slugs.length < 1 ||
    slugs.length > MAX_DETAILS ||
    !slugs.every((slug) => slug.trim())
  ) {
    throw new Error(`slugs must list 1-${MAX_DETAILS} camp slugs or /camps/<slug> links.`);
  }
  return slugs;
}

/**
 * The tools for one provider attempt, over one lazily loaded index. The first successful search
 * is the requested one and becomes the next turn's lastSearch; later searches are alternatives.
 * Details alone keep the previous lastSearch. A failed call, or details that found nothing, is
 * not evidence. Calls run one at a time (the runner awaits each).
 */
export function createCampToolSession(options: {
  now: Date;
  previousSearch?: CampSearchFilters | null;
  load?: () => Promise<CampIndex>;
}): CampToolSession {
  const load = options.load ?? (() => loadCampIndex(options.now));
  let index: Promise<CampIndex> | null = null;
  const loaded = () => {
    index ??= load().catch((error: unknown) => {
      index = null;
      throw error;
    });
    return index;
  };
  const searches: CampSearchSummary[] = [];
  const camps = new Map<string, CampSearchHit>();
  const remember = (hits: CampSearchHit[]) => {
    for (const hit of hits) if (!camps.has(hit.slug)) camps.set(hit.slug, hit);
  };

  return {
    async execute(name: string, args: unknown): Promise<CampSearchResult | CampDetailsResult> {
      if (name === 'search_camps') {
        const campIndex = await loaded();
        const filters = parseCampSearchFilters(args, campIndex.towns);
        const result = searchCamps(campIndex, filters, options.now);
        searches.push({
          filters,
          totalMatches: result.totalMatches,
          page: result.page,
          hasMore: result.hasMore,
        });
        remember(result.camps);
        return result;
      }
      if (name === 'get_camp_details') {
        const slugs = parseSlugs(args);
        const result = campDetails(await loaded(), slugs, options.now);
        remember(result.camps.map((camp) => camp.hit));
        return result;
      }
      throw new Error(
        `Unknown tool ${JSON.stringify(name)}; use search_camps or get_camp_details.`
      );
    },
    snapshot() {
      return {
        lastSearch: searches[0]?.filters ?? options.previousSearch ?? null,
        searches: [...searches],
        camps: [...camps.values()],
      };
    },
  };
}
