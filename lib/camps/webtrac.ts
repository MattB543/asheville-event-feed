/**
 * Asheville Parks & Rec summer camps from the city's WebTrac catalog: the deterministic path (plan
 * §6.3, "catalog parsing first"), reusing the Parks & Rec scraper's parser, not the scraper.
 *
 * The scraper looks 120 days ahead, drops full / closed / waitlist rows and projects one event per
 * activity. Here every catalog row is kept, whatever its status or date, because a full week is
 * exactly what a parent needs to see, and summer is more than 120 days away in winter.
 *
 * WebTrac lists each camp week as its own activity (FMID): "Shiloh Camp Week 1" ... "Week 10".
 * One card = one program at one site (D5); the weeks become its sessions.
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
import type { AvailabilityStatus, CampCategory, Check, ExtractedCard, Evidence } from './types';

export const WEBTRAC_PROVIDER = 'Asheville Parks & Recreation';

export interface WebTracCatalog {
  readAt: string;
  activities: number;
  rows: ActivityRow[];
  details: Record<string, ActivityDetail>;
}

const SUMMER_MONTHS = new Set(['05', '06', '07', '08']);
// "Camping 101" and "Youth Camping Club" are classes about camping; afterschool is childcare.
const NOT_A_CAMP = /\bcamping\b|\bafter ?school\b/i;
const YOUTH_CATEGORY = /youth|teen|therapeutic/i;
// "Shiloh Camp Week 3", "Venture Bound Session 1 ages 8-10": the program is what's left.
const WEEK_SUFFIX = /\s*-?\s*\b(?:week|session)\s*\d+\b/i;
const AGES_SUFFIX = /\s*-?\s*\bages?\s*\d+\s*-\s*\d+\s*$/i;

/** Read the catalog: every location and category search, then one detail page per program. */
export async function readWebTracCatalog(): Promise<WebTracCatalog> {
  const fetcher = await createPageFetcher();
  try {
    const all = await fetchAllActivities(fetcher);
    // Every summer row is kept (not just camps), so the camp rule can be re-run without a re-crawl.
    const rows = all.filter((row) => SUMMER_MONTHS.has(row.beginDate.slice(5, 7)));
    const details: Record<string, ActivityDetail> = {};
    for (const group of groupRows(rows.filter(isSummerCampRow))) {
      const fmid = group[0].fmid;
      try {
        details[fmid] = parseDetailPage(await fetcher.get(activityUrl(fmid)));
      } catch (error) {
        console.warn(`[camps/webtrac] detail page failed for ${fmid}: ${String(error)}`);
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
export function isSummerCampRow(row: ActivityRow): boolean {
  if (!SUMMER_MONTHS.has(row.beginDate.slice(5, 7)) || NOT_A_CAMP.test(row.title)) return false;
  if (/adult|senior/i.test(row.category ?? '')) return false;
  if (/\bcamp\b/i.test(row.title)) return true;
  if (!YOUTH_CATEGORY.test(row.category ?? '')) return false;
  const days = (Date.parse(row.endDate) - Date.parse(row.beginDate)) / 86400000 + 1;
  const hours = parseRange(row.timeRange);
  return days >= 3 && days <= 7 && !!hours && minutesBetween(hours.start, hours.end) >= 180;
}

function programName(row: ActivityRow): string {
  return row.title.replace(WEEK_SUFFIX, '').replace(AGES_SUFFIX, '').trim();
}

/** Rows of one program at one site and age band, weeks in date order. */
export function groupRows(rows: ActivityRow[]): ActivityRow[][] {
  const groups = new Map<string, ActivityRow[]>();
  for (const row of rows) {
    const key = `${programName(row)}|${row.locationLabel}|${row.ages}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group) =>
    group.sort((a, b) => a.beginDate.localeCompare(b.beginDate))
  );
}

/** Cards for every summer camp program in the catalog. Facts are the catalog's own, so verified. */
export function webTracCards(catalog: WebTracCatalog): ExtractedCard[] {
  const checkedAt = catalog.readAt;
  const groups = groupRows(catalog.rows.filter(isSummerCampRow));
  // Name the age band only when one program runs several at the same site.
  const bands = new Map<string, number>();
  for (const [row] of groups) {
    const key = `${programName(row)}|${row.locationLabel}`;
    bands.set(key, (bands.get(key) ?? 0) + 1);
  }
  return groups.map((rows) => {
    const first = rows[0];
    const year = Number(first.beginDate.slice(0, 4));
    const url = activityUrl(first.fmid);
    const detail = catalog.details[first.fmid] ?? {};
    const evidence = (quote: string): Evidence => ({
      year,
      url,
      quote,
      source_kind: 'registration_platform',
      check: deterministicCheck(checkedAt),
    });

    const facilityLabel = detail.facility ?? first.locationLabel;
    const known = FACILITIES[facilityLabel] ?? FACILITIES[first.locationLabel];
    // No site: "N/A", "Off Site", or a bare city line ("Asheville, NC, 28802").
    const hasSite =
      !!facilityLabel &&
      !/^(?:n\/a|off ?site)?$/i.test(facilityLabel.trim()) &&
      !/,\s*NC\b/.test(facilityLabel);
    const ages = first.ages.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
    const hours = parseRange(first.timeRange);
    const therapeutic = /therapeutic/i.test(`${first.title} ${first.category ?? ''}`);
    const weeks = rows.length;
    const singleDay = rows.every((row) => row.beginDate === row.endDate);
    const shortDay = hours && minutesBetween(hours.start, hours.end) <= 180;

    return {
      name: programName(first),
      variant:
        [
          hasSite ? (known?.name ?? facilityLabel) : null,
          (bands.get(`${programName(first)}|${first.locationLabel}`) ?? 0) > 1 && ages
            ? `ages ${Math.floor(Number(ages[1]))}-${Math.floor(Number(ages[2]))}`
            : null,
        ]
          .filter(Boolean)
          .join(', ') || null,
      type: singleDay && shortDay ? 'clinic' : 'day',
      categories: categoriesFor(first.title, therapeutic),
      camp_page_url: url,
      registration_url: url,
      description:
        summarize(detail.description) ??
        `${programName(first)}, a City of Asheville Parks & Recreation summer program.`,
      season_dates: {
        ...evidence(`${formatUs(first.beginDate)} - ${formatUs(rows[weeks - 1].endDate)}`),
        start: first.beginDate,
        end: rows[weeks - 1].endDate,
      },
      ages: ages
        ? {
            ...evidence(`Ages ${first.ages}`),
            min: Math.floor(Number(ages[1])),
            max: Math.floor(Number(ages[2])),
          }
        : null,
      grades: null,
      hours: hours
        ? { ...evidence(first.timeRange ?? ''), start: hours.start, end: hours.end }
        : null,
      extended_care: null,
      prices: pricesFor(first, weeks, evidence),
      fees: [],
      locations: hasSite
        ? [
            {
              ...evidence(facilityLabel),
              name: known?.name ?? facilityLabel,
              address: detail.street ?? known?.street ?? null,
              town: 'Asheville',
              state: 'NC',
            },
          ]
        : [],
      financial_aid: null,
      special_needs: therapeutic
        ? {
            ...evidence(first.category ?? first.title),
            available: true,
            details:
              'A Therapeutic Recreation program (adaptive recreation for people with disabilities).',
          }
        : null,
      lunch: null,
      transportation: null,
      registration_milestones: [],
      availability: {
        ...evidence(rows.map((row) => row.status).join(', ')),
        status: availabilityOf(rows),
        scope: weeks > 1 ? `${weeks} weekly sessions` : null,
      },
      last_year_registration_opened: null,
      sessions: rows.map((row) => ({
        label: row.title.match(WEEK_SUFFIX)?.[0].trim() ?? null,
        start: row.beginDate,
        end: row.endDate,
        year,
      })),
    };
  });
}

function deterministicCheck(checkedAt: string): Check {
  return {
    status: 'verified',
    match: 'exact',
    flags: ['webtrac_parser'],
    checkedAt,
    fetchMethod: 'chrome-tls',
  };
}

function pricesFor(
  row: ActivityRow,
  weeks: number,
  evidence: (quote: string) => Evidence
): ExtractedCard['prices'] {
  // A fee is per week only for week-long sessions; "1st Sunday Football Camp" is three 1-hour Sundays.
  const spansWeek = (Date.parse(row.endDate) - Date.parse(row.beginDate)) / 86400000 >= 3;
  const unit = weeks > 1 && spansWeek ? 'week' : 'session';
  const quote = `$${(row.residentFee ?? 0).toFixed(2)}/$${(row.nonResidentFee ?? 0).toFixed(2)}`;
  const prices: ExtractedCard['prices'] = [];
  if (row.residentFee !== null) {
    prices.push({
      ...evidence(quote),
      amount: row.residentFee,
      unit,
      tier: 'City of Asheville resident',
    });
  }
  if (row.nonResidentFee !== null && row.nonResidentFee !== row.residentFee) {
    prices.push({ ...evidence(quote), amount: row.nonResidentFee, unit, tier: 'Non-resident' });
  }
  return prices;
}

/** Each week's own status, rolled up. Past weeks read "Unavailable" (registration closed). */
function availabilityOf(rows: ActivityRow[]): AvailabilityStatus {
  const statuses = rows.map((row) => row.status.toLowerCase());
  const isOpen = (status: string) =>
    status !== 'unavailable' && /available|open|almost full/.test(status);
  const openWeeks = statuses.filter(isOpen).length;
  if (openWeeks > 0) return openWeeks === statuses.length ? 'available' : 'mixed';
  if (statuses.some((status) => /wait/.test(status))) return 'waitlist';
  if (statuses.every((status) => status === 'full')) return 'full';
  return 'closed';
}

function categoriesFor(title: string, therapeutic: boolean): CampCategory[] {
  const categories: CampCategory[] = [];
  if (/football|wrestling|sports|basketball|soccer/i.test(title)) categories.push('sports');
  if (/gaming/i.test(title)) categories.push('general');
  if (therapeutic) categories.push('special_needs');
  if (/venture|outdoor/i.test(title)) categories.push('nature_outdoor');
  if (categories.length === 0 || (therapeutic && categories.length === 1))
    categories.push('general');
  return categories;
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

/** "2026-06-08" -> "06/08/2026", the catalog's own format. */
function formatUs(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
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
