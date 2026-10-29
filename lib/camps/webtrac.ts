/**
 * Asheville Parks & Rec summer camps from the city's WebTrac catalog: the deterministic path (no
 * Sol), reusing the Parks & Rec scraper's parser, not the scraper.
 *
 * The scraper looks 120 days ahead, drops full / closed / waitlist rows and projects one event per
 * activity. Here every catalog row is kept, whatever its status or date, because a full week is
 * exactly what a parent needs to see, and summer is more than 120 days away in winter.
 *
 * WebTrac lists each week at each site as its own activity (FMID): "Shiloh Camp Week 1", "Grant
 * Summer Week 1". One card per program (docs/camps/04-v2-plan.md §1.4): the weeks, sites and age
 * bands are its rows. The facts are the catalog's own, so every card is high confidence.
 */

import {
  FACILITIES,
  activityUrl,
  createPageFetcher,
  fetchAllActivities,
  parseDetailPage,
  type ActivityDetail,
  type ActivityRow,
} from '@/lib/scrapers/ashevilleparksrec';
import type {
  AvailabilityStatus,
  CampCard,
  CampCategory,
  Milestone,
  PriceTier,
  ProviderExtraction,
  Session,
  Site,
} from './contract';

export interface WebTracCatalog {
  readAt: string;
  activities: number;
  rows: ActivityRow[];
  details: Record<string, ActivityDetail>;
}

// The prompt's "AVLGO wants summer 2027", for the catalog path.
const TARGET_SUMMER = 2027;
const SUMMER_MONTHS = new Set(['05', '06', '07', '08']);
// "Camping 101" and "Youth Camping Club" are classes about camping; afterschool is childcare.
const NOT_A_CAMP = /\bcamping\b|\bafter ?school\b/i;
const YOUTH_CATEGORY = /youth|teen|therapeutic/i;
// "Shiloh Camp Week 3", "Venture Bound Session 1 ages 8-10": the program is what's left.
const WEEK_SUFFIX = /\s*-?\s*\b(?:week|session)\s*\d+\b/i;
const AGES_SUFFIX = /\s*-?\s*\bages?\s*\d+\s*-\s*\d+\s*$/i;

/**
 * The city runs the same camp at each community center under the center's name ("Shiloh Camp",
 * "Grant Summer", "Montford Teen Camp"), and its therapeutic camp in two age bands. These are one
 * program each, named as the city's camp page names them (pilot extraction, 2026-10-28).
 */
