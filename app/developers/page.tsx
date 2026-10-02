import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import Header from '@/components/Header';
import { TAG_CATEGORIES } from '@/lib/config/tagCategories';
import { SITE_NAME, SITE_URL } from '@/lib/seo/site';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import CopyButton from './CopyButton';

const pageUrl = `${SITE_URL}/developers`;
const title = 'Free Asheville Events API — JSON and OpenAPI';
const description =
  "Use AVL GO's free Asheville events API to find today's events, free weekend activities and live music with compact JSON and OpenAPI documentation.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'website',
    url: pageUrl,
    title,
    description,
    siteName: SITE_NAME,
    locale: 'en_US',
    images: [{ url: '/avlgo-og.png', width: 1200, height: 630, alt: 'AVL GO' }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/avlgo-og.png'],
    creator: '@mattbrooksxyz',
  },
};

// Static except for the custom-date example, whose request asks for the next few days
// and so has to move with the calendar.
export const revalidate = 3600;

const API_URL = `${SITE_URL}/api/export/json`;
const MARKDOWN_URL = `${SITE_URL}/api/export/markdown`;
const QUICK_URL = `${API_URL}?format=compact&dateFilter=today&limit=20`;
const TODAY_URL = `${API_URL}?format=compact&dateFilter=today&locations=asheville&limit=3`;
const FILTERS_FOR_FULL = 'dateFilter=today&locations=asheville&tagsInclude=Live%20Music';

/** Tomorrow and the day after next in Eastern time, as YYYY-MM-DD */
function upcomingRange(): [string, string] {
  const [year, month, day] = getTodayStringEastern().split('-').map(Number);
  const plus = (days: number) =>
    new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  return [plus(1), plus(3)];
}

// ---------------------------------------------------------------------------
// Illustrative fixtures: sample values, not real listings
// ---------------------------------------------------------------------------

const json = (value: unknown) => JSON.stringify(value, null, 2);
const GENERATED = '2026-10-02T16:00:00.000Z';

const YOGA = {
  id: '6880f252-0fff-43d8-937b-b37cd7e1e0ac',
  title: 'Sunset Yoga in the Park',
  startDate: '2026-10-02T18:00:00-04:00',
  location: 'Pack Square Park, Asheville, NC',
  price: 'Free',
  aiSummary: 'An all-levels outdoor yoga class at sunset. Bring a mat and water.',
  url: `${SITE_URL}/events/sunset-yoga-in-the-park-2026-10-02-6880f2`,
};
const STRING_BAND = {
  id: '49735df5-ae1b-405b-a122-a0cddce00744',
  title: 'Old-Time String Band Night',
  startDate: '2026-10-02T19:00:00-04:00',
  location: 'River Arts District, Asheville, NC',
  price: '$15',
  aiSummary:
    'Local old-time and bluegrass string bands play two sets of traditional mountain music.',
  url: `${SITE_URL}/events/old-time-string-band-night-2026-10-02-49735d`,
};
const TRIVIA = {
  id: '4b437a18-b555-4852-9c39-5c307346dff8',
  title: 'Pub Trivia',
  startDate: '2026-10-02T19:30:00-04:00',
  location: 'Downtown Asheville, NC',
  price: null,
  aiSummary: null,
  url: `${SITE_URL}/events/pub-trivia-2026-10-02-4b437a`,
};
const JAZZ = {
  id: '54da8fc2-9773-4bb2-9201-8d00018f0e7e',
  title: 'Late-Night Jazz Trio',
  startDate: '2026-10-02T21:00:00-04:00',
  location: 'Haywood Rd, West Asheville, NC',
  price: '$10 - $20',
  aiSummary: 'A jazz trio plays standards and originals in a late-night listening-room set.',
  url: `${SITE_URL}/events/late-night-jazz-trio-2026-10-02-54da8f`,
};
const VOLUNTEER = {
  id: 'b8313e2e-13ee-49a0-acb3-3495664b8c1f',
  title: 'Pollinator Garden Volunteer Day',
  startDate: '2026-10-04',
  location: 'West Asheville Park, Asheville, NC',
  price: 'Free',
  aiSummary: 'Volunteers weed, mulch and plant native pollinator species. Tools are provided.',
  url: `${SITE_URL}/events/pollinator-garden-volunteer-day-2026-10-04-b8313e`,
};
const BLUES = {
  id: '8b701ee6-49d6-4647-b87c-5d00e3ba29a0',
  title: 'Blues Jam',
  startDate: '2026-10-03T20:00:00-04:00',
  location: 'Black Mountain, NC',
  price: '$5 - $10',
  aiSummary: 'An open blues jam where a house band backs guest players.',
  url: `${SITE_URL}/events/blues-jam-2026-10-03-8b701e`,
};

