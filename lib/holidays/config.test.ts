import { describe, expect, it } from 'vitest';
import { christmasWeekend } from './config';

describe('christmasWeekend', () => {
  it('is the Friday to Sunday before Christmas Day', () => {
    expect(christmasWeekend(2026)).toEqual({ from: '2026-12-18', to: '2026-12-20' });
    // Christmas Eve on a Sunday is still that weekend
    expect(christmasWeekend(2028)).toEqual({ from: '2028-12-22', to: '2028-12-24' });
    // Christmas on a Sunday: the weekend before, not Christmas itself
    expect(christmasWeekend(2022)).toEqual({ from: '2022-12-16', to: '2022-12-18' });
  });
});