const CENTERS = Object.keys(FACILITIES)
  .map((label) => label.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const SHARED_PROGRAMS: Array<[RegExp, string]> = [
  [new RegExp(`^(?:${CENTERS})\\s+teen\\s+camp$`, 'i'), 'Teen Day Camp'],
  [new RegExp(`^(?:${CENTERS})\\s+(?:summer|camp)$`, 'i'), 'Youth Day Camp'],
  [/^therapeutic\s+(?:youth|teen)\s+camp$/i, 'Therapeutic Recreation Day Camp'],
];

/** Read the catalog: every location and category search, then one detail page per program and site. */
export async function readWebTracCatalog(): Promise<WebTracCatalog> {
  const fetcher = await createPageFetcher();
  try {
    const all = await fetchAllActivities(fetcher);
    // Every summer row is kept (not just camps), so the camp rule can be re-run without a re-crawl.
    const rows = all.filter((row) => SUMMER_MONTHS.has(row.beginDate.slice(5, 7)));
    const details: Record<string, ActivityDetail> = {};
    for (const row of firstRowPerSite(rows.filter(isSummerCampRow))) {
      try {
        details[row.fmid] = parseDetailPage(await fetcher.get(activityUrl(row.fmid)));
      } catch (error) {
        console.warn(`[camps/webtrac] detail page failed for ${row.fmid}: ${String(error)}`);
      }
    }
    return { readAt: new Date().toISOString(), activities: all.length, rows, details };
  } finally {
    await fetcher.close();
  }
}

/**
 * A summer camp row: "camp" in the title, or a camp-shaped youth program (a 3-7 day run of 3+ hour
 * days). Titles alone miss the Grant and Montford youth camps ("Grant Summer Week 1") and
 * "Venture Bound" / "Nature Nuts" (pilot, 2026-10-28).
 */
function isSummerCampRow(row: ActivityRow): boolean {
  if (!SUMMER_MONTHS.has(row.beginDate.slice(5, 7)) || NOT_A_CAMP.test(row.title)) return false;
  if (/adult|senior/i.test(row.category ?? '')) return false;
  if (/\bcamp\b/i.test(row.title)) return true;
  if (!YOUTH_CATEGORY.test(row.category ?? '')) return false;
  const days = (Date.parse(row.endDate) - Date.parse(row.beginDate)) / 86400000 + 1;
  const hours = parseRange(row.timeRange);
  return days >= 3 && days <= 7 && !!hours && minutesBetween(hours.start, hours.end) >= 180;
}

function programName(row: ActivityRow): string {
  const name = row.title.replace(WEEK_SUFFIX, '').replace(AGES_SUFFIX, '').trim();
  return SHARED_PROGRAMS.find(([pattern]) => pattern.test(name))?.[1] ?? name;
}

function byDate(a: ActivityRow, b: ActivityRow): number {
  return a.beginDate.localeCompare(b.beginDate) || a.locationLabel.localeCompare(b.locationLabel);
}

/** The first week of each program at each site, per summer: its detail page has the site's address. */
function firstRowPerSite(rows: ActivityRow[]): ActivityRow[] {
  const first = new Map<string, ActivityRow>();
  for (const row of [...rows].sort(byDate)) {
    const key = `${row.beginDate.slice(0, 4)}|${programName(row)}|${row.locationLabel}`;
    if (!first.has(key)) first.set(key, row);
  }
  return [...first.values()];
}

/**
 * Each program's rows from its latest summer in the catalog, in date order. Never across summers:
 * a 2026 week must not join (or date) a 2027 card.
 */
function programRows(rows: ActivityRow[]): ActivityRow[][] {
  const programs = new Map<string, ActivityRow[]>();
  for (const row of rows) {
    const name = programName(row);
    programs.set(name, [...(programs.get(name) ?? []), row]);
  }
  return [...programs.values()].map((program) => {
    const latest = program.reduce((year, row) => (row.beginDate > year ? row.beginDate : year), '');
    return program.filter((row) => row.beginDate.slice(0, 4) === latest.slice(0, 4)).sort(byDate);
  });
}

export function webTracExtraction(
  catalog: WebTracCatalog,
  provider: { name: string; urls: string[] }
): ProviderExtraction {
  const cards = webTracCards(catalog, provider.urls[0] ?? null);
  return {
    provider_name: provider.name,
    website_url: provider.urls[0] ?? null,
    notes: `Read from the city's WebTrac catalog on ${catalog.readAt.slice(0, 10)}: ${cards.reduce((sum, card) => sum + card.sessions.length, 0)} camp rows.`,
    excluded: [],
    cards,
  };
}

/** One card per summer camp program in the catalog. */
export function webTracCards(catalog: WebTracCatalog, campPageUrl: string | null): CampCard[] {
  // A detail page is read for one week per program and site; any of them gives the site's street.
  const siteDetails = new Map<string, ActivityDetail>();
  for (const row of catalog.rows) {
    const detail = catalog.details[row.fmid];
    if (detail && !siteDetails.has(row.locationLabel)) siteDetails.set(row.locationLabel, detail);
  }
  const siteOf = (row: ActivityRow): Site | null => {
    const detail = siteDetails.get(row.locationLabel);
    const label = detail?.facility ?? row.locationLabel;
    // No site: "N/A", "Off Site", or a bare city line ("Asheville, NC, 28802").
    if (!label || /^(?:n\/a|off ?site)?$/i.test(label.trim()) || /,\s*NC\b/.test(label))
      return null;
    const known = FACILITIES[label] ?? FACILITIES[row.locationLabel];
    return {
      name: known?.name ?? label,
      address: detail?.street ?? known?.street ?? null,
      town: 'Asheville',
      state: 'NC',
    };
  };

  return programRows(catalog.rows.filter(isSummerCampRow)).map((rows) => {
    const first = rows[0];
    const name = programName(first);
    const year = Number(first.beginDate.slice(0, 4));
    const registrationUrl = activityUrl(first.fmid);
    const description = rows.map((row) => catalog.details[row.fmid]?.description).find(Boolean);

    const sites: Site[] = [];
    for (const row of rows) {
      const site = siteOf(row);
      if (site && !sites.some((known) => known.name === site.name)) sites.push(site);
    }
    const ages = rows.map((row) => parseAges(row.ages));
    const cardAges = ages.every(Boolean)
      ? {
          min: Math.min(...ages.map((range) => range!.min)),
          max: Math.max(...ages.map((range) => range!.max)),
        }
      : null;
    const sameHours = rows.every((row) => row.timeRange === first.timeRange);
    const cardHours = sameHours ? parseRange(first.timeRange) : null;
    const tiers = rows.map((row) => pricesFor(row, rows.length));
    const sameFees = rows.every(
      (row) => row.residentFee === first.residentFee && row.nonResidentFee === first.nonResidentFee
    );
    const therapeutic = rows.some((row) =>
      /therapeutic/i.test(`${row.title} ${row.category ?? ''}`)
    );
    const singleDay = rows.every((row) => row.beginDate === row.endDate);
    const shortDay = cardHours && minutesBetween(cardHours.start, cardHours.end) <= 180;

    const sessions: Session[] = rows.map((row, index) => {
      const rowAges = ages[index];
      const rowHours = parseRange(row.timeRange);
      const [resident, nonResident] = tiers[index];
      return {
        label: row.title.match(WEEK_SUFFIX)?.[0].trim() ?? null,
        start: row.beginDate,
        end: row.endDate,
        year,
        site: sites.length > 1 ? (siteOf(row)?.name ?? null) : null,
        ages:
          rowAges && (rowAges.min !== cardAges?.min || rowAges.max !== cardAges?.max)
            ? rowAges
            : null,
        grades: null,
        hours: !sameHours && rowHours ? rowHours : null,
        // A row holds one price: the resident fee, with the non-resident fee in its label.
        price:
          !sameFees && resident
            ? {
                ...resident,
                label: nonResident ? `resident (non-resident $${nonResident.amount})` : null,
              }
            : null,
        status: WEEK_STATUS[row.status.trim().toLowerCase()] ?? null,
      };
    });

    return {
      name,
      type: singleDay && shortDay ? 'clinic' : 'day',
      categories: categoriesFor(name, therapeutic),
      description:
        summarize(description) ?? `${name}, a City of Asheville Parks & Recreation summer camp.`,
      camp_page_url: campPageUrl ?? registrationUrl,
      registration_url: registrationUrl,
      season: {
        year,
        status: year >= TARGET_SUMMER ? 'posted' : 'not_posted',
        start: first.beginDate,
        end: rows.reduce((end, row) => (row.endDate > end ? row.endDate : end), first.endDate),
        text: null,
      },
      ages: cardAges,
      grades: null,
      sites,
      hours: cardHours ? { ...cardHours, text: first.timeRange ?? null } : null,
      extended_care: null,
      prices: sameFees ? tiers[0] : [],
      sessions,
      registration: milestonesFor(rows, year),
      last_year_registration_opened: null,
      // A past summer's Full / Unavailable says nothing about now; its rows keep their statuses.
      availability: year >= TARGET_SUMMER ? availabilityOf(rows) : null,
      financial_aid: null,
      special_needs: therapeutic
        ? {
            value: 'yes',
            text: 'A Therapeutic Recreation program (adaptive recreation for people with disabilities).',
          }
        : null,
      lunch: null,
      transportation: null,
      sources: [...new Set([campPageUrl, registrationUrl].filter((url): url is string => !!url))],
      confidence: 'high',
      review_notes: null,
    };
  });
}

/**
 * The catalog's registration tooltip, when it names a date ("Registration Opens 02/01/2027 9:00
 * AM"). A relative rule ("30 days before start date") is not a date and is left out.
 */
function milestonesFor(rows: ActivityRow[], year: number): Milestone[] {
  const milestones = new Map<string, Milestone>();
  for (const row of rows) {
    const note = row.registrationNote;
    const date = note?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!note || !date || milestones.has(note)) continue;
    // Only a time written with am/pm; never one read from an ambiguous number.
    const time = note.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i);
    const hour = time ? (Number(time[1]) % 12) + (time[3].toLowerCase() === 'p' ? 12 : 0) : null;
    milestones.set(note, {
      audience: 'public',
      kind: 'opens',
      date: `${date[3]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}`,
      time: time ? `${String(hour).padStart(2, '0')}:${time[2] ?? '00'}` : null,
      precision: time ? 'datetime' : 'date',
      certainty: 'announced',
      text: note,
      url: activityUrl(row.fmid),
      year,
      confidence: 'high',
    });
  }
  return [...milestones.values()];
}