const compactPage = (events: object[], nextCursor: string | null) =>
  json({
    count: events.length,
    generated: GENERATED,
    timezone: 'America/New_York',
    events,
    nextCursor,
    hasMore: nextCursor !== null,
  });

const SOURCE_URL = 'https://www.eventbrite.com/e/old-time-string-band-night-tickets-1234567890123';
const SOURCE_DESCRIPTION =
  'Two sets of old-time and bluegrass from local string bands. All ages; doors at 6:30 PM.';

const FULL_RESPONSE = json({
  count: 1,
  generated: GENERATED,
  events: [
    {
      id: STRING_BAND.id,
      sourceId: '1234567890123',
      source: 'EVENTBRITE',
      title: STRING_BAND.title,
      description: SOURCE_DESCRIPTION,
      startDate: '2026-10-02T23:00:00.000Z',
      location: STRING_BAND.location,
      zip: '28801',
      organizer: 'Blue Ridge String Collective',
      price: STRING_BAND.price,
      url: SOURCE_URL,
      imageUrl: null,
      tags: ['Live Music', 'Bluegrass', 'Old Time'],
      aiSummary: STRING_BAND.aiSummary,
      interestedCount: null,
      goingCount: null,
      favoriteCount: 4,
      score: 17,
      scoreRarity: 5,
      scoreUnique: 6,
      scoreMagnitude: 6,
      scoreReason: 'A regular local jam: modest in scale, but rooted in Appalachian music.',
      scoreAshevilleWeird: 6,
      scoreSocial: 7,
      recurringType: null,
      recurringEndDate: null,
      timeUnknown: false,
      createdAt: '2026-09-20T12:15:00.000Z',
      updatedAt: '2026-09-30T18:20:00.000Z',
      lastSeenAt: '2026-10-01T22:00:00.000Z',
    },
  ],
});

const MARKDOWN_RESPONSE = `# Asheville Events

> Generated: ${GENERATED}
> Total Events: 1

---

## [${STRING_BAND.title}](${SOURCE_URL})

**Date:** Friday, October 2, 2026 at 7:00 PM
**Location:** ${STRING_BAND.location}
**Organizer:** Blue Ridge String Collective
**Price:** ${STRING_BAND.price}
**Source:** EVENTBRITE
**Tags:** Live Music, Bluegrass, Old Time

${SOURCE_DESCRIPTION}

---`;

const PAGING_LOOP = `const base = '${API_URL}?format=compact&dateFilter=weekend&limit=20';
const events = [];
let url = base;

while (url) {
  const page = await fetch(url).then((res) => res.json());
  events.push(...page.events); // a page can be empty while hasMore is true
  url = page.hasMore ? \`\${base}&cursor=\${encodeURIComponent(page.nextCursor)}\` : null;
}`;

// ---------------------------------------------------------------------------
// Reference text. Strings support `code` and [links](href) via md().
// ---------------------------------------------------------------------------

// One row per line, so the tables below are kept out of Prettier's hands
// prettier-ignore
const AI_NOTES: [string, string][] = [
  ['What this is', 'a free, read-only API of upcoming events in and around Asheville, NC. No key needed.'],
  ['Call', `\`${QUICK_URL}\`. Change \`dateFilter\` to \`tomorrow\` or \`weekend\`, or add \`search\`, \`tagsInclude\`, \`priceFilter=confirmedFree\` or \`locations=asheville\`.`],
  ['You get', '`count, generated, timezone, events, nextCursor, hasMore`, with each event as `id, title, startDate, location, price, aiSummary, url` (`url` is its AVL GO page).'],
  ['Read it right', 'times are Eastern, and a date-only `startDate` means no start time was listed. While `hasMore` is true, repeat the same request with `cursor=nextCursor`.'],
  ['When answering', 'link each event’s `url`, check `generated` for time-sensitive questions, and suggest confirming details with the organizer before going.'],
];

