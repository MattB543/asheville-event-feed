import { describe, expect, it } from 'vitest';
import type { CampCard, Milestone } from './contract';
import type { BundleLogEntry, SourceBundle } from './extract';
import { nearlySameName } from './importCamps';
import {
  inBoth,
  keepUnreadDates,
  lineChange,
  nextBaseline,
  readState,
  watchedUrls,
} from './refresh';
import { pageId, readBaseline } from './sourceLines';

const CAMP = 'https://a.org/camp';
const REG = 'https://reg.example/x';

/** A bundle from its log and, per page URL, the hashes of the lines read there. */
function bundle(log: BundleLogEntry[], lines: Record<string, string[]> = {}): SourceBundle {
  return {
    pages: log.filter((entry) => !entry.error).map((entry) => ({ url: entry.url, text: '' })),
    log,
    lines: Object.entries(lines).flatMap(([url, hashes]) =>
      hashes.map((hash) => ({ hash, text: `line ${hash}`, page: pageId(url) }))
    ),
  };
}
const ok = (url: string, role: BundleLogEntry['role'] = 'seed'): BundleLogEntry => ({
  url,
  chars: 10,
  role,
});
const bad = (
  url: string,
  role: BundleLogEntry['role'],
  error: string,
  gone = false
): BundleLogEntry => ({ url, chars: 0, role, error, gone });
const at = (url: string, hash: string) => `${pageId(url)}:${hash}`;

