/**
 * Hand-written OpenAPI 3.1 description of the public read API, served at
 * /openapi.json. It describes app/api/export/json and app/api/export/markdown as
 * implemented (see lib/api/publicEvents.ts and lib/api/publicEventsContract.ts):
 * when a parameter, field or error changes there, change it here too. Imports
 * only DB-free modules.
 */

import { TAG_CATEGORIES } from '@/lib/config/tagCategories';
import { generateEventUrl } from '@/lib/utils/slugify';
import { formatEventStartDate } from '@/lib/utils/eventStartDate';
import {
  COMPACT_BATCH_SIZE,
  COMPACT_DEFAULT_LIMIT,
  COMPACT_MAX_BATCHES,
  COMPACT_MAX_LIMIT,
  PUBLIC_EXPORT_ERROR_HEADERS,
  PUBLIC_EXPORT_SUCCESS_HEADERS,
  encodeCursor,
} from '@/lib/api/publicEventsContract';

const SITE_URL = 'https://www.avlgo.com';

// Illustrative example events (not real listings); url and nextCursor come from the
// real helpers so their format can't drift.
const EXAMPLE_JAM = {
  id: '3f2b9c1e-8a4d-4c6b-9f1e-2d7a5b8c0e14',
  title: 'Bluegrass Jam on the Porch',
  start: new Date('2026-10-02T22:30:00.000Z'),
};
const EXAMPLE_MARKET = {
  id: '7c4e2a90-1b3f-4d8e-a6c2-5e9f0b1d2c33',
  title: 'Fall Craft Market',
  start: new Date('2026-10-03T04:00:00.000Z'),
};

const OFFICIAL_TAGS = TAG_CATEGORIES.flatMap((category) => category.tags)
  .map((tag) => `\`${tag}\``)
  .join(', ');

const SCAN_CAP = (COMPACT_BATCH_SIZE * COMPACT_MAX_BATCHES).toLocaleString('en-US');

const nullableString = { type: ['string', 'null'] };
const nullableInteger = { type: ['integer', 'null'] };
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' };

/** A comma-separated query value. */
function csvParameter(name: string, description: string, items: object = { type: 'string' }) {
  return {
    name,
    in: 'query',
    required: false,
    style: 'form',
    explode: false,
    description,
    schema: { type: 'array', items },
  };
}

function queryParameter(name: string, description: string, schema: object = { type: 'string' }) {
  return { name, in: 'query', required: false, description, schema };
}

const corsHeader = { $ref: '#/components/headers/AccessControlAllowOrigin' };

