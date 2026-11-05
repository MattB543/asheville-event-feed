import { describe, expect, it } from 'vitest';
import { isFreeEvent, parsePrice } from './eventFilterMatch';

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
