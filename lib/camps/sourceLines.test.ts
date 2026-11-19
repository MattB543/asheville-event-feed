import { describe, expect, it } from 'vitest';
import { isGone, isHttpUrl } from './fetchPageText';
import { factLines, hashLines, isHomePage, readBaseline, writeBaseline } from './sourceLines';

const today = '2026-11-19';
const texts = (text: string, homePage = false) =>
  factLines(text, { today, homePage }).map((line) => line.text);
const hashes = (text: string, homePage = false) =>
  factLines(text, { today, homePage })
    .map((line) => line.hash)
    .sort();

describe('factLines', () => {
  it('keeps lines that can state a camp fact', () => {
    expect(
      texts(
        [
          'Registration opens January 12 at 9:00 a.m.',
          'June 14-18',
          'January 5th',
          '$350',
          '9am - 3pm',
          'Rising 3rd - 5th grade',
          'Week 3 is FULL',
          'Summer Camp 2027',
        ].join('\n')
      )
    ).toHaveLength(8);
  });

  it('drops lines with nothing a parent reads as a fact', () => {
    expect(
      texts(['Our mission', 'About the campus', 'Donate', '7 + 15 =', '49'].join('\n'))
    ).toEqual([]);
  });

  it('ignores order, case and spacing', () => {
    expect(hashes('Summer  Camp 2027\nRegistration is open')).toEqual(
      hashes('REGISTRATION IS OPEN\nsummer camp 2027')
    );
  });

  it('drops text about the moment the page was read', () => {
    expect(
      texts(
        [
          'Open today until 5pm',
          'Posted 3 hours ago: summer camp news',
          '12 days 4 hours 33 minutes until camp',
          'Thursday, November 19, 2026',
          'November 19, 2026 10:42 AM',
          '11/19/2026',
          '© 2026 Camp Wayfarer',
          'info@campwayfarer.com',
        ].join('\n')
      )
    ).toEqual([]);
  });

  it('keeps a line about registration whatever else it says', () => {
    expect(texts('Registration opens tomorrow, January 5 at 9 AM')).toHaveLength(1);
    expect(texts('Registration opens November 19 at 8 AM')).toEqual([
      'registration opens november 19 at 8 am',
    ]);
  });

  it('ties a date or price to the camp line above it', () => {
    // Two audiences swapping dates is a change, though the same four lines are on the page
    const before =
      'Returning families registration\nJanuary 5\nNew families registration\nJanuary 15';
    const after =
      'Returning families registration\nJanuary 15\nNew families registration\nJanuary 5';
    expect(hashes(before)).not.toEqual(hashes(after));
  });

  it('ties a bare value to a plain heading above it too', () => {
    const before = 'Returning families\nJanuary 5\nNew families\nJanuary 15';
    const after = 'Returning families\nJanuary 15\nNew families\nJanuary 5';
    expect(hashes(before)).not.toEqual(hashes(after));
    expect(texts(before)).toEqual(['january 5', 'january 15']);
  });

  it('on a home page, counts a date or price only under a line naming camp or registration', () => {
    const page = [
      'Nov 21 - Holiday Market 5pm',
      'Gala 2027 tickets',
      'Summer Camp',
      'June 14-18',
      '$350',
      'FULL',
    ].join('\n');
    expect(texts(page, true)).toEqual(['summer camp', 'june 14-18', '$350', 'full']);
    expect(texts(page)).toHaveLength(6);
  });

  it("doesn't take a campus for a camp", () => {
    expect(texts('Visit our campus', true)).toEqual([]);
  });

  it('splits a long line into sentences', () => {
    const filler = 'We love the outdoors and everything about the mountains around us. '.repeat(4);
    expect(texts(`${filler}Camp registration opens January 5.`)).toEqual([
      'camp registration opens january 5.',
    ]);
  });
});

describe('the stored baseline', () => {
  it('round-trips page lines and unstable lines', () => {
    const stored = writeBaseline(
      [
        { page: 'p1', hash: 'a' },
        { page: 'p2', hash: 'a' },
        { page: 'p1', hash: 'spin' },
      ],
      new Set(['spin'])
    );
    expect(stored).toEqual(['p1:a', 'p2:a', '~spin']);
    // Bounded: the same 500 unstable hashes every time, not none
    const many = new Set(Array.from({ length: 600 }, (_, n) => `h${String(n).padStart(3, '0')}`));
    expect(writeBaseline([], many)).toHaveLength(500);
    const baseline = readBaseline(stored);
    expect(baseline.lines).toEqual([
      { page: 'p1', hash: 'a' },
      { page: 'p2', hash: 'a' },
    ]);
    expect([...baseline.known].sort()).toEqual(['a', 'spin']);
  });

  it('hashes to null when empty', () => {
    expect(hashLines([])).toBeNull();
    expect(hashLines(['p1:a'])).toHaveLength(64);
  });
});

describe('isHomePage', () => {
  it('is the root path with no query', () => {
    expect(isHomePage('https://example.org/')).toBe(true);
    expect(isHomePage('https://example.org')).toBe(true);
    expect(isHomePage('https://example.org/camp')).toBe(false);
    expect(isHomePage('https://example.org/?page=camp')).toBe(false);
  });
});

describe('isGone', () => {
  it('judges the last rung that looked', () => {
    expect(isGone(['fetch: HTTP 404'])).toBe(true);
    expect(isGone(['fetch: thin page (22 chars)', 'browser: soft 404 ("Page not found")'])).toBe(
      true
    );
    // A title with "; " and "&amp; " in it used to break the old split-and-match
    expect(
      isGone([
        'fetch: HTTP 404',
        'browser: soft 404 ("404 Not Found | Tryon Arts &amp; Crafts School")',
      ])
    ).toBe(true);
    expect(isGone(['fetch: HTTP 401', 'chrome-tls: HTTP 401', 'browser: HTTP 401'])).toBe(true);
    expect(isGone(['fetch: not a web page (not http)'])).toBe(true);
  });

  it("isn't gone when the page may read next time", () => {
    expect(isGone(['fetch: HTTP 404', 'browser: Timeout 45000ms exceeded'])).toBe(false);
    expect(isGone(['fetch: HTTP 403', 'chrome-tls: HTTP 403'])).toBe(false);
    expect(isGone(['fetch: fetch failed (getaddrinfo ENOTFOUND example.org)'])).toBe(false);
    expect(isGone(['fetch: thin page (22 chars)'])).toBe(false);
    expect(isGone([])).toBe(false);
  });
});

describe('isHttpUrl', () => {
  it('rejects calendar and mail links', () => {
    expect(isHttpUrl('https://example.org/camp')).toBe(true);
    expect(isHttpUrl('webcal://example.org/?ical=1')).toBe(false);
    expect(isHttpUrl('mailto:camp@example.org')).toBe(false);
  });
});