// prettier-ignore
const COMPACT_FIELDS: [string, string, string][] = [
  ['count', 'integer', 'Number of events in this page (not the total match count).'],
  ['generated', 'string (UTC date-time)', 'When this response was built. See [freshness](#freshness).'],
  ['timezone', '"America/New_York"', 'The time zone of every date in the response and every date filter.'],
  ['events', 'array', 'Matching events, ordered by start time.'],
  ['nextCursor', 'string or null', 'Pass back as `cursor` for the next page; `null` on the last page.'],
  ['hasMore', 'boolean', '`true` while there may be more events. See [paging](#paging).'],
  ['events[].id', 'string (UUID)', 'Stable AVL GO event id.'],
  ['events[].title', 'string', 'Event title as listed.'],
  ['events[].startDate', 'string', 'Eastern start time with its UTC offset (`2026-10-02T19:00:00-04:00`), or a date only (`2026-10-02`) when no start time was listed. See [dates and time zone](#time-zone).'],
  ['events[].location', 'string or null', 'Venue and address text as the source listed it.'],
  ['events[].price', 'string or null', 'The source’s own price text, such as `Free`, `$15` or `$5 - $10`; `null` when none is listed. See [prices](#prices).'],
  ['events[].aiSummary', 'string or null', 'A one- or two-sentence AI-written summary; `null` until one has been written.'],
  ['events[].url', 'string (URL)', 'The event’s page on AVL GO, with full details and a link to the original listing.'],
];

// prettier-ignore
const PARAMETERS: [string, string, string][] = [
  ['format', '`compact` or `full`', 'Default `full`: every matching event with all fields, in one unpaginated response. `compact`: small, paginated records. Any other value returns 400.'],
  ['limit', 'Integer 1–100 (default 20)', 'Compact only: events per page. Any other value returns 400. Ignored in full mode.'],
  ['cursor', 'The last page’s `nextCursor`', 'Compact only: continue after the previous page (see [paging](#paging)). A malformed cursor returns 400. Ignored in full mode.'],
  ['dateFilter', '`today`, `tomorrow`, `weekend`, `dayOfWeek`, `custom`', 'Eastern calendar days. `weekend` is Friday to Sunday of this week (the current weekend on a Saturday or Sunday). Omitted, `all` or unrecognized: every upcoming event.'],
  ['dateStart', '`YYYY-MM-DD`', 'With `dateFilter=custom`: the first day. Without it, `custom` applies no date limit.'],
  ['dateEnd', '`YYYY-MM-DD`', 'With `dateFilter=custom`: the last day, inclusive. Leave it off for a single day.'],
  ['days', 'Comma list of `0` to `6` (`0` is Sunday)', 'With `dateFilter=dayOfWeek`: the days of the week to keep, in Eastern time.'],
  ['times', 'Comma list of `morning`, `afternoon`, `evening`', 'Eastern start time: morning 5:00 to 11:59 AM, afternoon noon to 4:59 PM, evening 5:00 PM to 2:59 AM. Events with no listed start time always pass.'],
  ['priceFilter', '`any`, `confirmedFree`, `free`, `under20`, `under100`, `custom`', '`confirmedFree`: events the source lists as free. `free`: those plus events with no listed price. See [prices](#prices).'],
  ['maxPrice', 'Number, like `20`', 'With `priceFilter=custom`: the highest price to keep, inclusive. See [prices](#prices).'],
  ['tagsInclude', 'Comma list of tags', 'Keep events that have at least one of these tags. Exact and case-sensitive.'],
  ['tagsExclude', 'Comma list of tags', 'Drop events that have any of these tags.'],
  ['search', 'Text; commas separate alternatives', 'Case-insensitive substring match on title, description, organizer and location; an event matching any one term is kept. Tags and AI summaries are not searched. In the Markdown export the whole value is one phrase.'],
  ['locations', 'Comma list: `asheville`, `Online`, or a town such as `Black Mountain`', '`asheville` keeps Asheville and known Asheville venues. A town name must match the town AVL GO reads from the location text, capitalized as shown.'],
  ['zips', 'Comma list of ZIP codes', 'Keep events in these ZIP codes. Events with no ZIP code are dropped.'],
  ['blockedHosts', 'Comma list', 'Drop events whose organizer contains any of these (case-insensitive).'],
  ['blockedKeywords', 'Comma list', 'Drop events whose title contains any of these (case-insensitive).'],
  ['hiddenEvents', 'URL-encoded JSON array of `{"title": "…", "organizer": "…"}`', 'Drop specific events. Compared with the event’s lowercased, trimmed title and organizer, so send the values lowercased and trimmed.'],
  ['useDefaultFilters', '`false` to turn off', 'On by default: a built-in keyword filter hides likely spam listings.'],
  ['showDailyEvents', '`false` to turn off', 'On by default: include events that repeat every day.'],
];

