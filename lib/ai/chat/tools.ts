import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events as eventTable } from '@/lib/db/schema';
import {
  queryFilteredEvents,
  getEventMetadata,
  type DbEvent,
  type EventMetadata,
  type EventQueryResult,
} from '@/lib/db/queries/events';
import { generateEventUrl } from '@/lib/utils/slugify';
import { getDateStringEastern } from '@/lib/utils/timezone';
import { isRecord } from '@/lib/utils/validation';
import { isCalendarDate, parseChatFilters, type ChatFilters, type ChatSearchState } from './types';

const nullableString = (description: string) => ({ type: ['string', 'null'], description });
const nullableStrings = (description: string) => ({
  type: ['array', 'null'],
  items: { type: 'string' },
  description,
});

const searchProperties = {
  search: nullableString(
    'Literal phrase across title, description, summary, tags, host and location. null inherits; empty string clears. Prefer keywords for multiple concepts.'
  ),
  keywords: nullableStrings(
    'Literal phrases across searchable fields. Use short terms (e.g. jazz), not the whole user sentence. null inherits; [] clears.'
  ),
  keywordMatch: {
    type: ['string', 'null'],
    enum: ['all', 'any', null],
    description:
      'all requires every keyword; any matches alternatives or synonyms. null inherits (default all).',
  },
  excludeKeywords: nullableStrings(
    'Reject events containing any of these literal phrases in searchable fields. null inherits; [] clears.'
  ),
  dateStart: nullableString(
    'Inclusive YYYY-MM-DD in America/New_York. null inherits. Set BOTH dateStart/dateEnd to empty strings to search all upcoming dates.'
  ),
  dateEnd: nullableString(
    'Inclusive YYYY-MM-DD in America/New_York. null inherits. Empty string clears the upper date limit. No maximum search horizon.'
  ),
  days: {
    type: ['array', 'null'],
    items: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] },
    description:
      'Weekdays: 0 Sun through 6 Sat. Works inside a date range. null inherits; [] clears.',
  },
  times: {
    type: ['array', 'null'],
    items: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
    description:
      'Eastern start-time buckets: morning 05-11, afternoon 12-16, evening 17-23 or 00-02. null inherits; [] clears. Unknown times excluded.',
  },
  minStartTime: nullableString(
    'Inclusive earliest Eastern start time HH:MM, e.g. 19:00 for after 7pm. null inherits; empty string clears.'
  ),
  maxStartTime: nullableString(
    'Inclusive latest Eastern start time HH:MM. For a window crossing midnight, use separate searches. null inherits; empty string clears.'
  ),
  priceFilter: {
    type: ['string', 'null'],
    enum: ['any', 'free', 'under20', 'under100', 'custom', null],
    description:
      'Known-price admission filter. free requires a listed zero/free price; unknown prices do not qualify. null inherits; any clears budget.',
  },
  maxPrice: {
    type: ['number', 'null'],
    description:
      'Nonnegative dollar budget. Automatically selects custom price filtering (overrides broader price presets). Matches the lowest listed price; ranges may have higher tickets. null inherits.',
  },
  tagsInclude: nullableStrings(
    'Match at least one exact tag. Use get_search_filters to discover tags. For narrow genres or multi-concept requests use keywords too. null inherits; [] clears.'
  ),
  tagsExclude: nullableStrings('Reject any of these exact tags. null inherits; [] clears.'),
  locations: nullableStrings(
    'City names, e.g. Asheville, Black Mountain, Hendersonville. Asheville includes known Asheville venues/zips. Use venue for a venue name. null inherits; [] clears.'
  ),
  zips: nullableStrings('Exact five-digit ZIP codes. null inherits; [] clears.'),
  organizer: nullableString(
    'Literal host/organizer substring. null inherits; empty string clears.'
  ),
  venue: nullableString(
    'Literal venue/address substring in location, e.g. Orange Peel. null inherits; empty string clears.'
  ),
  showDailyEvents: {
    type: ['boolean', 'null'],
    description:
      'Include daily recurring listings such as exhibitions. null inherits (default false). Enable when relevant to request.',
  },
  nextPage: {
    type: 'boolean',
    description:
      'true ONLY for more results from the same search; all filter changes must be null. Uses server-provided saved cursor. false starts/refines search.',
  },
};

export const CHAT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_events',
      description:
        'Search the live event database with combined keyword, date, weekday, time, price, tag, city, ZIP, venue and organizer filters. Returns up to 50 chronological matches, exact applied filters and pagination state. There is no two-week restriction: default is all upcoming events. null fields retain the current search; empty strings/arrays clear filters. Explicit user changes override active feed filters. Use this before recommending events and again to refine or paginate.',
      strict: true,
      parameters: {
        type: 'object',
        properties: searchProperties,
        required: Object.keys(searchProperties),
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_search_filters',
      description:
        'Discover actual tags, cities and ZIP codes in upcoming live listings. Use when uncertain which exact tag or city is available. Does not search or change current search.',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_event_details',
      description:
        'Read the description and details of a specific live event. Use the id from search results, or the six-character ID at the end of an AVL GO event link from conversation history. Does not change current search.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description:
              'Full UUID from search_events or six-character hexadecimal ID from an AVL GO event URL.',
          },
        },
        required: ['eventId'],
        additionalProperties: false,
      },
    },
  },
];