/** Resident and non-resident fees (one tier when they match). */
function pricesFor(row: ActivityRow, rowCount: number): PriceTier[] {
  // A fee is per week only for week-long sessions; "1st Sunday Football Camp" is three 1-hour Sundays.
  const spansWeek = (Date.parse(row.endDate) - Date.parse(row.beginDate)) / 86400000 >= 3;
  const unit = rowCount > 1 && spansWeek ? 'week' : 'session';
  const year = Number(row.beginDate.slice(0, 4));
  if (row.residentFee !== null && row.nonResidentFee === row.residentFee) {
    return [{ amount: row.residentFee, unit, label: null, year }];
  }
  const prices: PriceTier[] = [];
  if (row.residentFee !== null) {
    prices.push({ amount: row.residentFee, unit, label: 'City of Asheville resident', year });
  }
  if (row.nonResidentFee !== null) {
    prices.push({ amount: row.nonResidentFee, unit, label: 'Non-resident', year });
  }
  return prices;
}

/** What each WebTrac status says about a week; anything else ("Check Availability") says nothing. */
const WEEK_STATUS: Record<string, AvailabilityStatus> = {
  available: 'available',
  open: 'available',
  'almost full': 'available',
  full: 'full',
  waitlist: 'waitlist',
  'wait list': 'waitlist',
  unavailable: 'closed', // past weeks: registration over
  closed: 'closed',
  cancelled: 'closed',
  canceled: 'closed',
};

