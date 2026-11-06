import { describe, expect, it } from 'vitest';
import { DEAD_STATUSES, removableDeadLinks } from './deadLinks';

const dead = (source: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${source}-${i}`, source }));
const checked = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('which dead links a cleanup run removes', () => {
  it('only counts 404 and 410 as gone, never a block or an outage', () => {
    expect([404, 410].every((s) => DEAD_STATUSES.has(s))).toBe(true);
    expect([0, 403, 429, 500, 503].some((s) => DEAD_STATUSES.has(s))).toBe(false);
  });

  it('removes a few dead links from a source', () => {
    const result = removableDeadLinks(dead('MEETUP', 2), checked({ MEETUP: 10 }));
    expect(result.removable).toHaveLength(2);
    expect(result.skippedSources).toEqual([]);
  });

  it('skips a whole source when over a fifth of its links look dead, and only that source', () => {
    const links = [...dead('MEETUP', 3), ...dead('EVENTBRITE', 1)];
    const result = removableDeadLinks(links, checked({ MEETUP: 10, EVENTBRITE: 10 }));
    expect(result.skippedSources).toEqual(['MEETUP']);
    expect(result.removable.map((l) => l.source)).toEqual(['EVENTBRITE']);
  });

  it('allows exactly a fifth', () => {
    expect(removableDeadLinks(dead('MEETUP', 2), checked({ MEETUP: 10 })).skippedSources).toEqual(
      []
    );
  });

  it('trusts small samples: under 5 checked, every dead link counts', () => {
    const result = removableDeadLinks(dead('NC_STAGE', 4), checked({ NC_STAGE: 4 }));
    expect(result.removable).toHaveLength(4);
  });
});