describe('readState', () => {
  it('goes ahead when a followed link or a cited page fails', () => {
    const state = readState(
      bundle([
        ok(CAMP),
        bad('https://a.org/camp/?share=twitter', 'link', 'fetch: thin page (26 chars)'),
        bad(REG, 'evidence', 'fetch: HTTP 403'),
        bad('https://a.org/old.pdf', 'link', 'fetch: HTTP 404', true),
      ])
    );
    expect(state.unreadable).toBeNull();
    // The gone page isn't a failure: it just isn't there
    expect(state.failed).toEqual(['https://a.org/camp/?share=twitter', REG]);
  });

  it("fails when none of the provider's own pages could be read", () => {
    expect(
      readState(bundle([bad(CAMP, 'seed', 'fetch: HTTP 429'), ok(REG, 'evidence')])).unreadable
    ).toMatch(/none of the provider's own pages/);
    // Gone seeds too: a home page alone is no ground for replacing the cards
    expect(
      readState(bundle([bad(CAMP, 'seed', 'fetch: HTTP 404', true), ok('https://a.org/', 'link')]))
        .unreadable
    ).toMatch(/none of the provider's own pages/);
  });

  it('goes ahead when one of several seeds is gone', () => {
    const state = readState(
      bundle([ok(CAMP), bad('https://a.org/summer', 'seed', 'fetch: HTTP 404', true)])
    );
    expect(state).toEqual({ failed: [], unreadable: null });
  });

  it('fails when nothing could be read', () => {
    const state = readState(
      bundle([bad('https://a.org/', 'seed', 'fetch: fetch failed (getaddrinfo ENOTFOUND a.org)')])
    );
    expect(state.unreadable).toMatch(/no page could be read/);
  });

  it("doesn't count a social page, which is never read", () => {
    const state = readState(
      bundle([
        ok(CAMP),
        bad('https://www.facebook.com/a', 'seed', 'social page: not fetched (login wall)'),
      ])
    );
    expect(state).toEqual({ failed: [], unreadable: null });
  });
});

describe('lineChange and inBoth', () => {
  it('finds added and removed lines', () => {
    const change = lineChange(
      [at(CAMP, 'a'), at(CAMP, 'b')],
      bundle([ok(CAMP)], { [CAMP]: ['b', 'c'] })
    );
    expect(change.added.map((line) => line.hash)).toEqual(['c']);
    expect(change.removed).toEqual([at(CAMP, 'a')]);
  });

  it("keeps an unread page's lines, and still sees a line gone from a page that was read", () => {
    // The registration page is blocked today; the camp page dropped its deadline line
    const stored = [at(CAMP, 'deadline'), at(CAMP, 'dates'), at(REG, 'opens')];
    const change = lineChange(
      stored,
      bundle([ok(CAMP), bad(REG, 'evidence', 'fetch: HTTP 403')], { [CAMP]: ['dates'] })
    );
    expect(change.removed).toEqual([at(CAMP, 'deadline')]);
    expect(change.added).toEqual([]);
  });

  it("drops a gone page's lines", () => {
    const change = lineChange(
      [at(CAMP, 'a'), at(REG, 'opens')],
      bundle([ok(CAMP), bad(REG, 'evidence', 'fetch: HTTP 404', true)], { [CAMP]: ['a'] })
    );
    expect(change.removed).toEqual([at(REG, 'opens')]);
  });

  it("doesn't take the same text on a page it has never read for news", () => {
    const change = lineChange(
      [at(CAMP, 'a')],
      bundle([ok(CAMP), ok(REG, 'evidence')], { [CAMP]: ['a'], [REG]: ['a'] })
    );
    expect(change).toEqual({ added: [], removed: [] });
  });

  it('sees two pages swap their dates', () => {
    const stored = [at(CAMP, 'jan5'), at(REG, 'jan15')];
    const change = lineChange(
      stored,
      bundle([ok(CAMP), ok(REG, 'evidence')], { [CAMP]: ['jan15'], [REG]: ['jan5'] })
    );
    expect(change.added.map((line) => line.hash).sort()).toEqual(['jan15', 'jan5']);
    expect(change.removed.sort()).toEqual([at(CAMP, 'jan5'), at(REG, 'jan15')].sort());
  });

  it("leaves alone a page that wasn't among the ones read this time", () => {
    // The registration links take turns: today's read didn't include REG at all
    const change = lineChange(
      [at(CAMP, 'a'), at(REG, 'opens')],
      bundle([ok(CAMP)], { [CAMP]: ['a'] })
    );
    expect(change).toEqual({ added: [], removed: [] });
  });

  it('never counts a line known to be unstable', () => {
    const change = lineChange(
      [at(CAMP, 'a'), '~spin'],
      bundle([ok(CAMP)], { [CAMP]: ['a', 'spin'] })
    );
    expect(change).toEqual({ added: [], removed: [] });
  });

  it('keeps only what two reads agree on', () => {
    // A rotating line differs on each read; the new date shows on both
    const stored = [at(CAMP, 'old')];
    const first = lineChange(stored, bundle([ok(CAMP)], { [CAMP]: ['old', 'spin1', 'date'] }));
    const second = lineChange(stored, bundle([ok(CAMP)], { [CAMP]: ['old', 'spin2', 'date'] }));
    const both = inBoth(first, second);
    expect(both.added.map((line) => line.hash)).toEqual(['date']);
    expect(both.removed).toEqual([]);
  });
});

describe('nextBaseline', () => {
  it('remembers lines the two reads disagree on, so a rotating list settles', () => {
    const first = bundle([ok(CAMP)], { [CAMP]: ['fact', 'spin1'] });
    const second = bundle([ok(CAMP)], { [CAMP]: ['fact', 'spin2'] });
    const stored = nextBaseline(null, first, second, second);
    const baseline = readBaseline(stored);
    expect(baseline.lines).toEqual([{ page: pageId(CAMP), hash: 'fact' }]);
    expect([...baseline.unstable].sort()).toEqual(['spin1', 'spin2']);
    // The next check reads a third item of the list and one seen before: nothing new, nothing gone
    const later = lineChange(stored, bundle([ok(CAMP)], { [CAMP]: ['fact', 'spin1'] }));
    expect(later).toEqual({ added: [], removed: [] });
  });

  it("keeps what was stored for a page that couldn't be read", () => {
    const old = [at(CAMP, 'a'), at(REG, 'opens')];
    const read = bundle([ok(CAMP), bad(REG, 'evidence', 'fetch: HTTP 403')], {
      [CAMP]: ['a', 'b'],
    });
    expect(nextBaseline(old, read, read, read)).toEqual(
      [at(CAMP, 'a'), at(CAMP, 'b'), at(REG, 'opens')].sort()
    );
  });

  it("keeps a page's stored lines when it wasn't read, or the model never saw it", () => {
    const old = [at(CAMP, 'a'), at(REG, 'opens')];
    // Not among the pages read this time
    const read = bundle([ok(CAMP)], { [CAMP]: ['a'] });
    expect(nextBaseline(old, read, read, read)).toEqual(old.sort());
    // Failed for the model's read, then read after the extraction with a new date on it
    const second = bundle([ok(CAMP), bad(REG, 'evidence', 'not read: out of time')], {
      [CAMP]: ['a'],
    });
    const next = bundle([ok(CAMP), ok(REG, 'evidence')], { [CAMP]: ['a'], [REG]: ['newdate'] });
    expect(nextBaseline(old, second, second, next)).toEqual(old.sort());
  });

  it("doesn't call a line unstable because its page failed on one read", () => {
    const first = bundle([ok(CAMP), ok(REG, 'evidence')], { [CAMP]: ['a'], [REG]: ['opens'] });
    const second = bundle([ok(CAMP), bad(REG, 'evidence', 'fetch: HTTP 403')], { [CAMP]: ['a'] });
    expect(readBaseline(nextBaseline(null, first, second, first)).unstable.size).toBe(0);
  });
});

describe('watchedUrls', () => {
  const card = (registrationUrl: string | null, dates: string[]): CampCard =>
    ({
      registration_url: registrationUrl,
      registration: dates.map((url) => ({ url })),
    }) as unknown as CampCard;

  it("takes every date's page first, then some registration links", () => {
    const links = Array.from(
      { length: 12 },
      (_, n) => `https://reg.example/${String(n).padStart(2, '0')}`
    );
    const cards = [
      card('https://reg.example/open', ['https://z.org/dates', 'https://a.org/dates']),
      ...links.map((link) => card(link, [])),
    ];
    const urls = watchedUrls(cards, '2026-11-19');
    expect(urls.slice(0, 2)).toEqual(['https://a.org/dates', 'https://z.org/dates']);
    expect(urls).toHaveLength(8);
    // Thirteen links, six a day: over thirteen days every one gets read
    const seen = new Set<string>();
    for (let day = 1; day <= 13; day++)
      for (const url of watchedUrls(cards, `2026-12-${String(day).padStart(2, '0')}`))
        seen.add(url);
    expect(seen.size).toBe(15);
    expect(watchedUrls(cards, '2026-11-19')).toEqual(urls);
  });

  it('leaves out social pages and links that are not web pages', () => {
    expect(
      watchedUrls(
        [card('https://www.facebook.com/camp', ['webcal://a.org/?ical=1']), card(null, [])],
        '2026-11-19'
      )
    ).toEqual([]);
  });
});

describe('keepUnreadDates', () => {
  const milestone = (audience: string, kind: string, url: string, date: string) =>
    ({ audience, kind, url, date }) as unknown as Milestone;
  const card = (registration: Milestone[]) => ({ registration }) as unknown as CampCard;

  it('keeps a date whose page went unread when the new card has none of its kind', () => {
    const old = card([milestone('public', 'opens', REG, '2027-01-15')]);
    const kept = keepUnreadDates(old, card([]), new Set([REG]));
    expect(kept.registration).toHaveLength(1);
  });

  it('lets the new card win when it has that date, or when the page was read', () => {
    const old = card([milestone('public', 'opens', REG, '2027-01-15')]);
    const fresh = card([milestone('public', 'opens', CAMP, '2027-01-20')]);
    expect(keepUnreadDates(old, fresh, new Set([REG]))).toBe(fresh);
    expect(keepUnreadDates(old, card([]), new Set()).registration).toEqual([]);
    expect(keepUnreadDates(undefined, fresh, new Set([REG]))).toBe(fresh);
  });

  it('keeps an "other" date from an unread page beside another group\'s date', () => {
    // Two groups, two pages (Camp Greenville's Leadership Development): one page is blocked today
    const old = card([
      milestone('other', 'opens', REG, '2027-01-15'),
      milestone('other', 'opens', CAMP, '2027-02-01'),
    ]);
    const fresh = card([milestone('other', 'opens', CAMP, '2027-02-01')]);
    expect(keepUnreadDates(old, fresh, new Set([REG])).registration).toHaveLength(2);
  });
});

describe('nearlySameName', () => {
  it('takes a typo for the same program', () => {
    expect(nearlySameName('Brevard Distance Runners Camp', 'Brevvard Distance Runners Camp')).toBe(
      true
    );
    expect(nearlySameName('Summer Art Camp', 'Summer Art-Camp')).toBe(true);
    expect(nearlySameName('Mountain Explorers Camp', 'Mountian Explorers Camp')).toBe(false);
    expect(nearlySameName('Mountain Explorers Camp', 'Mountan Explorers Camp')).toBe(true);
  });

  it('keeps different programs apart', () => {
    expect(nearlySameName('Camp A', 'Camp B')).toBe(false);
    expect(nearlySameName('Adventure Camp Week 1', 'Adventure Camp Week 2')).toBe(false);
    expect(nearlySameName('Junior High Camp', 'Senior High Camp')).toBe(false);
    expect(
      nearlySameName("Men's Basketball Prospect Camp", "Women's Basketball Prospect Camp")
    ).toBe(false);
    expect(nearlySameName('Football Skills Camp', 'Softball Skills Camp')).toBe(false);
    expect(nearlySameName('Junior Camp I', 'Junior Camp II')).toBe(false);
    expect(nearlySameName('Summer Music Camp', 'Summer Music Camp (day)')).toBe(false);
  });
});