// The canonical explanations; everything else on the page links here
const NOTES: { id?: string; title: string; items: string[] }[] = [
  {
    title: 'Do I need an API key?',
    items: [
      'No. There is no key, sign-up or authentication, and CORS is open (`Access-Control-Allow-Origin: *`), so browser code can call the API directly.',
      'Please be considerate: request compact pages with a small `limit`, cache what you fetch, and avoid polling more often than every few minutes. The full export holds every upcoming event with long descriptions and can run to several megabytes, so fetch it occasionally rather than per user request.',
    ],
  },
  {
    id: 'freshness',
    title: 'How fresh is the data?',
    items: [
      'Successful responses carry `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60`: a browser can reuse a response for 60 seconds and a shared cache for 300, then serve it for up to 60 seconds more while it fetches a fresh copy.',
      'Compact pages are also cached on the server for 300 seconds, or until the next scrape refreshes the events.',
      'Those caches stack, so check `generated` (UTC) to see when the response you have was built.',
      'Sources are collected on a schedule, most of them several times a day; a few are refreshed by periodic manual runs and can fall behind. Freshness and availability are best-effort.',
    ],
  },
  {
    id: 'time-zone',
    title: 'Dates and time zone',
    items: [
      'All dates and date filters use Eastern time (`America/New_York`).',
      'Compact `startDate` carries the UTC offset in effect at that moment: `-04:00` during daylight saving time, `-05:00` otherwise.',
      'A date-only `startDate` such as `2026-10-04` means the source gave no start time; don’t present it as midnight. Full mode always returns a UTC timestamp, so check `timeUnknown` there: when it is `true`, only the date is meaningful.',
      'Results start at midnight Eastern today; past days never appear. Events that repeat daily are included unless you send `showDailyEvents=false`.',
    ],
  },
  {
    id: 'paging',
    title: 'Paging',
    items: [
      'Repeat the request with the same filters and `limit`, adding `cursor` set to the `nextCursor` you got back, URL-encoded. Treat the cursor as opaque and don’t build your own.',
      'Stop when `hasMore` is `false`; `nextCursor` is `null` exactly then.',
      'A page can hold fewer events than `limit`, even none, while `hasMore` is still `true`: each request scans a fixed number of listings, and heavy filters can use them up before the page fills. Keep following `nextCursor`.',
      'Pages are ordered by `startDate`, then `id`. `count` is the number of events in the page; there is no total count.',
      'Pages are not a snapshot. Listings can change between requests, so de-duplicate by `id`.',
    ],
  },
  {
    title: 'Which URL should I link to?',
    items: [
      `In compact mode, \`url\` is the event’s AVL GO page (\`${SITE_URL}/events/…\`), which shows the details and links to the original listing. In full mode, \`url\` is the original listing itself, such as the venue’s page or the ticketing site.`,
    ],
  },
  {
    id: 'prices',
    title: 'Prices and the free filter',
    items: [
      'In compact responses, `price` is the source’s own wording (for example `Free`, `$15`, `$5 - $10`, `Donation` or `Ticketed`), or `null` when none is listed, including the placeholder `Unknown`. The full and Markdown exports show the raw text.',
      '`priceFilter=confirmedFree` keeps events the source lists as free: the price is exactly `Free` (any case) or a single zero amount such as `$0` or `$0.00`. Donation-based and other wording is not included.',
      '`priceFilter=free` keeps those plus events with no listed price (missing, `Unknown` or `TBD`; many of these are free), any price mentioning “free” or “donation” (`Free with RSVP`, `$25 suggested donation`), and prices whose first number is 0 (`$0 - $20`). Priced text with no number, such as `Ticketed`, is not free.',
      'For `under20`, `under100` and `custom`, each price is read as a number. Text containing “free” or “donation” counts as 0; otherwise the first number in the text is used (`$5 - $10` counts as 5, `$1,200` as 1200). A missing price or text with no number (`Ticketed`, `Unknown`) also counts as 0, so those events pass every threshold.',
      '`under20` and `under100` keep prices counted at 20 or 100 or less. `custom` keeps those at or below `maxPrice`, read with `parseFloat`: send a plain number like `maxPrice=20`, because `$20` or anything else that doesn’t start with a number applies no limit.',
    ],
  },
  {
    title: 'Errors',
    items: [
      '400 with `{"error":"Invalid format"}`, `{"error":"Invalid limit"}` or `{"error":"Invalid cursor"}` when that parameter is present but empty or malformed.',
      '500 with `{"error":"Failed to generate JSON feed"}`. Errors are never cached (`Cache-Control: no-store`).',
      'Other parameters are lenient: most unrecognized values are ignored (an unknown `dateFilter` applies no date limit), while an unknown tag or town, or an unreadable custom date (in either export), simply matches nothing. If results look wrong, check the spelling.',
    ],
  },
  {
    title: 'Using the data',
    items: [
      'Please credit AVL GO and link to the event’s AVL GO page or to [avlgo.com](/).',
      'Listings come from third-party sources, and summaries and tags are written by AI. Times, prices and cancellations can change or be wrong, so confirm with the organizer or the original listing before attending.',
      'Questions or problems: [open an issue on GitHub](https://github.com/MattB543/asheville-event-feed/issues).',
    ],
  },
];

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const linkClass =
  'font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600 dark:text-brand-300 dark:decoration-brand-700';

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800 [overflow-wrap:anywhere] dark:bg-gray-800 dark:text-gray-200">
      {children}
    </code>
  );
}