const legacyFilterRefs = [
  'dateFilter',
  'dateStart',
  'dateEnd',
  'days',
  'times',
  'priceFilter',
  'maxPrice',
  'tagsInclude',
  'tagsExclude',
  'locations',
  'zips',
  'blockedHosts',
  'blockedKeywords',
  'hiddenEvents',
  'useDefaultFilters',
  'showDailyEvents',
].map((name) => ({ $ref: `#/components/parameters/${name}` }));

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'AVL GO Events API',
    version: '1.0.0',
    summary: 'Free, read-only API for upcoming events in Asheville, NC and Western North Carolina.',
    description: [
      'AVL GO aggregates local event listings for Asheville and the surrounding area. These endpoints return upcoming events (starting today or later, Eastern time) with no authentication.',
      '',
      `**For AI assistants and agents, call \`GET /api/export/json?format=compact\`** with filters such as \`dateFilter=today\`, \`locations=asheville\` or \`priceFilter=free\`. Compact responses are small pages (${COMPACT_DEFAULT_LIMIT} events by default) containing only the fields needed to answer "what's on?", and each event's \`url\` is its page on avlgo.com.`,
      '',
      'Responses are cached at several layers: shared caches keep a response for 5 minutes (and may serve it up to a minute longer while refreshing), browsers for 1 minute, and compact results also pass through a server data cache that refreshes every 5 minutes or when the feed updates. These are refresh intervals, not a maximum age, so check `generated` (when the data was read) to see how fresh a response is. Listings are refreshed from their sources on a schedule and can be incomplete or out of date, so confirm details on the event page before attending.',
    ].join('\n'),
  },
  servers: [{ url: SITE_URL }],
  security: [],
  externalDocs: {
    description: 'Developer guide with example requests and responses',
    url: `${SITE_URL}/developers`,
  },
  tags: [{ name: 'Events', description: 'Upcoming events in and around Asheville, NC.' }],
  paths: {
    '/api/export/json': {
      get: {
        operationId: 'getEvents',
        tags: ['Events'],
        summary: 'List upcoming events as JSON (compact pages or full records)',
        description: [
          'Upcoming events sorted by start time (then id), filtered by the query parameters. Every filter is optional and they combine with AND.',
          '',
          `**\`format=compact\` (recommended for assistants):** a page of at most \`limit\` events (default ${COMPACT_DEFAULT_LIMIT}, max ${COMPACT_MAX_LIMIT}) with id, title, startDate, location, price, aiSummary and url. To get the next page, repeat the same request with the same filters plus \`cursor\` set to the previous response's \`nextCursor\`; stop when \`hasMore\` is false. Each request examines at most ${SCAN_CAP} candidate events; if it reaches that limit before the page is full, the page can be short or even empty while \`hasMore\` is still true: keep following \`nextCursor\`. Pages are not a snapshot (events can change between requests), so de-duplicate by \`id\`.`,
          '',
          '**`format=full` (default):** every matching event with all public fields in one unpaginated response, which can be several megabytes without filters. In full records `url` is the original listing on the source site, not the AVL GO page.',
        ].join('\n'),
        parameters: [
          { $ref: '#/components/parameters/format' },
          { $ref: '#/components/parameters/limit' },
          { $ref: '#/components/parameters/cursor' },
          { $ref: '#/components/parameters/searchJson' },
          ...legacyFilterRefs,
        ],
        responses: {
          '200': {
            description:
              'Matching events. The shape depends on `format`: `FullEventsResponse` (default) or `CompactEventsResponse`.',
            headers: {
              'Cache-Control': { $ref: '#/components/headers/SuccessCacheControl' },
              'Access-Control-Allow-Origin': corsHeader,
            },
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/FullEventsResponse' },
                    { $ref: '#/components/schemas/CompactEventsResponse' },
                  ],
                },
                examples: {
                  compact: {
                    summary: 'format=compact&limit=2 (illustrative data, not real listings)',
                    value: {
                      count: 2,
                      generated: '2026-10-02T14:05:12.345Z',
                      timezone: 'America/New_York',
                      events: [
                        {
                          id: EXAMPLE_JAM.id,
                          title: EXAMPLE_JAM.title,
                          startDate: formatEventStartDate(EXAMPLE_JAM.start, false),
                          location: 'Example Taproom, Asheville, NC',
                          price: 'Free',
                          aiSummary:
                            'A weekly acoustic bluegrass jam where players of all levels sit in and listeners are welcome.',
                          url: generateEventUrl(
                            EXAMPLE_JAM.title,
                            EXAMPLE_JAM.start,
                            EXAMPLE_JAM.id,
                            SITE_URL
                          ),
                        },
                        {
                          id: EXAMPLE_MARKET.id,
                          title: EXAMPLE_MARKET.title,
                          startDate: formatEventStartDate(EXAMPLE_MARKET.start, true),
                          location: 'Example Park, Weaverville, NC',
                          price: null,
                          aiSummary: null,
                          url: generateEventUrl(
                            EXAMPLE_MARKET.title,
                            EXAMPLE_MARKET.start,
                            EXAMPLE_MARKET.id,
                            SITE_URL
                          ),
                        },
                      ],
                      nextCursor: encodeCursor({
                        // Cursors carry the stored start to the microsecond
                        startDate: EXAMPLE_MARKET.start.toISOString().replace('Z', '000Z'),
                        id: EXAMPLE_MARKET.id,
                      }),
                      hasMore: true,
                    },
                  },
                },
              },
            },
          },
          '400': {
            description:
              'Invalid `format`, or (compact only) an invalid `limit` or `cursor`. Not cached.',
            headers: {
              'Cache-Control': { $ref: '#/components/headers/NoStoreCacheControl' },
              'Access-Control-Allow-Origin': corsHeader,
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  additionalProperties: false,
                  properties: {
                    error: {
                      type: 'string',
                      enum: ['Invalid format', 'Invalid limit', 'Invalid cursor'],
                    },
                  },
                },
              },
            },
          },
          '500': {
            description: 'The feed could not be generated. Not cached; retry later.',
            headers: {
              'Cache-Control': { $ref: '#/components/headers/NoStoreCacheControl' },
              'Access-Control-Allow-Origin': corsHeader,
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  additionalProperties: false,
                  properties: { error: { type: 'string', const: 'Failed to generate JSON feed' } },
                },
              },
            },
          },
        },
      },
    },
    '/api/export/markdown': {
      get: {
        operationId: 'getEventsMarkdown',
        tags: ['Events'],
        summary: 'List upcoming events as a Markdown document',
        description:
          'Every matching upcoming event as one Markdown document, sorted by start time, for reading or pasting into a prompt. Takes the same filters as the JSON export except that `search` treats the whole value as one phrase. There is no compact mode and no pagination, so prefer `GET /api/export/json?format=compact` when you only need a few events.',
        parameters: [{ $ref: '#/components/parameters/searchMarkdown' }, ...legacyFilterRefs],
        responses: {
          '200': {
            description:
              'A `# Asheville Events` heading with the generation time and total count, then one section per event: `## [Title](source listing URL)`, then Date (Eastern), Location, Organizer, Price, Source, Tags and the description cut to 500 characters, each section ending in `---`. Lines with no data are left out.',
            headers: {
              'Cache-Control': { $ref: '#/components/headers/SuccessCacheControl' },
              'Access-Control-Allow-Origin': corsHeader,
            },
            content: { 'text/markdown': { schema: { type: 'string' } } },
          },
          '500': {
            description: 'The feed could not be generated. Not cached; retry later.',
            headers: {
              'Cache-Control': { $ref: '#/components/headers/NoStoreCacheControl' },
              'Access-Control-Allow-Origin': corsHeader,
            },
            content: {
              'text/markdown': {
                schema: { type: 'string', const: '# Error\n\nFailed to generate Markdown feed.' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      format: queryParameter(
        'format',
        `Response shape. \`compact\` is the recommended, token-cheap option for AI assistants and agents: pages of at most \`limit\` events with only id, title, startDate, location, price, aiSummary and the AVL GO event page url. \`full\` (the default when omitted) returns every field of every matching event in one unpaginated response. Any other value returns 400 \`{"error":"Invalid format"}\`.`,
        { type: 'string', enum: ['full', 'compact'], default: 'full' }
      ),
      limit: queryParameter(
        'limit',
        `Compact only: maximum events in the page, a whole number from 1 to ${COMPACT_MAX_LIMIT} (default ${COMPACT_DEFAULT_LIMIT}). Anything else returns 400 \`{"error":"Invalid limit"}\`. Ignored when format is full.`,
        { type: 'integer', minimum: 1, maximum: COMPACT_MAX_LIMIT, default: COMPACT_DEFAULT_LIMIT }
      ),
      cursor: queryParameter(
        'cursor',
        'Compact only: the `nextCursor` from the previous page, passed back unchanged (URL-encoded). Send the same filters and `limit` as that request. Omit it for the first page. A malformed value returns 400 `{"error":"Invalid cursor"}`. Ignored when format is full.'
      ),
      searchJson: queryParameter(
        'search',
        "Case-insensitive text search over each event's title, description, organizer and location (not tags or the AI summary). Separate terms with commas to match ANY of them: `search=jazz,blues`. Spaces around terms are ignored; a value with no terms (only commas or spaces) matches nothing."
      ),
      searchMarkdown: queryParameter(
        'search',
        "Case-insensitive text search over each event's title, description, organizer and location (not tags or the AI summary). Unlike the JSON export, the whole value is one phrase: commas are not separators, so `jazz,blues` looks for that literal text."
      ),
      dateFilter: queryParameter(
        'dateFilter',
        'Which days to return, in Eastern time (America/New_York). Recognized values: `today`; `tomorrow`; `weekend` (this Friday through Sunday, or the rest of the current weekend on a Saturday or Sunday); `dayOfWeek` (with `days`); `custom` (with `dateStart` and optionally `dateEnd`); `all`. Omitted, `all` or any other value: no restriction beyond the default of events starting today or later.'
      ),
      dateStart: queryParameter(
        'dateStart',
        "First day of a `dateFilter=custom` range, as YYYY-MM-DD in Eastern time. Without it, `custom` applies no date restriction. A date that can't be parsed matches no events. Ignored for other dateFilter values.",
        { type: 'string', format: 'date' }
      ),
      dateEnd: queryParameter(
        'dateEnd',
        "Last day of a `dateFilter=custom` range, inclusive, as YYYY-MM-DD in Eastern time. Omit it to get only `dateStart`'s day. A date that can't be parsed matches no events. Ignored for other dateFilter values.",
        { type: 'string', format: 'date' }
      ),
      days: csvParameter(
        'days',
        'Days of the week for `dateFilter=dayOfWeek`, as numbers from 0 (Sunday) to 6 (Saturday) in Eastern time, matching ANY listed: `days=5,6` for Fridays and Saturdays. Ignored for other dateFilter values.',
        { type: 'integer' }
      ),
      times: csvParameter(
        'times',
        'Parts of the day in Eastern time, matching ANY listed: `morning` (5:00-11:59), `afternoon` (12:00-16:59), `evening` (17:00-2:59). Events whose source gave no start time always pass. Unrecognized values are ignored.'
      ),
      priceFilter: queryParameter(
        'priceFilter',
        'Recognized values: `any` (the default), `confirmedFree`, `free`, `under20`, `under100`, `custom` (with `maxPrice`); any other value applies no price filter. `confirmedFree`: listed as free by the source, meaning a price of exactly "Free" (any case) or a single zero amount such as "$0". `free`: free or no price listed (many unlisted events are free), meaning the price mentions "free" or "donation" (any case, even "$25 suggested donation"), its first number is 0, or it is missing, "Unknown" or "TBD"; "Ticketed" and other priced text are excluded. The thresholds read each price approximately: text containing "free" or "donation" counts as 0; otherwise the first number in the text is used ("$15-25" counts as 15, "$1,200" as 1200); a missing price or text with no number ("Unknown", "Ticketed") counts as 0. `under20` and `under100` keep events counted at or below 20 or 100, and `custom` at or below `maxPrice`, so they also include every event that counts as 0.'
      ),
      maxPrice: queryParameter(
        'maxPrice',
        'Highest price for `priceFilter=custom`, in US dollars, e.g. `35`. Read like JavaScript `parseFloat`: a leading number is used and anything after it is ignored (`20USD` means 20), while a value that does not start with a number (`$20`, `abc`) applies no limit. Ignored for other priceFilter values.'
      ),
      tagsInclude: csvParameter(
        'tagsInclude',
        `Keep events that have at least ONE of these tags. Tag names are exact and case-sensitive and are not trimmed, so put no spaces after the commas and URL-encode spaces and ampersands (\`tagsInclude=Live%20Music,Comedy\`). Official tags: ${OFFICIAL_TAGS}. Events can also carry additional free-form tags.`
      ),
      tagsExclude: csvParameter(
        'tagsExclude',
        'Drop events that have ANY of these tags. Same exact, case-sensitive matching as `tagsInclude`.'
      ),
      locations: csvParameter(
        'locations',
        'Keep events in ANY of these places. `asheville` (lowercase) is the Asheville area: locations in Asheville plus well-known Asheville venues listed without a town. `Online` keeps events whose location is just "Online". Any other value is a town name compared exactly (case-sensitive) with the town recognized in the event\'s location, e.g. `Black Mountain`, `Weaverville`, `Hendersonville`, `Brevard`, `Waynesville`, `Marshall`. Put no spaces after the commas.'
      ),
      zips: csvParameter(
        'zips',
        'Keep events whose ZIP code is exactly one of these, e.g. `zips=28801,28806`. Events without a ZIP never match.'
      ),
      blockedHosts: csvParameter(
        'blockedHosts',
        'Drop events whose organizer contains any of these strings (case-insensitive). Events with no organizer are never dropped.'
      ),
      blockedKeywords: csvParameter(
        'blockedKeywords',
        'Drop events whose title contains any of these strings (case-insensitive).'
      ),
      hiddenEvents: {
        name: 'hiddenEvents',
        in: 'query',
        required: false,
        description:
          'Drop specific listings by title and organizer: a URL-encoded JSON array of `{"title": "...", "organizer": "..."}` objects. Both values must already be lowercase and trimmed (use "" for no organizer); they are compared exactly with the event\'s lowercased, trimmed title and organizer. Malformed JSON and malformed entries are ignored.',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                required: ['title', 'organizer'],
                properties: {
                  title: { type: 'string' },
                  organizer: { type: 'string' },
                },
              },
            },
          },
        },
      },
      useDefaultFilters: queryParameter(
        'useDefaultFilters',
        "AVL GO's default spam filter (a built-in keyword blocklist checked against title, description and organizer) is on unless this is exactly `false`."
      ),
      showDailyEvents: queryParameter(
        'showDailyEvents',
        'Events that recur daily (`recurringType: "daily"`, such as long-running exhibits) are included unless this is exactly `false`.'
      ),
    },
    headers: {
      SuccessCacheControl: {
        description:
          'Browsers may reuse the response for 60 seconds; shared caches for 5 minutes, plus up to 60 seconds while they refresh it.',
        schema: {
          type: 'string',
          const: PUBLIC_EXPORT_SUCCESS_HEADERS['Cache-Control'],
        },
      },
      NoStoreCacheControl: {
        description: 'Errors are never cached.',
        schema: { type: 'string', const: PUBLIC_EXPORT_ERROR_HEADERS['Cache-Control'] },
      },
      AccessControlAllowOrigin: {
        description: 'Any origin may read the response (no credentials).',
        schema: { type: 'string', const: '*' },
      },
    },
    schemas: {
      CompactEventsResponse: {
        type: 'object',
        description: 'Returned when `format=compact`.',
        required: ['count', 'generated', 'timezone', 'events', 'nextCursor', 'hasMore'],
        additionalProperties: false,
        properties: {
          count: {
            type: 'integer',
            minimum: 0,
            description: 'Number of events in this page (not the total number of matches).',
          },
          generated: {
            type: 'string',
            format: 'date-time',
            description:
              'When this data was read from the database (UTC). Responses pass through caches that refresh every few minutes, so this can be several minutes before your request: use it to judge freshness.',
          },
          timezone: {
            type: 'string',
            const: 'America/New_York',
            description: 'Time zone of every `startDate`.',
          },
          events: { type: 'array', items: { $ref: '#/components/schemas/CompactEvent' } },
          nextCursor: {
            type: ['string', 'null'],
            description:
              'Pass as `cursor`, with the same filters, to get the next page. null when `hasMore` is false.',
          },
          hasMore: {
            type: 'boolean',
            description:
              'true when more matching events may follow. Keep paging until it is false, even if this page is short or empty.',
          },
        },
      },
      CompactEvent: {
        type: 'object',
        required: ['id', 'title', 'startDate', 'location', 'price', 'aiSummary', 'url'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'uuid', description: 'AVL GO event id.' },
          title: { type: 'string' },
          startDate: {
            description:
              'Start in Eastern time. With a known time: RFC 3339 to the second, with the UTC offset in effect at that moment, e.g. `2026-10-02T19:00:00-04:00`. When the source gave only a date: the date alone, e.g. `2026-10-02` (no start time is implied).',
            oneOf: [
              {
                type: 'string',
                format: 'date-time',
                pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:Z|[+-]\\d{2}:\\d{2})$',
              },
              { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            ],
          },
          location: {
            ...nullableString,
            description: 'Venue and/or address as the source listed it; null when unknown.',
          },
          price: {
            ...nullableString,
            description:
              'The source\'s price text, e.g. "Free", "$15", "$5 - $10", "Donation", "Ticketed"; null when none is listed. "Free" means the source said it is free.',
          },
          aiSummary: {
            ...nullableString,
            description:
              'One or two sentence AI-written summary; null when the event has not been summarized yet.',
          },
          url: {
            type: 'string',
            format: 'uri',
            description: `The event's page on AVL GO (${SITE_URL}/events/...). Link people here.`,
          },
        },
      },
      FullEventsResponse: {
        type: 'object',
        description: 'Returned when `format` is omitted or `full`.',
        required: ['count', 'generated', 'events'],
        additionalProperties: false,
        properties: {
          count: {
            type: 'integer',
            minimum: 0,
            description: 'Number of events returned (all matches).',
          },
          generated: {
            type: 'string',
            format: 'date-time',
            description:
              'When the response was generated (UTC). Shared caches can serve it for a few minutes afterwards: use it to judge freshness.',
          },
          events: { type: 'array', items: { $ref: '#/components/schemas/FullEvent' } },
        },
      },
      FullEvent: {
        type: 'object',
        required: [
          'id',
          'sourceId',
          'source',
          'title',
          'description',
          'startDate',
          'location',
          'zip',
          'organizer',
          'price',
          'url',
          'imageUrl',
          'tags',
          'aiSummary',
          'interestedCount',
          'goingCount',
          'favoriteCount',
          'score',
          'scoreRarity',
          'scoreUnique',
          'scoreMagnitude',
          'scoreReason',
          'scoreAshevilleWeird',
          'scoreSocial',
          'recurringType',
          'recurringEndDate',
          'timeUnknown',
          'createdAt',
          'updatedAt',
          'lastSeenAt',
        ],
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'uuid', description: 'AVL GO event id.' },
          sourceId: { type: 'string', description: "The listing's id on its source." },
          source: {
            type: 'string',
            description: 'Source code, e.g. `AVL_TODAY`, `EVENTBRITE`, `MEETUP`, `POSTER`.',
          },
          title: { type: 'string' },
          description: { ...nullableString, description: "The source's description." },
          startDate: {
            type: 'string',
            format: 'date-time',
            description:
              'Start instant in UTC. When `timeUnknown` is true only the date is meaningful.',
          },
          location: { ...nullableString, description: 'Venue and/or address as listed.' },
          zip: { ...nullableString, description: 'ZIP code.' },
          organizer: { ...nullableString, description: 'Organizer or host.' },
          price: {
            ...nullableString,
            description: 'Price text as the source listed it, e.g. "$20", "Free", "$15-25".',
          },
          url: {
            type: 'string',
            description: 'The original listing on the source site (not the AVL GO page).',
          },
          imageUrl: {
            ...nullableString,
            description:
              'Event image. Can be a site-relative path such as `/asheville-default.jpg` (a generic placeholder).',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Official category tags plus any free-form tags.',
          },
          aiSummary: {
            ...nullableString,
            description: 'One or two sentence AI-written summary.',
          },
          interestedCount: {
            ...nullableInteger,
            description: 'Facebook "interested" count; null when zero or unknown.',
          },
          goingCount: {
            ...nullableInteger,
            description: 'Facebook "going" count; null when zero or unknown.',
          },
          favoriteCount: {
            type: 'integer',
            minimum: 0,
            description: 'Times favorited on AVL GO.',
          },
          score: {
            ...nullableInteger,
            description: 'AI quality score, 0-30 (rarity + unique + magnitude).',
          },
          scoreRarity: { ...nullableInteger, description: 'How rare the event is, 0-10.' },
          scoreUnique: { ...nullableInteger, description: 'How novel the event is, 0-10.' },
          scoreMagnitude: { ...nullableInteger, description: 'Production scale, 0-10.' },
          scoreReason: { ...nullableString, description: 'One-sentence reason for the score.' },
          scoreAshevilleWeird: {
            ...nullableInteger,
            description: 'How "Asheville weird" the event is, 1-10.',
          },
          scoreSocial: {
            ...nullableInteger,
            description: 'How good the event is for meeting people, 1-10.',
          },
          recurringType: {
            ...nullableString,
            description: '`daily` for events that recur every day; otherwise null.',
          },
          recurringEndDate: {
            ...nullableDateTime,
            description: 'When a daily recurring event ends.',
          },
          timeUnknown: {
            type: 'boolean',
            description: 'true when the source gave a date but no start time.',
          },
          createdAt: { ...nullableDateTime, description: 'When AVL GO first stored the event.' },
          updatedAt: { ...nullableDateTime, description: 'When the stored event last changed.' },
          lastSeenAt: {
            ...nullableDateTime,
            description: 'When a scraper last saw the listing at its source.',
          },
        },
      },
    },
  },
};