type ChatEvent = Pick<
  DbEvent,
  | 'id'
  | 'title'
  | 'description'
  | 'aiSummary'
  | 'startDate'
  | 'timeUnknown'
  | 'location'
  | 'zip'
  | 'organizer'
  | 'price'
  | 'tags'
  | 'recurringType'
  | 'recurringEndDate'
>;

export function formatChatEvent(event: ChatEvent, details = false) {
  return {
    id: event.id,
    title: event.title,
    url: generateEventUrl(event.title, event.startDate, event.id),
    date: getDateStringEastern(event.startDate),
    time: event.timeUnknown
      ? null
      : event.startDate.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
        }),
    location: event.location,
    zip: event.zip,
    organizer: event.organizer,
    price: event.price,
    tags: event.tags,
    recurringType: event.recurringType,
    recurringEndDate: event.recurringEndDate ? getDateStringEastern(event.recurringEndDate) : null,
    summary: (event.aiSummary || event.description || '').slice(0, details ? 8000 : 700),
    ...(details ? { description: event.description?.slice(0, 12000) ?? null } : {}),
  };
}

/** Merge explicit changes while retaining constraints for conversational follow-ups. */
export function resolveSearchFilters(
  previous: ChatFilters,
  args: Record<string, unknown>
): ChatFilters {
  const filters = { ...previous };
  const changes = Object.fromEntries(
    Object.entries(args).filter(([key, value]) => key !== 'nextPage' && value !== null)
  );
  const parsedChanges = parseChatFilters(changes);
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in searchProperties)) throw new Error(`Unknown search filter: ${key}`);
    if ((key === 'dateStart' || key === 'dateEnd') && value === '') continue;
    if (
      !(key in parsedChanges) ||
      JSON.stringify(parsedChanges[key as keyof ChatFilters]) !== JSON.stringify(value)
    ) {
      throw new Error(`Invalid value for ${key}; use the format described in search_events.`);
    }
  }
  Object.assign(filters, parsedChanges);
  const excluded = (filters.excludeKeywords ?? [])
    .filter(Boolean)
    .map((keyword) => keyword.toLowerCase());
  const conflicts = (phrase: string) =>
    excluded.some((keyword) => phrase.toLowerCase().includes(keyword));
  const keywords = (filters.keywords ?? []).filter(Boolean);
  if (
    (filters.search && conflicts(filters.search)) ||
    (keywords.length > 0 &&
      (filters.keywordMatch === 'any' ? keywords.every(conflicts) : keywords.some(conflicts)))
  ) {
    throw new Error(
      'A required search phrase also contains an excluded keyword. Remove the contradictory positive search term while keeping the requested exclusions.'
    );
  }
  // Models sometimes pair a precise budget with a broader preset. The numeric
  // ceiling always wins; changing the preset alone clears an inherited ceiling.
  if (typeof args.maxPrice === 'number') filters.priceFilter = 'custom';
  else if (
    args.priceFilter !== null &&
    args.priceFilter !== undefined &&
    args.priceFilter !== 'custom'
  )
    delete filters.maxPrice;
  for (const key of ['search', 'organizer', 'venue', 'minStartTime', 'maxStartTime'] as const) {
    if (args[key] === '') delete filters[key];
  }
  if (
    (args.dateStart !== null && args.dateStart !== undefined) ||
    (args.dateEnd !== null && args.dateEnd !== undefined)
  ) {
    filters.dateFilter = 'custom';
    for (const key of ['dateStart', 'dateEnd'] as const) {
      if (args[key] === '') delete filters[key];
      else if (args[key] !== null && args[key] !== undefined && !isCalendarDate(args[key])) {
        throw new Error(`${key} must be a real YYYY-MM-DD date, null, or an empty string.`);
      }
    }
    if (!filters.dateStart && !filters.dateEnd) filters.dateFilter = 'all';
  }
  if (filters.dateStart && filters.dateEnd && filters.dateStart > filters.dateEnd) {
    throw new Error('dateStart must be on or before dateEnd.');
  }
  for (const key of ['minStartTime', 'maxStartTime'] as const) {
    if (filters[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(filters[key])) {
      throw new Error(`${key} must use HH:MM in Eastern time.`);
    }
  }
  if (filters.minStartTime && filters.maxStartTime && filters.minStartTime > filters.maxStartTime) {
    throw new Error('Time windows crossing midnight need separate searches.');
  }
  if (filters.priceFilter === 'custom' && filters.maxPrice === undefined) {
    throw new Error('A custom price filter requires maxPrice.');
  }
  if (
    args.maxPrice !== null &&
    args.maxPrice !== undefined &&
    (typeof args.maxPrice !== 'number' || !Number.isFinite(args.maxPrice) || args.maxPrice < 0)
  ) {
    throw new Error('maxPrice must be a nonnegative number.');
  }
  return { ...filters, strictPrice: true, includeUnknownTimes: false };
}

