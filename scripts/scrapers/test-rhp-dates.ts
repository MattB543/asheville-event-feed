/**
 * Deterministic date-resolution tests for lib/scrapers/rhp.ts.
 *
 * The year logic is the riskiest part of the rhp parser: cards print
 * "Wed, Aug 26" with no year. Live listings don't currently span a
 * December -> January rollover, so that path would otherwise go untested
 * until it silently broke in January.
 *
 * These tests feed synthetic listing HTML through the real scraper by
 * stubbing global fetch — no network, no fixtures on disk.
 *
 * Usage: npx tsx scripts/scrapers/test-rhp-dates.ts
 */

import 'dotenv/config';
import { scrapeRhpVenue, type RhpVenueConfig } from '../../lib/scrapers/rhp';

const BASE: RhpVenueConfig = {
  source: 'ASHEVILLE_MUSIC_HALL',
  sourceIdPrefix: 't-',
  logLabel: 'TEST',
  listingUrl: 'https://example.test/events/',
  defaultVenueName: 'Test Venue',
  defaultAddress: 'Test Venue, 1 Main St, Asheville, NC',
  zip: '28801',
};

/** Build one rhp-events card. `date` is the literal card text, e.g. "Wed, Aug 26". */
function card(opts: {
  date: string;
  title: string;
  slug: string;
  time?: string;
  cost?: string;
  free?: boolean;
}) {
  return `
  <div class="rhpSingleEvent">
    <a class="url" href="https://example.test/event/${opts.slug}/main/"></a>
    <div class="rhp-events-event-image"><img src="https://example.test/i/${opts.slug}.jpg" /></div>
    <div id="eventDate" class="eventMonth">${opts.date}</div>
    <h2 class="rhp-event__title--list">${opts.title}</h2>
    <div class="eventDoorStartDate"><span>${opts.time ?? 'Show: 8 pm'}</span></div>
    ${opts.cost ? `<div class="rhp-event__cost-text--list">${opts.cost}</div>` : ''}
    <span class="rhp-event-cta ${opts.free ? 'free' : 'on-sale'}"><a href="https://www.etix.com/ticket/p/1/${opts.slug}">x</a></span>
  </div>`;
}

function page(body: string) {
  return `<!doctype html><html><body><div class="generalView">${body}</div></body></html>`;
}

function stubFetch(html: string) {
  (globalThis as { fetch: unknown }).fetch = async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok)
    console.log(
      `        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
    );
}

/** Render an event's Eastern calendar date as YYYY-MM-DD. */
const easternDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

async function main() {
  const thisYear = new Date().getFullYear();
  const nextYear = thisYear + 1;

  console.log('\n=== 1. Explicit "Month YYYY" headings win ===');
  stubFetch(
    page(`
      <p>December ${thisYear}</p>
      ${card({ date: 'Fri, Dec 18', title: 'December Show', slug: 'dec-show' })}
      <p>January ${nextYear}</p>
      ${card({ date: 'Sat, Jan 9', title: 'January Show', slug: 'jan-show' })}
    `)
  );
  {
    const events = await scrapeRhpVenue(BASE);
    const byTitle = Object.fromEntries(events.map((e) => [e.title, easternDay(e.startDate)]));
    check('December card takes heading year', byTitle['December Show'], `${thisYear}-12-18`);
    check('January card rolls to next year', byTitle['January Show'], `${nextYear}-01-09`);
  }

  console.log('\n=== 2. Monotonic fallback rolls the year with no headings ===');
  stubFetch(
    page(`
      ${card({ date: 'Fri, Dec 18', title: 'Dec Show', slug: 'd1' })}
      ${card({ date: 'Sat, Jan 9', title: 'Jan Show', slug: 'j1' })}
      ${card({ date: 'Sun, Feb 14', title: 'Feb Show', slug: 'f1' })}
    `)
  );
  {
    const events = await scrapeRhpVenue(BASE);
    const byTitle = Object.fromEntries(events.map((e) => [e.title, easternDay(e.startDate)]));
    check('Dec stays in current year', byTitle['Dec Show'], `${thisYear}-12-18`);
    check('Jan rolls forward', byTitle['Jan Show'], `${nextYear}-01-09`);
    check('Feb stays in rolled year', byTitle['Feb Show'], `${nextYear}-02-14`);
  }

  console.log('\n=== 3. Wrong weekday is logged but the date is KEPT (not shifted a year) ===');
  stubFetch(
    page(`
      <p>December ${thisYear}</p>
      ${card({ date: 'Mon, Dec 18', title: 'Typo Weekday', slug: 'typo' })}
    `)
  );
  {
    const events = await scrapeRhpVenue(BASE);
    check('date kept despite bad weekday', easternDay(events[0].startDate), `${thisYear}-12-18`);
  }

  console.log('\n=== 4. Impossible date (Feb 30) is skipped, not normalized ===');
  stubFetch(
    page(`
      <p>February ${nextYear}</p>
      ${card({ date: 'Fri, Feb 30', title: 'Impossible', slug: 'imp' })}
      ${card({ date: 'Sat, Feb 14', title: 'Valid', slug: 'val' })}
    `)
  );
  {
    const events = await scrapeRhpVenue(BASE);
    check(
      'only the valid card survives',
      events.map((e) => e.title),
      ['Valid']
    );
  }

  console.log('\n=== 5. Time + price parsing ===');
  stubFetch(
    page(`
      <p>December ${thisYear}</p>
      ${card({ date: 'Fri, Dec 4', title: 'Doors and Show', slug: 's1', time: 'Doors: 4 pm // Show: 7 pm' })}
      ${card({ date: 'Sat, Dec 5', title: 'Doors Only', slug: 's2', time: 'Doors: 7 pm' })}
      ${card({ date: 'Sun, Dec 6', title: 'No Time', slug: 's3', time: '' })}
      ${card({ date: 'Mon, Dec 7', title: 'Range Price', slug: 's4', cost: '$14.05 to $16.11' })}
      ${card({ date: 'Tue, Dec 8', title: 'Free Show', slug: 's5', free: true })}
    `)
  );
  {
    const events = await scrapeRhpVenue(BASE);
    const by = Object.fromEntries(events.map((e) => [e.title, e]));
    const hour = (d: Date) =>
      Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          hour12: false,
        }).format(d)
      );
    check('prefers Show over Doors', hour(by['Doors and Show'].startDate), 19);
    check('falls back to Doors-only', hour(by['Doors Only'].startDate), 19);
    check('no time -> timeUnknown', by['No Time'].timeUnknown, true);
    check('price range normalized', by['Range Price'].price, '$14.05 - $16.11');
    check('free CTA -> Free', by['Free Show'].price, 'Free');
  }

  console.log('\n=== 6. Duplicate desktop/mobile renders collapse ===');
  stubFetch(
    page(`
      <p>December ${thisYear}</p>
      ${card({ date: 'Fri, Dec 4', title: 'Dupe', slug: 'dupe' })}
      ${card({ date: 'Fri, Dec 4', title: 'Dupe', slug: 'dupe' })}
    `)
  );
  {
    const events = await scrapeRhpVenue(BASE);
    check('two renders -> one event', events.length, 1);
  }

  console.log('\n=== 7. Empty listing throws (does not silently return []) ===');
  stubFetch(page('<p>no events</p>'));
  {
    let threw = false;
    try {
      await scrapeRhpVenue(BASE);
    } catch {
      threw = true;
    }
    check('throws on zero cards', threw, true);
  }

  console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
