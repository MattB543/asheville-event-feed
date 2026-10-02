/** Offline regressions: npm run test:chat. Add --live for read-only database/model smoke checks. */
import assert from 'node:assert/strict';
import type { ChatCompletionMessage } from 'openai/resources/chat/completions';
import { CHAT_TOOLS, createChatToolSession, resolveSearchFilters } from '../lib/ai/chat/tools';
import { parseChatSearchState, isCalendarDate } from '../lib/ai/chat/types';
import { buildChatSystemPrompt } from '../lib/ai/chat/prompt';
import { runEventChat, type ChatModel } from '../lib/ai/chat/runner';
import { createChatModel } from '../lib/ai/chat/model';
import { queryFilteredEvents, type EventFilterParams } from '../lib/db/queries/events';
import { getDateStringEastern } from '../lib/utils/timezone';
import { parsePrice } from '../lib/utils/eventFilterMatch';

const emptyPage = { events: [], hasMore: false, nextCursor: null, totalCount: 0 };
const cursor = '2026-11-12T23:00:00.000Z_11111111-1111-1111-1111-111111111111';
const nullArgs = Object.fromEntries(
  Object.keys(
    CHAT_TOOLS[0].type === 'function' ? (CHAT_TOOLS[0].function.parameters?.properties ?? {}) : {}
  )
    .filter((key) => key !== 'nextPage')
    .map((key) => [key, null])
);
const call = (name: string, args: unknown): ChatCompletionMessage => ({
  role: 'assistant',
  content: null,
  refusal: null,
  tool_calls: [
    { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ],
});
const ready: ChatCompletionMessage = { role: 'assistant', content: 'READY', refusal: null };

async function offline() {
  assert(isCalendarDate('2028-02-29'));
  assert(!isCalendarDate('2026-02-29'));
  assert(!isCalendarDate('2026-13-01'));
  const original = {
    search: 'jazz',
    dateFilter: 'custom' as const,
    dateStart: '2026-11-01',
    dateEnd: '2026-11-30',
    locations: ['Black Mountain'],
  };
  const refined = resolveSearchFilters(original, {
    ...nullArgs,
    priceFilter: 'free',
    nextPage: false,
  });
  assert.equal(refined.search, 'jazz');
  assert.equal(refined.dateStart, '2026-11-01');
  assert.equal(refined.priceFilter, 'free');
  assert.equal(refined.strictPrice, true);
  const anytime = resolveSearchFilters(refined, {
    dateStart: '',
    dateEnd: '',
    search: '',
    keywords: ['comedy'],
    locations: [],
  });
  assert.equal(anytime.dateFilter, 'all');
  assert.equal(anytime.dateEnd, undefined);
  assert.equal(anytime.search, undefined);
  assert.deepEqual(anytime.keywords, ['comedy']);
  assert.throws(() => resolveSearchFilters(original, { dateStart: '2026-11-31' }));
  assert.throws(() => resolveSearchFilters(original, { dateStart: '2026-12-01' }));
  assert.throws(() => resolveSearchFilters({}, { priceFilter: 'custom' }));
  assert.throws(() => resolveSearchFilters({}, { maxPrice: -1 }));
  assert.equal(
    resolveSearchFilters({}, { priceFilter: 'under100', maxPrice: 30 }).priceFilter,
    'custom'
  );
  assert.equal(
    resolveSearchFilters({ priceFilter: 'custom', maxPrice: 30 }, { priceFilter: 'any' }).maxPrice,
    undefined
  );
  assert.throws(() => resolveSearchFilters({}, { times: ['night'] }));
  assert.throws(() => resolveSearchFilters({}, { days: [9] }));
  assert.throws(() =>
    resolveSearchFilters({}, { keywords: ['tribute'], excludeKeywords: ['tribute'] })
  );
  assert.throws(() => resolveSearchFilters({}, { minStartTime: '25:00' }));
  assert.throws(() => resolveSearchFilters({}, { minStartTime: '22:00', maxStartTime: '02:00' }));
  assert.equal(
    parseChatSearchState({ filters: original, nextCursor: 'malformed', hasMore: true })?.nextCursor,
    null
  );
  assert.equal(
    parseChatSearchState({ filters: original, nextCursor: cursor, hasMore: true })?.nextCursor,
    cursor
  );

  const params: EventFilterParams[] = [];
  const session = createChatToolSession(
    { search: 'jazz', zips: ['28801'], blockedHosts: ['Spam Host'] },
    undefined,
    {
      query: (filters) => {
        params.push(filters);
        return Promise.resolve(
          params.length === 1 ? { ...emptyPage, hasMore: true, nextCursor: cursor } : emptyPage
        );
      },
    }
  );
  await session.execute('search_events', {
    ...nullArgs,
    dateStart: '2027-05-01',
    dateEnd: '2027-05-31',
    days: [5],
    minStartTime: '19:00',
    priceFilter: 'custom',
    maxPrice: 30,
    nextPage: false,
  });
  assert.equal(params[0].dateEnd, '2027-05-31');
  assert.equal(params[0].dateFilter, 'custom');
  assert.deepEqual(params[0].days, [5]);
  assert.equal(params[0].search, 'jazz');
  assert.deepEqual(params[0].zips, ['28801']);
  assert.deepEqual(params[0].blockedHosts, ['Spam Host']);
  await session.execute('search_events', { ...nullArgs, nextPage: true });
  assert.equal(params[1].cursor, cursor);
  await assert.rejects(() =>
    session.execute('search_events', { nextPage: true, keywords: ['new search'] })
  );
  await session.execute('search_events', { nextPage: true });
  assert.equal(params.length, 2, 'Exhausted searches do not start over.');

  const responses = [
    call('search_events', { dateStart: '2026-02-30', nextPage: false }),
    call('search_events', { keywords: ['jazz'], nextPage: false }),
    ready,
  ];
  let streamEvidence = false;
  const model: ChatModel = {
    plan: (messages) => {
      if (
        messages.some(
          (message) =>
            message.role === 'tool' &&
            typeof message.content === 'string' &&
            message.content.includes('Invalid value for dateStart')
        )
      )
        streamEvidence = true;
      return Promise.resolve(responses.shift() ?? ready);
    },
    stream: (messages) => {
      assert(
        messages.some(
          (message) =>
            message.role === 'tool' &&
            typeof message.content === 'string' &&
            message.content.includes('"appliedFilters"')
        )
      );
      return Promise.resolve(
        (async function* () {
          yield 'Verified response';
        })()
      );
    },
  };
  let text = '';
  await runEventChat({
    messages: [{ role: 'user', content: 'jazz' }],
    filters: {},
    model,
    session: createChatToolSession({}, undefined, { query: () => Promise.resolve(emptyPage) }),
    onSearch: () => Promise.resolve(),
    onToken: (token) => {
      text += token;
      return Promise.resolve();
    },
  });
  assert(streamEvidence, 'Invalid date arguments must reach the model as correctable errors.');
  assert.equal(text, 'Verified response');
  const prompt = buildChatSystemPrompt({}, {}, new Date('2026-10-02T02:00:00Z'));
  assert(prompt.includes('2026-10-01 (Thursday)'), 'Current date must use Eastern, not UTC.');
  console.log(
    'Offline chat regressions passed (filters, dates, validation, pagination, tool loop, Eastern time).'
  );
}

async function live() {
  const base: EventFilterParams = {
    dateFilter: 'all',
    limit: 100,
    useDefaultFilters: false,
    showDailyEvents: true,
  };
  const sample = await queryFilteredEvents(base);
  assert(sample.events.length > 0, 'Live smoke test needs upcoming events.');
  const reference = sample.events.find((event) => !event.timeUnknown) ?? sample.events[0];
  const keyword = reference.title;
  const literal = await queryFilteredEvents({ ...base, keywords: [keyword], keywordMatch: 'all' });
  assert(
    literal.events.some((event) => event.id === reference.id),
    'Literal title keyword should find the reference event.'
  );
  const date = getDateStringEastern(reference.startDate);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const combined = await queryFilteredEvents({
    ...base,
    keywords: [keyword],
    dateFilter: 'custom',
    dateStart: date,
    dateEnd: date,
    days: [day],
  });
  assert(combined.events.some((event) => event.id === reference.id));
  const wrongDay = await queryFilteredEvents({
    ...base,
    keywords: [keyword],
    dateFilter: 'custom',
    dateStart: date,
    dateEnd: date,
    days: [(day + 1) % 7],
  });
  assert.equal(wrongDay.events.length, 0, 'Weekdays must constrain custom date ranges.');
  const excluded = await queryFilteredEvents({
    ...base,
    keywords: [keyword],
    excludeKeywords: [keyword],
  });
  assert.equal(excluded.events.length, 0);
  const any = await queryFilteredEvents({
    ...base,
    keywords: ['unlikely literal __%_no_event_9483', keyword],
    keywordMatch: 'any',
  });
  assert(any.events.some((event) => event.id === reference.id));
  const all = await queryFilteredEvents({
    ...base,
    keywords: ['unlikely literal __%_no_event_9483', keyword],
    keywordMatch: 'all',
  });
  assert.equal(all.events.length, 0);
  const free = await queryFilteredEvents({ ...base, priceFilter: 'free', strictPrice: true });
  for (const event of free.events) {
    assert(event.price && /\d|\bfree\b/i.test(event.price));
    assert.equal(parsePrice(event.price), 0);
  }
  if (reference.location) {
    const venue = await queryFilteredEvents({
      ...base,
      keywords: [keyword],
      venue: reference.location,
    });
    assert(venue.events.some((event) => event.id === reference.id));
  }
  if (!reference.timeUnknown) {
    const time = reference.startDate.toLocaleTimeString('en-GB', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const exact = await queryFilteredEvents({
      ...base,
      keywords: [keyword],
      minStartTime: time,
      maxStartTime: time,
      includeUnknownTimes: false,
    });
    assert(exact.events.some((event) => event.id === reference.id));
  }
  console.log(
    'Read-only live database checks passed (literal/all/any/excluded keywords, date + weekday, venue, time, confirmed free price).'
  );
  const laterDate = new Date();
  laterDate.setUTCDate(laterDate.getUTCDate() + 15);
  const later = await queryFilteredEvents({
    ...base,
    dateFilter: 'custom',
    dateStart: getDateStringEastern(laterDate),
  });
  assert(later.events.length > 0, 'Should find database events beyond two weeks.');
  const details = await createChatToolSession({}).execute('get_event_details', {
    eventId: reference.id.slice(0, 6),
  });
  assert(
    typeof details === 'object' &&
      details !== null &&
      'id' in details &&
      details.id === reference.id
  );
  console.log('Live checks passed for searches beyond two weeks and event detail lookup.');

  const providers = process.argv.includes('--openrouter')
    ? ['openrouter' as const]
    : ['azure' as const];
  for (const provider of providers) {
    const realModel = createChatModel(provider, AbortSignal.timeout(180000));
    const searches: EventFilterParams[] = [];
    let text = '';
    const session = createChatToolSession({}, undefined, {
      query: (filters) => {
        searches.push(filters);
        return Promise.resolve(emptyPage);
      },
    });
    await runEventChat({
      messages: [
        {
          role: 'user',
          content:
            'Find jazz shows in November 2026 on Friday evenings under $30 at the Orange Peel. Exclude tribute shows.',
        },
      ],
      filters: {},
      model: realModel,
      session,
      onSearch: () => Promise.resolve(),
      onToken: (token) => {
        text += token;
        return Promise.resolve();
      },
    });
    const searchFilters = searches[searches.length - 1];
    assert(searchFilters, 'Model must call the search tool.');
    assert.equal(searchFilters.dateStart, '2026-11-01');
    assert.equal(searchFilters.dateEnd, '2026-11-30');
    assert.deepEqual(searchFilters.days, [5]);
    assert(
      searchFilters.maxPrice !== undefined &&
        searchFilters.maxPrice >= 29.99 &&
        searchFilters.maxPrice <= 30
    );
    assert.equal(
      searchFilters.priceFilter,
      'custom',
      'A numeric budget must be enforced, regardless of the model-selected preset.'
    );
    assert(searchFilters.venue?.toLowerCase().includes('orange peel'));
    assert(searchFilters.excludeKeywords?.some((term) => term.toLowerCase().includes('tribute')));
    assert(
      searchFilters.keywords?.some((term) => term.toLowerCase().includes('jazz')) ||
        searchFilters.search?.toLowerCase().includes('jazz')
    );
    assert(text.length > 0);
    console.log(
      `${provider} live model smoke test passed:`,
      JSON.stringify(searchFilters),
      text.slice(0, 500)
    );
    // A new date request must replace dates while keeping topic, venue and budget.
    const history = [
      {
        role: 'user' as const,
        content:
          'Find jazz shows in November 2026 on Friday evenings under $30 at the Orange Peel. Exclude tribute shows.',
      },
      { role: 'assistant' as const, content: text },
      { role: 'user' as const, content: 'How about May 2027 instead?' },
    ];
    const changed = createChatToolSession({}, session.state, {
      query: (filters) => {
        searches.push(filters);
        return Promise.resolve(emptyPage);
      },
    });
    await runEventChat({
      messages: history,
      filters: {},
      model: realModel,
      session: changed,
      onSearch: () => Promise.resolve(),
      onToken: () => Promise.resolve(),
    });
    assert.equal(changed.state.filters.dateStart, '2027-05-01');
    assert.equal(changed.state.filters.dateEnd, '2027-05-31');
    assert.deepEqual(changed.state.filters.days, [5]);
    assert.equal(changed.state.filters.maxPrice, searchFilters.maxPrice);
    assert(changed.state.filters.venue?.toLowerCase().includes('orange peel'));
    console.log(
      `${provider} follow-up smoke test passed (May 2027, preserving Friday, venue and budget).`
    );
  }
}

offline()
  .then(async () => {
    if (process.argv.includes('--live')) await live();
  })
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
