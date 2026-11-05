import { describe, expect, it } from 'vitest';
import { getDayBoundariesEastern, parseAsEastern } from './timezone';

// `npm test` runs with TZ=UTC, as Vercel does, so server-local time can't hide a mistake
describe('Eastern time', () => {
  it('parses a time in EDT and in EST', () => {
    expect(parseAsEastern('2026-07-04', '19:00:00').toISOString()).toBe('2026-07-04T23:00:00.000Z');
    expect(parseAsEastern('2026-12-24', '19:00:00').toISOString()).toBe('2026-12-25T00:00:00.000Z');
  });

  it('gets midnight right on the day the clocks fall back', () => {
    expect(parseAsEastern('2026-11-01', '00:00:00').toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('spans a fall-back day as 25 hours', () => {
    const { start, end } = getDayBoundariesEastern('2026-11-01');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });
});