/**
 * Each week's own status, rolled up; one week we can't read leaves the card's status unknown. The
 * roll-up covers every row of the card, so it has no scope: a program with every week full reads
 * as full.
 */
function availabilityOf(rows: ActivityRow[]): CampCard['availability'] {
  const weeks = rows.map((row) => WEEK_STATUS[row.status.trim().toLowerCase()]);
  if (weeks.some((week) => !week)) return null;
  return {
    status: rollUp(weeks),
    scope: null,
    text: [...new Set(rows.map((row) => row.status))].join(', '),
  };
}

function rollUp(weeks: AvailabilityStatus[]): AvailabilityStatus {
  const open = weeks.filter((week) => week === 'available').length;
  if (open > 0) return open === weeks.length ? 'available' : 'mixed';
  if (weeks.includes('waitlist')) return 'waitlist';
  return weeks.every((week) => week === 'full') ? 'full' : 'closed';
}

function categoriesFor(name: string, therapeutic: boolean): CampCategory[] {
  const categories: CampCategory[] = [];
  if (/football|wrestling|sports|basketball|soccer/i.test(name)) categories.push('sports');
  if (/gaming/i.test(name)) categories.push('general');
  if (therapeutic) categories.push('special_needs');
  if (/venture|outdoor|nature/i.test(name)) categories.push('nature_outdoor');
  if (categories.length === 0 || (therapeutic && categories.length === 1))
    categories.push('general');
  return categories;
}

/** "6-11.99" -> 6-11; the catalog writes the top age as its last day. */
function parseAges(ages: string): { min: number; max: number } | null {
  const match = ages.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
  return match ? { min: Math.floor(Number(match[1])), max: Math.floor(Number(match[2])) } : null;
}

function parseRange(range: string | undefined): { start: string; end: string } | null {
  if (!range) return null;
  const times = [...range.matchAll(/(\d{1,2}):(\d{2})\s*([ap]m)/gi)].map(
    ([, hour, minute, meridiem]) => {
      let value = Number(hour) % 12;
      if (meridiem.toLowerCase() === 'pm') value += 12;
      return `${String(value).padStart(2, '0')}:${minute}`;
    }
  );
  return times.length >= 2 ? { start: times[0], end: times[1] } : null;
}

function minutesBetween(start: string, end: string): number {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return toMinutes(end) - toMinutes(start);
}

/** The city's own first sentence or two, capped (descriptions run to several paragraphs). */
function summarize(description: string | undefined): string | null {
  if (!description) return null;
  const flat = description.replace(/\s+/g, ' ').trim();
  const sentences = flat.match(/[^.!?]+[.!?]+/g) ?? [flat];
  let text = '';
  for (const sentence of sentences) {
    if ((text + sentence).length > 260 && text) break;
    text += sentence;
  }
  return text.trim() || null;
}
