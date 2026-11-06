import { describe, expect, it } from 'vitest';
import { realUpdates, type EventForVerification } from './eventVerification';

const event = (over: Partial<EventForVerification> = {}): EventForVerification => ({
  id: 'e1',
  title: 'Bluegrass Jam',
  description: 'A long enough description of the weekly bluegrass jam downstairs.',
  startDate: new Date('2026-11-07T00:00:00Z'),
  location: 'Jack of the Wood',
  organizer: null,
  price: '$10',
  url: 'https://example.com/jam',
  source: 'AVL_TODAY',
  lastSeenAt: null,
  verifyAttempts: 0,
  editedFields: {},
  ...over,
});

describe('what verify writes from the source page', () => {
  it('takes a changed price and venue', () => {
    expect(realUpdates(event(), { price: '$12', location: 'Upstairs' })).toEqual({
      price: '$12',
      location: 'Upstairs',
    });
  });

  it('leaves fields an admin edited, even ones they emptied', () => {
    const edited = event({ price: null, editedFields: { price: '$10', location: 'Old Venue' } });
    expect(realUpdates(edited, { price: '$12', location: 'Upstairs' })).toBeUndefined();
  });
});
