import { describe, expect, it } from 'vitest';
import { withSettings } from '@/lib/seasons';
import { christmasWeekend, holidayLastDay, holidayWall } from './config';

describe('christmasWeekend', () => {
  it('is the Friday to Sunday before Christmas Day', () => {
    expect(christmasWeekend(2026)).toEqual({ from: '2026-12-18', to: '2026-12-20' });
    // Christmas Eve on a Sunday is still that weekend
    expect(christmasWeekend(2028)).toEqual({ from: '2028-12-22', to: '2028-12-24' });
    // Christmas on a Sunday: the weekend before, not Christmas itself
    expect(christmasWeekend(2022)).toEqual({ from: '2022-12-16', to: '2022-12-18' });
  });
});

describe("New Year's, which runs across Jan 1", () => {
  const seasons = withSettings(new Map());

  it('ends on the Jan 1 after its start, whichever side of midnight today is', () => {
    expect(holidayLastDay('newyear', seasons, '2026-12-28')).toBe('2027-01-01');
    expect(holidayLastDay('newyear', seasons, '2027-01-01')).toBe('2027-01-01');
    // Before it starts, the next run
    expect(holidayLastDay('newyear', seasons, '2026-11-10')).toBe('2027-01-01');
  });

  it("puts the wall on the New Year's Eve of the run under way", () => {
    expect(holidayWall('newyear', seasons, '2027-01-01')).toEqual({
      from: '2026-12-31',
      to: '2026-12-31',
    });
    expect(holidayWall('newyear', seasons, '2026-12-27').from).toBe('2026-12-31');
  });
});
