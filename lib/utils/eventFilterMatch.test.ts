import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isFreeEvent,
  matchesEventFilters,
  parsePrice,
  type EventMatchFilters,
  type FilterableEvent,
  type FilterableOccurrence,
} from './eventFilterMatch';
import { computeDateFilterBounds } from './dateFilters';

describe('price helpers', () => {
  it('reads thousands separators', () => {
    expect(parsePrice('$1,200')).toBe(1200);
    expect(parsePrice('$15 - $25')).toBe(15);
  });

  const cases: Array<[string | null, boolean]> = [
    [null, true],
    ['', true],
    ['Unknown', true],
    ['TBD', true],
    ['Free', true],
    ['Donation', true],
    ['$0', true],
    ['$5', false],
    ['Ticketed', false],
  ];
  // Plain names: vitest's own test titles would read "$5" as a placeholder
  for (const [price, free] of cases) {
    it(`isFreeEvent(${JSON.stringify(price)}) is ${free}`, () => {
      expect(isFreeEvent(price)).toBe(free);
    });
  }
});

// Friday, Nov 6, 2026 at 10 AM Eastern
const NOW = new Date('2026-11-06T15:00:00Z');

const NO_FILTERS: EventMatchFilters = {
  search: '',
  dateFilter: 'all',
  customDateRange: { start: null, end: null },
  selectedDays: [],
  selectedTimes: [],
  priceFilter: 'any',
  customMaxPrice: null,
  tagsInclude: [],
  tagsExclude: [],
  selectedLocations: [],
  selectedZips: [],
  blockedHosts: [],
  blockedKeywords: [],
};

const SHOW: FilterableEvent = {
  title: 'Bluegrass Jam',
  organizer: 'Jack of the Wood',
  location: '95 Patton Ave, Asheville, NC',
  zip: '28801',
  price: '$10',
  tags: ['Live Music'],
};
// Tonight at 7 PM Eastern
const TONIGHT: FilterableOccurrence[] = [{ startDate: new Date('2026-11-07T00:00:00Z') }];

describe('feed filters', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const matches = (
    filters: Partial<EventMatchFilters>,
    event: Partial<FilterableEvent> = {},
    occurrences = TONIGHT
  ) =>
    matchesEventFilters(
      { ...SHOW, ...event },
      occurrences,
      { ...NO_FILTERS, ...filters },
      computeDateFilterBounds()
    );

  it('passes everything with no filters set', () => {
    expect(matches({})).toBe(true);
  });

  it('matches a search inside one field only', () => {
    expect(matches({ search: 'bluegrass' })).toBe(true);
    expect(matches({ search: 'jam jack' })).toBe(false);
  });

  it('puts a 7 PM show in today and the evening, by Eastern time', () => {
    expect(matches({ dateFilter: 'today' })).toBe(true);
    expect(matches({ dateFilter: 'tomorrow' })).toBe(false);
    expect(matches({ selectedTimes: ['evening'] })).toBe(true);
    expect(matches({ selectedTimes: ['morning'] })).toBe(false);
  });

  it('needs one showing that passes both the date and the time', () => {
    const showings = [
      { startDate: new Date('2026-11-06T15:00:00Z') }, // today 10 AM
      { startDate: new Date('2026-11-08T00:00:00Z') }, // tomorrow 7 PM
    ];
    expect(matches({ dateFilter: 'today', selectedTimes: ['evening'] }, {}, showings)).toBe(false);
    expect(matches({ dateFilter: 'tomorrow', selectedTimes: ['evening'] }, {}, showings)).toBe(
      true
    );
  });

  it('lets an event with no listed time through any time filter', () => {
    const unknown = [{ startDate: new Date('2026-11-06T05:00:00Z'), timeUnknown: true }];
    expect(matches({ selectedTimes: ['morning'] }, {}, unknown)).toBe(true);
  });

  it('filters by price', () => {
    expect(matches({ priceFilter: 'free' })).toBe(false);
    expect(matches({ priceFilter: 'free' }, { price: 'Unknown' })).toBe(true);
    expect(matches({ priceFilter: 'under20' })).toBe(true);
    expect(matches({ priceFilter: 'custom', customMaxPrice: 5 })).toBe(false);
  });

  it('includes and excludes tags, and an untagged event fails an exclude', () => {
    expect(matches({ tagsInclude: ['Live Music', 'Comedy'] })).toBe(true);
    expect(matches({ tagsInclude: ['Comedy'] })).toBe(false);
    expect(matches({ tagsExclude: ['Live Music'] })).toBe(false);
    expect(matches({ tagsExclude: ['Comedy'] }, { tags: null })).toBe(false);
  });

  it('hides summer camps unless the camp tag is picked', () => {
    const camp = { source: 'CAMPS', tags: ['Summer Camp'] };
    expect(matches({}, camp)).toBe(false);
    expect(matches({ tagsInclude: ['Summer Camp'] }, camp)).toBe(true);
  });

  it('counts an Asheville zip as Asheville', () => {
    expect(matches({ selectedLocations: ['asheville'] }, { location: 'Somewhere' })).toBe(true);
    expect(
      matches(
        { selectedLocations: ['asheville'] },
        { location: 'Main St, Brevard, NC', zip: '28712' }
      )
    ).toBe(false);
  });

  it('drops blocked hosts and title keywords', () => {
    expect(matches({ blockedHosts: ['jack of the'] })).toBe(false);
    expect(matches({ blockedKeywords: ['JAM'] })).toBe(false);
  });
});
