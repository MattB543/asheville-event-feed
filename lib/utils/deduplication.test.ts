import { describe, expect, it } from 'vitest';
import { findDuplicates, mergeFields, type EventForDedup } from './deduplication';

const event = (over: Partial<EventForDedup>): EventForDedup => ({
  id: 'a',
  title: 'Jazz Night with the Blue Ridge Trio',
  organizer: 'Grey Eagle',
  location: '185 Clingman Ave, Asheville, NC',
  startDate: new Date('2026-11-07T00:00:00Z'),
  price: '$15',
  description: 'An evening of jazz.',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  source: 'GREY_EAGLE',
  ...over,
});

describe('findDuplicates', () => {
  it('pairs the same show from two sources and keeps the one with a price', () => {
    // A listed price beats a longer description
    const venue = event({
      id: 'venue',
      price: 'Unknown',
      description: 'An evening of jazz, at length.',
    });
    const listing = event({ id: 'mx', source: 'MOUNTAIN_X', price: '$15' });
    const [group] = findDuplicates([venue, listing]);
    expect(group.keep.id).toBe('mx');
    expect(group.remove.map((e) => e.id)).toEqual(['venue']);
  });

  it('leaves different shows at the same time apart', () => {
    const jazz = event({ id: 'jazz' });
    const comedy = event({
      id: 'comedy',
      title: 'Stand-up Comedy Open Mic',
      organizer: 'Eulogy',
      location: 'Eulogy, Asheville, NC',
    });
    expect(findDuplicates([jazz, comedy])).toEqual([]);
  });

  it('never merges summer camp listings', () => {
    const camp = (id: string) => event({ id, title: 'Summer Camp Week', source: 'CAMPS' });
    expect(findDuplicates([camp('one'), camp('two')])).toEqual([]);
  });
});

describe('mergeFields', () => {
  it('takes the longest description and fills gaps, never overwriting the winner', () => {
    const keep = event({ id: 'k', price: 'Unknown', imageUrl: null, description: 'Short.' });
    const loser = event({
      id: 'l',
      price: '$20',
      imageUrl: 'https://example.com/poster.jpg',
      description: 'A much longer description of the same jazz show.',
      location: 'Somewhere else',
    });
    expect(mergeFields(keep, [loser])).toEqual({
      description: 'A much longer description of the same jazz show.',
      price: '$20',
      imageUrl: 'https://example.com/poster.jpg',
    });
  });

  it('returns nothing when the winner already has everything', () => {
    expect(
      mergeFields(event({ id: 'k' }), [event({ id: 'l', description: 'Tiny' })])
    ).toBeUndefined();
  });
});