export interface ChatToolDependencies {
  query: typeof queryFilteredEvents;
  metadata: () => Promise<EventMetadata>;
  details: (id: string) => Promise<ChatEvent | null>;
}

async function fetchEventDetails(id: string): Promise<ChatEvent | null> {
  if (!/^[a-f\d]{6}$/i.test(id) && !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)) {
    throw new Error('Use an event UUID or six-character ID from an event link.');
  }
  const rows = await db
    .select({
      id: eventTable.id,
      title: eventTable.title,
      description: eventTable.description,
      aiSummary: eventTable.aiSummary,
      startDate: eventTable.startDate,
      timeUnknown: eventTable.timeUnknown,
      location: eventTable.location,
      zip: eventTable.zip,
      organizer: eventTable.organizer,
      price: eventTable.price,
      tags: eventTable.tags,
      recurringType: eventTable.recurringType,
      recurringEndDate: eventTable.recurringEndDate,
    })
    .from(eventTable)
    .where(
      and(
        id.length === 6
          ? sql`${eventTable.id}::text LIKE ${`${id.toLowerCase()}%`}`
          : eq(eventTable.id, id),
        sql`${eventTable.hidden} IS NOT TRUE`,
        isNull(eventTable.dedupedAt),
        isNull(eventTable.deadAt)
      )
    )
    .limit(2);
  if (rows.length > 1)
    throw new Error('That short ID is ambiguous; search by event title to get a full UUID.');
  return rows[0] ?? null;
}

export function createChatToolSession(
  initialFilters: ChatFilters,
  previousState?: ChatSearchState,
  overrides: Partial<ChatToolDependencies> = {}
) {
  const dependencies: ChatToolDependencies = {
    query: queryFilteredEvents,
    metadata: getEventMetadata,
    details: fetchEventDetails,
    ...overrides,
  };
  let state: ChatSearchState = previousState ?? {
    filters: {
      dateFilter: 'all',
      useDefaultFilters: true,
      showDailyEvents: false,
      ...initialFilters,
    },
    nextCursor: null,
    hasMore: false,
  };
  const seenEvents = new Map<string, ChatEvent>();

  return {
    get state() {
      return state;
    },
    async execute(name: string, args: unknown): Promise<unknown> {
      if (!isRecord(args)) throw new Error('Tool arguments must be an object.');
      if (name === 'get_search_filters') return dependencies.metadata();
      if (name === 'get_event_details') {
        if (typeof args.eventId !== 'string') throw new Error('eventId is required.');
        const event = seenEvents.get(args.eventId) ?? (await dependencies.details(args.eventId));
        return event
          ? formatChatEvent(event, true)
          : { error: 'This event is unavailable or no longer listed.' };
      }
      if (name !== 'search_events') throw new Error(`Unknown tool: ${name}`);
      if (args.nextPage !== undefined && typeof args.nextPage !== 'boolean')
        throw new Error('nextPage must be true or false.');

      const nextPage = args.nextPage === true;
      if (
        nextPage &&
        Object.entries(args).some(([key, value]) => key !== 'nextPage' && value !== null)
      ) {
        throw new Error('nextPage requires unchanged filters (set all filter fields to null).');
      }
      if (nextPage && (!state.hasMore || !state.nextCursor)) {
        return {
          events: [],
          hasMore: false,
          appliedFilters: state.filters,
          note: 'No further results for this search.',
        };
      }
      const filters = resolveSearchFilters(state.filters, nextPage ? {} : args);
      const result: EventQueryResult = await dependencies.query({
        ...filters,
        limit: 50,
        cursor: nextPage ? (state.nextCursor ?? undefined) : undefined,
      });
      state = { filters, nextCursor: result.nextCursor, hasMore: result.hasMore };
      for (const event of result.events) seenEvents.set(event.id, event);
      return {
        events: result.events.map((event) => formatChatEvent(event)),
        returnedCount: result.events.length,
        hasMore: result.hasMore,
        appliedFilters: filters,
        note: result.hasMore
          ? 'This is one page, not the full match set. More results may exist. Use nextPage to continue; an empty page with hasMore true means more rows remain to scan.'
          : 'Search exhausted; these are the remaining matches. Coverage is limited to events currently in our database.',
      };
    },
  };
}