/** Renders `code` spans and [text](href) links in a plain string */
function md(text: string): ReactNode {
  return text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/).map((part, i) => {
    if (part.startsWith('`')) return <Code key={i}>{part.slice(1, -1)}</Code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!link) return part;
    const external = link[2].startsWith('http');
    return (
      <a
        key={i}
        href={link[2]}
        className={linkClass}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
      >
        {link[1]}
      </a>
    );
  });
}

function RequestUrl({ url, open = true }: { url: string; open?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-brand-200 bg-white dark:border-brand-900 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-brand-100 bg-brand-50 px-3 py-1.5 text-xs text-brand-700 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-300">
        <span className="font-semibold">
          <span className="font-mono">GET</span> request
        </span>
        <div className="flex items-center">
          <CopyButton
            text={url}
            label="Copy request URL"
            className={`hover:bg-brand-100 dark:hover:bg-brand-900/50 ${open ? '' : '-mr-1'}`}
          />
          {open && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open this request in a new tab"
              className="inline-flex items-center gap-0.5 rounded px-2 py-1 -my-1 -mr-1 font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50"
            >
              Open
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
      {/* Wraps instead of scrolling so the whole URL stays visible on a phone */}
      <pre className="whitespace-pre-wrap break-all px-3 py-2.5 text-[13px] leading-relaxed">
        <code className="select-all font-mono text-gray-900 dark:text-gray-100">{url}</code>
      </pre>
    </div>
  );
}

function CodeSample({
  body,
  label = 'Example response',
  note = 'Illustrative: sample values, not real listings',
  copy,
}: {
  body: string;
  label?: string;
  note?: string;
  /** Text for a Copy button, when the sample is meant to be run */
  copy?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900 dark:bg-black/40">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-gray-800 px-3 py-1.5 text-xs">
        <span className="font-semibold text-gray-200">{label}</span>
        {note && <span className="text-amber-300/90">{note}</span>}
        {copy && (
          <CopyButton
            text={copy}
            label={`Copy ${label.toLowerCase()} command`}
            className="-mr-1 text-gray-300 hover:bg-gray-800 hover:text-white"
          />
        )}
      </figcaption>
      <pre className="overflow-x-auto px-3 py-3 text-[13px] leading-relaxed text-gray-100">
        <code className="font-mono">{body}</code>
      </pre>
    </figure>
  );
}

function Collapsed({ children }: { children: ReactNode }) {
  return (
    <details>
      <summary className="cursor-pointer select-none text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
        Example response
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      className="mt-12 scroll-mt-6 border-t border-gray-200 pt-10 dark:border-gray-800"
    >
      <h2 className="font-display text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white">
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Three-column reference table. Below sm each row stacks into a card (the second column
 * gets its header as an inline label), so nothing sits off-screen on a phone.
 */
function RefTable({ headers, rows }: { headers: string[]; rows: [string, string, string][] }) {
  const cell = 'block sm:table-cell sm:px-3 sm:py-2 sm:align-top';
  return (
    <div className="rounded-lg border border-gray-200 bg-white sm:overflow-x-auto dark:border-gray-800 dark:bg-gray-900">
      <table className="block w-full border-collapse text-left text-sm sm:table sm:min-w-[40rem]">
        <thead className="hidden sm:table-header-group">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="border-b border-gray-200 bg-gray-50 px-3 py-2 font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800/60 dark:text-white"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {rows.map(([name, second, third]) => (
            <tr
              key={name}
              className="block border-b border-gray-100 px-3 py-2.5 last:border-b-0 sm:table-row sm:p-0 dark:border-gray-800"
            >
              <td
                className={`${cell} font-mono text-[13px] font-semibold text-gray-900 sm:whitespace-nowrap sm:font-normal dark:text-gray-100`}
              >
                {name}
              </td>
              <td className={`${cell} mt-1 sm:mt-0 sm:min-w-[10rem]`}>
                <span className="font-medium text-gray-500 sm:hidden dark:text-gray-400">
                  {headers[1]}:{' '}
                </span>
                {md(second)}
              </td>
              <td className={`${cell} mt-1 sm:mt-0`}>{md(third)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Question {
  id: string;
  title: string;
  intro: string;
  request: string;
  open?: boolean;
  response: string;
  responseLabel?: string;
  collapsed?: boolean;
  more?: ReactNode;
}

export default function DevelopersPage() {
  const [rangeStart, rangeEnd] = upcomingRange();

  const questions: Question[] = [
    {
      id: 'today',
      title: 'How do I get today’s events in Asheville as JSON?',
      intro:
        'Ask for `dateFilter=today`. `locations=asheville` keeps events in Asheville and at known Asheville venues; leave it off to include nearby towns. Today means the current calendar day in Eastern time, including events that started earlier in the day. `limit=3` keeps this example short; it goes up to 100.',
      request: TODAY_URL,
      response: compactPage(
        [YOGA, STRING_BAND, TRIVIA],
        'MjAyNi0xMC0wMlQyMzozMDowMC4wMDAwMDBaXzRiNDM3YTE4LWI1NTUtNDg1Mi05YzM5LTVjMzA3MzQ2ZGZmOA'
      ),
    },
    {
      id: 'free-this-weekend',
      title: 'What free events are happening this weekend?',
      intro:
        '`dateFilter=weekend` covers Friday through Sunday of this week, or what is left of the current weekend. `priceFilter=confirmedFree` keeps events the source lists as free; `priceFilter=free` also includes events with no listed price, which are often free (see [prices](#prices)).',
      request: `${API_URL}?format=compact&dateFilter=weekend&locations=asheville&priceFilter=confirmedFree&limit=10`,
      response: json(VOLUNTEER),
      responseLabel: 'One event from the response',
    },
    {
      id: 'live-music',
      title: 'Where can I find live music?',
      intro:
        'Filter by tag with `tagsInclude`. Tags are exact and case-sensitive; list several with commas to match any of them (`tagsInclude=Live%20Music,Comedy`), and use `tagsExclude` to drop some. Tags are assigned by AI after an event is collected, so a brand-new listing may not have any yet.',
      request: `${API_URL}?format=compact&tagsInclude=Live%20Music&limit=10`,
      response: json(STRING_BAND),
      responseLabel: 'One event from the response',
      more: (
        <>
          <p>The main tags:</p>
          <p className="flex flex-wrap gap-1.5">
            {TAG_CATEGORIES.flatMap((category) => category.tags).map((tag) => (
              <Code key={tag}>{tag}</Code>
            ))}
          </p>
          <p>
            {md(
              'Events can also carry more specific tags, like `Bluegrass`, which filter the same way. The full export shows each event’s `tags`.'
            )}
          </p>
        </>
      ),
    },
    {
      id: 'search',
      title: 'How do I search for events?',
      intro:
        '`search` is a case-insensitive substring match against the title, description, organizer and location. Separate alternatives with commas: `search=jazz,blues` returns events that mention either word. Tags and AI summaries are not searched, so combine `search` with `tagsInclude` when you want both.',
      request: `${API_URL}?format=compact&search=jazz,blues&limit=10`,
      response: json(JAZZ),
      responseLabel: 'One event from the response',
    },
    {
      id: 'dates',
      title: 'How do I choose specific dates?',
      intro:
        'Use `dateFilter=custom` with `dateStart` and, optionally, `dateEnd`, both `YYYY-MM-DD` in Eastern time. `dateEnd` is inclusive; without it you get `dateStart` alone. To pick days of the week instead, use `dateFilter=dayOfWeek&days=5,6` (`0` is Sunday), and narrow by part of the day with `times=evening`.',
      request: `${API_URL}?format=compact&dateFilter=custom&dateStart=${rangeStart}&dateEnd=${rangeEnd}&limit=10`,
      response: json(BLUES),
      responseLabel: 'One event from the response',
    },
    {
      id: 'next-page',
      title: 'How do I retrieve the next page?',
      intro:
        'Repeat the request with `cursor` set to the `nextCursor` you got back, until `hasMore` is `false`; the [paging rules](#paging) cover the details. This continues the first example on this page:',
      request: `${TODAY_URL}&cursor={nextCursor}`,
      open: false,
      response: compactPage([JAZZ], null),
      more: (
        <>
          <p>A loop that collects every event for a weekend:</p>
          <CodeSample label="JavaScript" note="" body={PAGING_LOOP} />
        </>
      ),
    },
    {
      id: 'full-and-markdown',
      title: 'How do I get full records or Markdown?',
      intro:
        'Leave out `format` (or send `format=full`) to get every matching upcoming event with all fields: description, source, organizer, ZIP code, tags, scores and timestamps. Full mode is not paginated, so `limit` and `cursor` are ignored. Two fields differ from compact mode: `startDate` is a UTC timestamp (see [dates and time zone](#time-zone)), and `url` is the original source listing rather than the AVL GO page. The OpenAPI spec lists every field and its type.',
      request: `${API_URL}?${FILTERS_FOR_FULL}`,
      response: FULL_RESPONSE,
      collapsed: true,
      more: (
        <>
          <p>
            {md(
              'The Markdown export takes the same filters (not `format`, `limit` or `cursor`) and returns a readable list that links to the source listings, with descriptions cut to 500 characters. Its `search` treats the whole value as one phrase, commas included.'
            )}
          </p>
          <RequestUrl url={`${MARKDOWN_URL}?${FILTERS_FOR_FULL}`} />
          <Collapsed>
            <CodeSample label="Example response (text/markdown)" body={MARKDOWN_RESPONSE} />
          </Collapsed>
        </>
      ),
    },
  ];

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* React hoists this into <head>: points API clients at the machine-readable spec */}
      <link rel="service-desc" href="/openapi.json" type="application/vnd.oai.openapi+json" />

      <Header />

      <div className="flex-grow">
        <article className="mx-auto max-w-3xl px-4 pb-16 pt-8 text-[15px] leading-relaxed text-gray-700 sm:px-6 sm:pt-12 lg:px-8 dark:text-gray-300">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            Developers
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white">
            Free Asheville Events API
          </h1>
          <p className="mt-4 text-base sm:text-lg">
            AVL GO collects upcoming events in Asheville, NC and nearby Western North Carolina towns
            from venue calendars, ticketing sites, Meetup, libraries, local government calendars and
            community listings, and serves them through a free, read-only JSON API. No API key or
            sign-up needed.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            {[
              ['OpenAPI spec', `${SITE_URL}/openapi.json`],
              ['llms.txt', `${SITE_URL}/llms.txt`],
              ['Compact JSON', `${API_URL}?format=compact&limit=20`],
              ['Full JSON export', API_URL],
              ['Markdown export', MARKDOWN_URL],
            ].map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="rounded-full bg-white px-3.5 py-1.5 font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-800 dark:hover:bg-gray-800"
              >
                {label}
              </a>
            ))}
          </div>

          <aside
            aria-labelledby="for-ai-assistants"
            className="mt-8 rounded-xl border border-brand-200 bg-brand-50/70 p-5 dark:border-brand-800 dark:bg-brand-900/30"
          >
            <h2
              id="for-ai-assistants"
              className="font-display text-lg font-semibold text-gray-900 dark:text-white"
            >
              For AI assistants
            </h2>
            <ul className="mt-3 space-y-2 text-sm sm:text-[15px]">
              {AI_NOTES.map(([label, text]) => (
                <li key={label}>
                  <strong className="text-gray-900 dark:text-white">{label}:</strong> {md(text)}
                </li>
              ))}
            </ul>
          </aside>

          <nav aria-label="On this page" className="mt-8">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">On this page</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-gray-400">
              {[{ id: 'quick-start', title: 'Quick start' }, ...questions].map(({ id, title }) => (
                <li key={id}>{md(`[${title}](#${id})`)}</li>
              ))}
              <li>
                {md(
                  '[Response fields](#fields), [parameters](#parameters) and [usage notes](#good-to-know)'
                )}
              </li>
            </ul>
          </nav>

          <Section id="quick-start" title="Quick start">
            <p>
              {md(
                `Everything goes through one endpoint, \`${API_URL}\`. Add \`format=compact\` for small, paginated records; without it you get the full export, every matching upcoming event with every field in one response.`
              )}
            </p>
            <CodeSample
              label="Shell"
              note=""
              body={`curl "${QUICK_URL}"`}
              copy={`curl "${QUICK_URL}"`}
            />
          </Section>

          {questions.map((question) => (
            <Section key={question.id} id={question.id} title={question.title}>
              <p>{md(question.intro)}</p>
              <RequestUrl url={question.request} open={question.open} />
              {question.collapsed ? (
                <Collapsed>
                  <CodeSample body={question.response} />
                </Collapsed>
              ) : (
                <CodeSample label={question.responseLabel} body={question.response} />
              )}
              {question.more}
            </Section>
          ))}

          <Section id="fields" title="What does each compact field mean?">
            <RefTable headers={['Field', 'Type', 'Meaning']} rows={COMPACT_FIELDS} />
          </Section>

          <Section id="parameters" title="Which parameters can I use?">
            <p>
              {md(
                'Every parameter is optional and works the same in compact and full mode. `format`, `limit` and `cursor` are JSON-only; the Markdown export takes the rest. An event has to pass every parameter you send; within a comma list, any one value counts. Except in `search`, `times` and `days`, list values are used exactly as sent, so put no space after a comma.'
              )}
            </p>
            <RefTable headers={['Parameter', 'Values', 'What it does']} rows={PARAMETERS} />
          </Section>

          <Section id="good-to-know" title="What else should I know?">
            {NOTES.map((note) => (
              <div key={note.title} id={note.id} className="scroll-mt-6">
                <h3 className="font-semibold text-gray-900 dark:text-white">{note.title}</h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-gray-400">
                  {note.items.map((item) => (
                    <li key={item}>{md(item)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        </article>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="mb-2">
          <a
            href="https://github.com/MattB543/asheville-event-feed"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            Open-sourced
          </a>{' '}
          and built by{' '}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            Matt
          </a>{' '}
          at Brooks Solutions, LLC.
        </p>
        <p>
          © {new Date().getFullYear()} AVL GO. Not affiliated with AVL Today, Eventbrite, Facebook
          Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
