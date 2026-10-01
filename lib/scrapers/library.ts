/**
 * Public Library Events Scraper
 *
 * Library programs (story times, book clubs, classes, author talks) from the
 * public library systems within ~45 minutes of downtown Asheville. Every system
 * publishes through one of four calendar platforms, each with a structured feed,
 * so this file has one small adapter per platform and a config entry per system:
 *
 *   LibraryMarket  JSON feed  /events/feed/json?start=&end=   Buncombe, Transylvania
 *   LibCal         JSON list  /ajax/calendar/list (the public calendar's own feed)
 *                                                            Henderson, McDowell, Polk
 *   CivicPlus      iCal       /common/modules/iCalendar/iCalendar.aspx?catID=
 *                                                            Haywood
 *   WhoFi          JSON       /calendar/fetch_calendar_events (FullCalendar source)
 *                                                            Madison
 *
 * Branches farther than ~45 minutes are left out of each system's branch map
 * (Hot Springs, Columbus) and anything at an unmapped branch is dropped, as are
 * bookmobile stops, virtual-only programs, closures, staff bookings, cancelled
 * programs, and Buncombe's early-voting-site listings (handled elsewhere).
 *
 * All events go out as source LIBRARY with the branch as organizer (compact
 * cards show only the organizer), the system named in the description's last
 * line, and location "Branch, street, City NC zip" from the hardcoded branch
 * maps below: none of the feeds carries a reliable branch address, and the zip
 * drives the location filter. The "View on <system>" link label comes from
 * lib/config/librarySystems.ts, keyed by calendar host.
 */

import { type ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { extractPriceFromText, stripHtml } from '@/lib/utils/parsers';
import {
  getDateStringEastern,
  getDayBoundariesEastern,
  getTodayStringEastern,
  parseAsEastern,
} from '@/lib/utils/timezone';
import * as ical from 'node-ical';
import { DEFAULT_USER_AGENT, debugSave } from './base';

const LABEL = 'Library';

/** How far ahead to collect. Library calendars are dense, so this stays near MountainX's 56. */
const HORIZON_DAYS = 60;

/** Stored time for events the feed lists by date only (shown as "time unknown"). */
const ALL_DAY_TIME = '10:00:00';

const MAX_DESCRIPTION = 2000;

const HEADERS = {
  'User-Agent': DEFAULT_USER_AGENT,
  Accept: 'application/json, text/calendar, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ============================================================================
// SYSTEMS AND BRANCHES
// ============================================================================

interface Branch {
  name: string;
  street: string;
  city: string;
  zip: string;
}

function branch(name: string, street: string, city: string, zip: string): Branch {
  return { name, street, city, zip };
}

function formatLocation(b: Branch): string {
  return `${b.name}, ${b.street}, ${b.city} NC ${b.zip}`;
}

interface SystemBase {
  key: string; // sourceId prefix
  systemName: string;
  /** Feed branch label -> branch. Labels missing here are out of range or not real branches. */
  branches: Record<string, Branch>;
}

interface LibraryMarketSystem extends SystemBase {
  platform: 'librarymarket';
  baseUrl: string;
  /**
   * Off-site programs carry their own address. Only keep those whose town
   * (lowercase) is listed; undefined keeps every addressed off-site program
   * (the whole system is in range). Matched on town rather than zip because
   * staff type the zip by hand: PARI in Rosman is entered with Brevard's 28712.
   */
  offsiteCities?: string[];
}

interface LibCalSystem extends SystemBase {
  platform: 'libcal';
  baseUrl: string;
  /**
   * Branch codes some titles start with ("ED Family Storytime") -> the branch
   * label they stand for. Stripped only when the code names the event's own branch.
   */
  titleCodes?: Record<string, string>;
}

interface CivicPlusSystem extends SystemBase {
  platform: 'civicplus';
  baseUrl: string;
  categoryId: number;
}

interface WhoFiSystem extends SystemBase {
  platform: 'whofi';
  baseUrl: string;
}

type LibrarySystem = LibraryMarketSystem | LibCalSystem | CivicPlusSystem | WhoFiSystem;

// Drive times are from downtown Asheville (Pack Square), typical traffic.
const SYSTEMS: LibrarySystem[] = [
  {
    platform: 'librarymarket',
    key: 'bcpl',
    systemName: 'Buncombe County Public Libraries',
    baseUrl: 'https://buncombe.librarycalendar.com',
    // All 12 branches are 5-25 minutes out.
    branches: {
      'Pack Memorial Library': branch(
        'Pack Memorial Library',
        '67 Haywood St',
        'Asheville',
        '28801'
      ),
      'East Asheville Library': branch('East Asheville Library', '3 Avon Rd', 'Asheville', '28805'),
      'North Asheville Library': branch(
        'North Asheville Library',
        '1030 Merrimon Ave',
        'Asheville',
        '28804'
      ),
      'West Asheville Library': branch(
        'West Asheville Library',
        '942 Haywood Rd',
        'Asheville',
        '28806'
      ),
      'Oakley/South Asheville Library': branch(
        'Oakley/South Asheville Library',
        '749 Fairview Rd',
        'Asheville',
        '28803'
      ),
      'South Buncombe/Skyland Library': branch(
        'South Buncombe/Skyland Library',
        '260 Overlook Rd',
        'Asheville',
        '28803'
      ),
      'Black Mountain Library': branch(
        'Black Mountain Library',
        '105 N Dougherty St',
        'Black Mountain',
        '28711'
      ),
      'Enka-Candler Library': branch(
        'Enka-Candler Library',
        '1404 Sand Hill Rd',
        'Candler',
        '28715'
      ),
      'Fairview Library': branch('Fairview Library', '1 Taylor Rd', 'Fairview', '28730'),
      'Leicester Library': branch('Leicester Library', '1561 Alexander Rd', 'Leicester', '28748'),
      'Swannanoa Library': branch(
        'Swannanoa Library',
        '101 W Charleston Ave',
        'Swannanoa',
        '28778'
      ),
      'Weaverville Library': branch('Weaverville Library', '41 N Main St', 'Weaverville', '28787'),
    },
  },
  {
    platform: 'librarymarket',
    key: 'tcl',
    systemName: 'Transylvania County Library',
    baseUrl: 'https://transylvaniacounty.librarycalendar.com',
    // Brevard is ~45 min, the edge of the radius. The Bookmobile is left out.
    branches: {
      'Transylvania County Library': branch(
        'Transylvania County Library',
        '212 S Gaston St',
        'Brevard',
        '28712'
      ),
    },
    // Rosman, Lake Toxaway and Sapphire are an hour or more out.
    offsiteCities: ['brevard', 'pisgah forest'],
  },
  {
    platform: 'libcal',
    key: 'hcpl',
    systemName: 'Henderson County Public Library',
    baseUrl: 'https://hendersonpl.libcal.com',
    // Fletcher ~20 min, Mills River ~25, Main ~30, Edneyville ~35, Etowah ~35, Green River ~40.
    branches: {
      'Main Library': branch(
        'Henderson County Main Library',
        '301 N Washington St',
        'Hendersonville',
        '28739'
      ),
      'Fletcher Branch': branch('Fletcher Library', '120 Library Rd', 'Fletcher', '28732'),
      'Mills River Branch': branch(
        'Mills River Library',
        '124 Town Center Dr',
        'Mills River',
        '28759'
      ),
      'Edneyville Branch': branch(
        'Edneyville Library',
        '2 Firehouse Rd',
        'Hendersonville',
        '28792'
      ),
      'Etowah Branch': branch('Etowah Library', '101 Brickyard Rd', 'Etowah', '28729'),
      'Green River Branch': branch('Green River Library', '50 Green River Rd', 'Zirconia', '28790'),
    },
    titleCodes: {
      ED: 'Edneyville Branch',
      ET: 'Etowah Branch',
      FL: 'Fletcher Branch',
      GR: 'Green River Branch',
      MR: 'Mills River Branch',
    },
  },
  {
    platform: 'libcal',
    key: 'mcpl',
    systemName: 'McDowell County Public Library',
    baseUrl: 'https://mcdowellpubliclibrary.libcal.com',
    // Old Fort ~25 min, Marion ~40. The Bookmobile is left out.
    branches: {
      'Marion Branch': branch('Marion Library', '90 W Court St', 'Marion', '28752'),
      'Old Fort Branch': branch('Old Fort Library', '65 E Mitchell St', 'Old Fort', '28762'),
    },
  },
  {
    platform: 'libcal',
    key: 'pcpl',
    systemName: 'Polk County Public Libraries',
    baseUrl: 'https://polklibrary.libcal.com',
    // Saluda ~35 min. Columbus (~50 min) is left out, matching lib/utils/geo.ts.
    branches: {
      'Saluda Library': branch('Saluda Library', '44 W Main St', 'Saluda', '28773'),
    },
  },
  {
    platform: 'civicplus',
    key: 'haywood',
    systemName: 'Haywood County Public Library',
    baseUrl: 'https://www.haywoodcountync.gov',
    categoryId: 29,
    // Canton ~25 min, Waynesville ~35.
    branches: {
      'Waynesville Library': branch(
        'Waynesville Library',
        '678 S Haywood St',
        'Waynesville',
        '28786'
      ),
      'Canton Library': branch('Canton Library', '11 Pennsylvania Ave', 'Canton', '28716'),
    },
  },
  {
    platform: 'whofi',
    key: 'madison',
    systemName: 'Madison County Public Libraries',
    baseUrl: 'https://madison-nc.whofi.com',
    // Mars Hill ~25 min, Marshall ~30. Hot Springs (~50 min) is left out.
    branches: {
      'Marshall Library': branch('Marshall Library', '1335 N Main St', 'Marshall', '28753'),
      'Mars Hill Library': branch('Mars Hill Library', '25 Library St', 'Mars Hill', '28754'),
    },
  },
];

// ============================================================================
// SHARED HELPERS
// ============================================================================

interface ScrapeWindow {
  startStr: string; // YYYY-MM-DD, today in Eastern
  endStr: string; // YYYY-MM-DD, exclusive
  now: Date;
  startOfToday: Date;
  horizon: Date;
}

/** YYYY-MM-DD plus whole days. From noon Eastern, a 23- or 25-hour DST day can't change the date. */
function addDays(dateStr: string, days: number): string {
  const noon = parseAsEastern(dateStr, '12:00:00');
  return getDateStringEastern(new Date(noon.getTime() + days * 24 * 60 * 60 * 1000));
}

function buildWindow(): ScrapeWindow {
  const startStr = getTodayStringEastern();
  const endStr = addDays(startStr, HORIZON_DAYS);
  return {
    startStr,
    endStr,
    now: new Date(),
    startOfToday: getDayBoundariesEastern(startStr).start,
    horizon: getDayBoundariesEastern(endStr).start,
  };
}

/** Whether an event is upcoming and inside the horizon. Date-only events count all day. */
function inWindow(startDate: Date, timeUnknown: boolean, w: ScrapeWindow): boolean {
  if (isNaN(startDate.getTime())) return false;
  if (startDate >= w.horizon) return false;
  return timeUnknown ? startDate >= w.startOfToday : startDate >= w.now;
}

// Cancellations, closures, staff bookings, board meetings and internal
// placeholders ("Hold for ...") that some calendars publish as ordinary events.
const NOT_AN_EVENT_TITLE =
  /\b(cancel+ed|postponed|holiday closing|closed for|board of trustees)\b|\blibrar(y|ies) (is |are )?closed\b|^hold for\b|\bstaff (use|meeting|training|development)\b/i;

const VIRTUAL_TEXT = /\bvirtual event\b|\bonline only\b/i;

/** One line of text: tags stripped, entities decoded, whitespace collapsed. */
function cleanText(html: string | null | undefined): string {
  if (!html) return '';
  return stripHtml(html).trim();
}

// A paragraph that is only a branch name ("Fletcher Library", "Main Libary").
const BRANCH_NAME_LINE = /^[\w .'/-]{1,40}\blibr?ary$/i;

/**
 * A description as paragraphs separated by blank lines (they render with
 * pre-wrap). Henderson opens every description with a paragraph naming the
 * branch, which the location already shows, so a leading branch-name line goes.
 */
function cleanDescription(html: string | null | undefined): string {
  if (!html) return '';
  const paragraphs = html
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
    .split(/\n+/)
    .map((p) => stripHtml(p).trim())
    .filter(Boolean);
  if (paragraphs.length > 1 && BRANCH_NAME_LINE.test(paragraphs[0])) paragraphs.shift();
  return paragraphs.join('\n\n');
}

/**
 * Library programs are free unless the listing names a fee. Only a confident,
 * dollar-denominated extraction overrides "Free".
 */
function priceFrom(description: string, explicitCost?: string | null): string {
  const cost = explicitCost?.trim();
  if (cost && /\d/.test(cost) && !/^\$?0+(\.0+)?$/.test(cost)) {
    return cost.startsWith('$') ? cost : `$${cost}`;
  }
  const extracted = extractPriceFromText(description);
  if (extracted && extracted.confidence === 'high' && extracted.price.startsWith('$')) {
    return extracted.price;
  }
  return 'Free';
}

/** Body (capped) plus extra lines, as paragraphs. */
function buildDescription(parts: Array<string | undefined>): string | undefined {
  const kept = parts
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .map((p) => (p.length > MAX_DESCRIPTION ? `${p.slice(0, MAX_DESCRIPTION)}...` : p));
  return kept.length > 0 ? kept.join('\n\n') : undefined;
}

function makeEvent(
  system: SystemBase,
  fields: {
    id: string;
    title: string;
    startDate: Date;
    timeUnknown: boolean;
    url: string;
    /** The hosting branch; undefined for a system-level off-site program. */
    branch: Branch | undefined;
    location: string;
    zip: string;
    descriptionParts: Array<string | undefined>;
    price: string;
    imageUrl?: string;
  }
): ScrapedEvent {
  const host = fields.branch ? `${fields.branch.name}, ${system.systemName}` : system.systemName;
  return {
    sourceId: `library-${system.key}-${fields.id}`,
    source: 'LIBRARY',
    title: fields.title,
    description: buildDescription([...fields.descriptionParts, `Hosted by ${host}.`]),
    startDate: fields.startDate,
    location: fields.location,
    zip: fields.zip,
    organizer: fields.branch?.name ?? system.systemName,
    price: fields.price,
    url: fields.url,
    imageUrl: fields.imageUrl || undefined,
    // Always a boolean: the upsert keeps the stored value when this is undefined,
    // so a row that later gains a real time must send false to clear the flag.
    timeUnknown: fields.timeUnknown,
  };
}

/** Per-system tally of why rows were skipped, logged once per system. */
class SkipCounter {
  private counts: Record<string, number> = {};
  add(reason: string): void {
    this.counts[reason] = (this.counts[reason] || 0) + 1;
  }
  summary(): string {
    const entries = Object.entries(this.counts);
    if (entries.length === 0) return 'none';
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `${reason}=${n}`)
      .join(', ');
  }
}

/** "2026-10-01 09:30:00" -> { date, time } */
function splitLocal(value: string): { date: string; time: string } | null {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return { date: match[1], time: `${match[2]}:${match[3] ?? '00'}` };
}

// ============================================================================
// LIBRARYMARKET (Buncombe, Transylvania)
// ============================================================================

type IdMap = Record<string, string> | [] | null;

interface LibraryMarketEvent {
  id: string;
  title: string;
  type: string; // 'lc_event' | 'lc_closing'
  url: string;
  start_date: string; // local, "2026-10-01 09:30:00"
  end_date: string;
  timezone?: string;
  branch: IdMap;
  room: IdMap;
  offsite_address: string | null;
  offsite_address_raw:
    | {
        organization?: string | null;
        address_line1?: string | null;
        locality?: string | null;
        postal_code?: string | null;
      }
    | [];
  program_type: IdMap;
  age_group: IdMap;
  moderation_state: string | null; // 'published' | 'cancelled' | null (closings)
  registration_enabled: boolean;
  description: string | null;
  image: string | null;
}

function mapValues(map: IdMap): string[] {
  return map && !Array.isArray(map) ? Object.values(map) : [];
}

/** Fetch in 30-day slices; a single 60-day response is ~1.5MB and slow. */
async function fetchLibraryMarket(
  system: LibraryMarketSystem,
  w: ScrapeWindow
): Promise<LibraryMarketEvent[]> {
  const byId = new Map<string, LibraryMarketEvent>();
  let failures = 0;
  let lastError: unknown;
  let slices = 0;
  for (let offset = 0; offset < HORIZON_DAYS; offset += 30) {
    slices++;
    const start = addDays(w.startStr, offset);
    const end = addDays(w.startStr, Math.min(offset + 30, HORIZON_DAYS));
    // `end` is exclusive; both bounds select by overlap.
    const url = `${system.baseUrl}/events/feed/json?start=${start}&end=${end}`;
    // A failed slice only loses its own dates; keep the slices that worked.
    try {
      const response = await fetchWithRetry(
        url,
        { headers: HEADERS, cache: 'no-store' },
        { maxRetries: 3, baseDelay: 1000, timeoutMs: 45000 }
      );
      const rows = (await response.json()) as LibraryMarketEvent[];
      if (!Array.isArray(rows)) throw new Error(`Unexpected response from ${url}`);
      for (const row of rows) byId.set(String(row.id), row);
    } catch (error) {
      failures++;
      lastError = error;
      console.warn(
        `[${LABEL}] ${system.systemName}: slice ${start}..${end} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (failures === slices) throw lastError;
  return Array.from(byId.values());
}

function parseLibraryMarket(
  system: LibraryMarketSystem,
  rows: LibraryMarketEvent[],
  w: ScrapeWindow,
  skips: SkipCounter
): ScrapedEvent[] {
  const results: ScrapedEvent[] = [];

  for (const row of rows) {
    if (row.type !== 'lc_event') {
      skips.add('closing');
      continue;
    }
    if (row.moderation_state !== 'published') {
      skips.add('cancelled');
      continue;
    }
    const programTypes = mapValues(row.program_type);
    if (programTypes.includes('Voting')) {
      skips.add('voting');
      continue;
    }
    const title = cleanText(row.title);
    if (!title || NOT_AN_EVENT_TITLE.test(title)) {
      skips.add('title');
      continue;
    }
    const rooms = mapValues(row.room);
    if (rooms.some((r) => VIRTUAL_TEXT.test(r))) {
      skips.add('virtual');
      continue;
    }

    // Branch: the first mapped branch label. "Off Site" is a pseudo-branch for
    // programs held elsewhere; anything else unmapped (the Bookmobile) is skipped.
    const branchLabels = mapValues(row.branch);
    const mapped = branchLabels.map((b) => system.branches[b]).find(Boolean);
    const offSiteBranch = branchLabels.includes('Off Site');
    if (!mapped && !offSiteBranch) {
      skips.add('branch-out-of-range');
      continue;
    }

    // Off-site programs (the Off Site branch, or a branch program held
    // elsewhere) carry their own address, which wins over the branch's.
    let location: string;
    let zip: string;
    const raw = Array.isArray(row.offsite_address_raw) ? undefined : row.offsite_address_raw;
    if (raw?.postal_code && raw.address_line1) {
      zip = raw.postal_code.trim().slice(0, 5);
      const city = titleCase(raw.locality?.trim() || '');
      if (system.offsiteCities && !system.offsiteCities.includes(city.toLowerCase())) {
        skips.add('offsite-out-of-range');
        continue;
      }
      location = [cleanText(raw.organization), cleanText(raw.address_line1), `${city} NC ${zip}`]
        .filter(Boolean)
        .join(', ');
    } else if (mapped) {
      location = formatLocation(mapped);
      zip = mapped.zip;
    } else {
      // Off Site with no address: no way to place it or check the distance.
      skips.add('offsite-no-address');
      continue;
    }

    const start = splitLocal(row.start_date);
    const end = splitLocal(row.end_date);
    if (!start) {
      skips.add('bad-date');
      continue;
    }
    const allDay = start.time === '00:00:00' && (!end || end.time === '00:00:00');
    if (allDay && end && end.date > start.date) {
      skips.add('multi-day');
      continue;
    }
    const startDate = parseAsEastern(start.date, allDay ? ALL_DAY_TIME : start.time);
    if (!inWindow(startDate, allDay, w)) {
      skips.add('outside-window');
      continue;
    }

    const body = cleanDescription(row.description);
    const ages = mapValues(row.age_group)
      .map((a) => a.replace(/\s+/g, ' ').trim())
      .join(', ');

    results.push(
      makeEvent(system, {
        id: String(row.id),
        title,
        startDate,
        timeUnknown: allDay,
        url: row.url,
        branch: mapped,
        location,
        zip,
        descriptionParts: [
          body,
          ages ? `Ages: ${ages}.` : undefined,
          row.registration_enabled ? `Registration required: ${row.url}` : undefined,
        ],
        price: priceFrom(body),
        imageUrl: row.image || undefined,
      })
    );
  }

  return results;
}

function titleCase(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// LIBCAL (Henderson, McDowell, Polk)
// ============================================================================

interface LibCalEvent {
  id: number;
  title: string;
  description: string;
  url: string;
  startdt: string; // local, "2026-10-01 10:00:00"
  enddt: string;
  all_day: boolean;
  campus: string; // branch label, '' for system-wide notices
  location: string; // room or venue
  categories: string;
  featured_image: string;
  registration_enabled: boolean;
  registration_cost: string;
  online_event: boolean;
}

interface LibCalListResponse {
  total_results: number;
  perpage: number;
  results: LibCalEvent[];
}

const LIBCAL_PER_PAGE = 100;
const LIBCAL_MAX_PAGES = 15;

// Categories that aren't public programs.
const LIBCAL_SKIP_CATEGORIES =
  /\b(staff use|library closings|meetings|admin notices|bookmobile)\b/i;

/**
 * The upcoming-events list behind the public LibCal calendar (date=0000-00-00
 * means "from today"). It runs ~7 weeks out, which covers most of the horizon.
 */
async function fetchLibCal(system: LibCalSystem): Promise<LibCalEvent[]> {
  const all: LibCalEvent[] = [];
  for (let page = 1; page <= LIBCAL_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      c: '-1',
      date: '0000-00-00',
      perpage: String(LIBCAL_PER_PAGE),
      page: String(page),
      audience: '',
      cats: '',
      camps: '',
      inc: '0',
    });
    let data: LibCalListResponse;
    try {
      const response = await fetchWithRetry(
        `${system.baseUrl}/ajax/calendar/list?${params}`,
        {
          headers: {
            ...HEADERS,
            'X-Requested-With': 'XMLHttpRequest',
            Referer: `${system.baseUrl}/calendar`,
          },
          cache: 'no-store',
        },
        { maxRetries: 3, baseDelay: 1000 }
      );
      data = (await response.json()) as LibCalListResponse;
      if (!data || !Array.isArray(data.results)) {
        throw new Error(`Unexpected LibCal response from ${system.baseUrl}`);
      }
    } catch (error) {
      // A later page failing keeps the pages already fetched.
      if (all.length === 0) throw error;
      console.warn(
        `[${LABEL}] ${system.systemName}: page ${page} failed, keeping ${all.length} rows: ${error instanceof Error ? error.message : String(error)}`
      );
      break;
    }
    all.push(...data.results);
    if (data.results.length < LIBCAL_PER_PAGE || all.length >= data.total_results) break;
  }
  return all;
}

function parseLibCal(
  system: LibCalSystem,
  rows: LibCalEvent[],
  w: ScrapeWindow,
  skips: SkipCounter
): ScrapedEvent[] {
  const results: ScrapedEvent[] = [];

  for (const row of rows) {
    // Some programs leave the branch (campus) blank but name it in the room, e.g.
    // "Meeting Room - Marion Branch".
    const campus =
      row.campus?.trim() ||
      Object.keys(system.branches).find((label) => row.location?.includes(label)) ||
      '';
    const mapped = system.branches[campus];
    if (!mapped) {
      skips.add(row.campus ? 'branch-out-of-range' : 'no-branch');
      continue;
    }
    if (LIBCAL_SKIP_CATEGORIES.test(row.categories || '')) {
      skips.add('category');
      continue;
    }
    let title = cleanText(row.title);
    if (!title || NOT_AN_EVENT_TITLE.test(title)) {
      skips.add('title');
      continue;
    }
    // "ED Family Storytime" at Edneyville -> "Family Storytime"; the location names the branch.
    const code = title.match(/^([A-Z]{2,3})\s+\S/)?.[1];
    if (code && system.titleCodes?.[code] === campus) {
      title = title.slice(code.length).trim();
    }
    if (row.online_event) {
      skips.add('virtual');
      continue;
    }

    const start = splitLocal(row.startdt);
    const end = splitLocal(row.enddt);
    if (!start) {
      skips.add('bad-date');
      continue;
    }
    const allDay = !!row.all_day;
    if (allDay && end && end.date > start.date) {
      skips.add('multi-day');
      continue;
    }
    const startDate = parseAsEastern(start.date, allDay ? ALL_DAY_TIME : start.time);
    if (!inWindow(startDate, allDay, w)) {
      skips.add('outside-window');
      continue;
    }

    const body = cleanDescription(row.description);

    results.push(
      makeEvent(system, {
        id: String(row.id),
        title,
        startDate,
        timeUnknown: allDay,
        url: row.url,
        branch: mapped,
        location: formatLocation(mapped),
        zip: mapped.zip,
        descriptionParts: [
          body,
          row.registration_enabled ? `Registration required: ${row.url}` : undefined,
        ],
        price: priceFrom(body, row.registration_cost),
        imageUrl: row.featured_image || undefined,
      })
    );
  }

  return results;
}

// ============================================================================
// CIVICPLUS iCAL (Haywood)
// ============================================================================

type IcalDate = Date & { dateOnly?: boolean };

interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  start?: IcalDate;
  end?: IcalDate;
}

/** node-ical gives a property that has parameters as { params, val }. */
function icsText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'val' in value) {
    const val = (value as { val: unknown }).val;
    return typeof val === 'string' ? val : '';
  }
  return '';
}

/**
 * The calendar day of a DATE-only value. node-ical builds those as midnight in
 * the server's zone (00:00Z on Vercel, the previous evening in Eastern), so the
 * day is read back with local getters, as lib/scrapers/buncombecounty.ts does.
 */
function icsDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchCivicPlus(system: CivicPlusSystem): Promise<IcsEvent[]> {
  const url = `${system.baseUrl}/common/modules/iCalendar/iCalendar.aspx?catID=${system.categoryId}&feed=calendar`;
  const response = await fetchWithRetry(
    url,
    { headers: HEADERS, cache: 'no-store' },
    { maxRetries: 3, baseDelay: 1000 }
  );
  const text = await response.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error(`Not an iCal feed: ${url}`);
  // CivicPlus emits one VEVENT per occurrence (own UID, no RRULE).
  const parsed = await ical.async.parseICS(text);
  return Object.values(parsed)
    .filter((c) => c?.type === 'VEVENT')
    .map((c) => {
      const v = c as unknown as Record<string, unknown>;
      return {
        uid: icsText(v.uid).trim(),
        summary: icsText(v.summary).trim(),
        description: icsText(v.description).trim(),
        location: icsText(v.location).trim(),
        start: v.start as IcalDate | undefined,
        end: v.end as IcalDate | undefined,
      };
    });
}

function parseCivicPlus(
  system: CivicPlusSystem,
  rows: IcsEvent[],
  w: ScrapeWindow,
  skips: SkipCounter
): ScrapedEvent[] {
  const results: ScrapedEvent[] = [];

  for (const row of rows) {
    // LOCATION: "Canton Library - 11 Pennsylvania Avenue  Canton NC 28716"
    //           "Waynesville Library > Auditorium - 678 S Haywood Street ..."
    const branchLabel = row.location.split(/\s+[->]\s+/)[0].trim();
    const mapped = system.branches[branchLabel];
    if (!mapped) {
      skips.add(/virtual|<p/i.test(row.location + row.summary) ? 'virtual' : 'branch-out-of-range');
      continue;
    }
    const title = cleanText(row.summary);
    if (!title || NOT_AN_EVENT_TITLE.test(title)) {
      skips.add('title');
      continue;
    }
    if (/^virtual\b/i.test(title)) {
      skips.add('virtual');
      continue;
    }
    if (!row.start || !row.uid) {
      skips.add('bad-date');
      continue;
    }

    const allDay = Boolean(row.start.dateOnly);
    const startDay = allDay ? icsDateOnly(row.start) : '';
    // A date-only DTEND is exclusive, so a one-day event ends the next day.
    if (allDay && row.end && icsDateOnly(row.end) > addDays(startDay, 1)) {
      skips.add('multi-day');
      continue;
    }
    // Timed starts carry TZID=America/New_York (or Z), which node-ical resolves.
    const startDate = allDay ? parseAsEastern(startDay, ALL_DAY_TIME) : new Date(row.start);
    if (!inWindow(startDate, allDay, w)) {
      skips.add('outside-window');
      continue;
    }

    // Each occurrence has its own event id; the description ends with its URL.
    const url = `${system.baseUrl}/Calendar.aspx?EID=${encodeURIComponent(row.uid)}`;
    const body = cleanDescription(
      row.description.replace(/\s*https?:\/\/\S*calendar\.aspx\?EID=\d+\s*$/i, '')
    );

    results.push(
      makeEvent(system, {
        id: row.uid,
        title,
        startDate,
        timeUnknown: allDay,
        url,
        branch: mapped,
        location: formatLocation(mapped),
        zip: mapped.zip,
        descriptionParts: [body],
        price: priceFrom(body),
      })
    );
  }

  return results;
}

// ============================================================================
// WHOFI (Madison)
// ============================================================================

interface WhoFiEvent {
  id: string;
  type?: string; // 'closure' for closings
  title: string;
  clean_title?: string;
  start: string; // local, "2026-11-25 15:30:00"
  end: string;
  allDay?: boolean;
  multi_day?: boolean;
  desc?: string;
  event_type?: string; // 'In Person' | 'Live Virtual' | 'Combo in Person / Live Virtual'
  location_name?: string;
  base_url?: string;
  event_image?: string;
  registration_form_id?: string;
  age?: string;
}

async function fetchWhoFi(system: WhoFiSystem, w: ScrapeWindow): Promise<WhoFiEvent[]> {
  const params = new URLSearchParams({
    locationid: '',
    categoryid: '',
    audienceid: '',
    ageid: '',
    start: w.startStr,
    end: w.endStr,
  });
  const response = await fetchWithRetry(
    `${system.baseUrl}/calendar/fetch_calendar_events?${params}`,
    { headers: HEADERS, cache: 'no-store' },
    { maxRetries: 3, baseDelay: 1000, timeoutMs: 30000 }
  );
  const rows = (await response.json()) as WhoFiEvent[];
  if (!Array.isArray(rows)) throw new Error(`Unexpected WhoFi response from ${system.baseUrl}`);
  return rows;
}

function parseWhoFi(
  system: WhoFiSystem,
  rows: WhoFiEvent[],
  w: ScrapeWindow,
  skips: SkipCounter
): ScrapedEvent[] {
  const results: ScrapedEvent[] = [];

  for (const row of rows) {
    if (row.type === 'closure') {
      skips.add('closing');
      continue;
    }
    const mapped = system.branches[row.location_name?.trim() ?? ''];
    if (!mapped) {
      skips.add('branch-out-of-range');
      continue;
    }
    if (/^live virtual$/i.test(row.event_type?.trim() ?? '')) {
      skips.add('virtual');
      continue;
    }
    const title = cleanText(row.clean_title || row.title);
    if (!title || NOT_AN_EVENT_TITLE.test(title)) {
      skips.add('title');
      continue;
    }

    const start = splitLocal(row.start);
    const end = splitLocal(row.end);
    if (!start) {
      skips.add('bad-date');
      continue;
    }
    const allDay = !!row.allDay;
    if (row.multi_day || (allDay && end && end.date > start.date)) {
      skips.add('multi-day');
      continue;
    }
    const startDate = parseAsEastern(start.date, allDay ? ALL_DAY_TIME : start.time);
    if (!inWindow(startDate, allDay, w)) {
      skips.add('outside-window');
      continue;
    }

    const body = cleanDescription(row.desc);
    const url = `${(row.base_url || system.baseUrl).replace(/\/+$/, '')}/calendar/event/${row.id}`;
    const registration = Number(row.registration_form_id) > 0;

    results.push(
      makeEvent(system, {
        id: String(row.id),
        title,
        startDate,
        timeUnknown: allDay,
        url,
        branch: mapped,
        location: formatLocation(mapped),
        zip: mapped.zip,
        descriptionParts: [
          body,
          row.age ? `Ages: ${row.age.trim()}.` : undefined,
          registration ? `Registration required: ${url}` : undefined,
        ],
        price: priceFrom(body),
        imageUrl: row.event_image || undefined,
      })
    );
  }

  return results;
}

// ============================================================================
// ENTRY POINT
// ============================================================================

async function scrapeSystem(system: LibrarySystem, w: ScrapeWindow): Promise<ScrapedEvent[]> {
  const skips = new SkipCounter();
  let raw: unknown[];
  let events: ScrapedEvent[];

  switch (system.platform) {
    case 'librarymarket': {
      const rows = await fetchLibraryMarket(system, w);
      raw = rows;
      events = parseLibraryMarket(system, rows, w, skips);
      break;
    }
    case 'libcal': {
      const rows = await fetchLibCal(system);
      raw = rows;
      events = parseLibCal(system, rows, w, skips);
      break;
    }
    case 'civicplus': {
      const rows = await fetchCivicPlus(system);
      raw = rows;
      events = parseCivicPlus(system, rows, w, skips);
      break;
    }
    case 'whofi': {
      const rows = await fetchWhoFi(system, w);
      raw = rows;
      events = parseWhoFi(system, rows, w, skips);
      break;
    }
  }

  await debugSave(`01-${system.key}-raw.json`, raw, { label: LABEL });
  console.log(
    `[${LABEL}] ${system.systemName}: ${events.length} events from ${raw.length} rows (skipped: ${skips.summary()})`
  );
  return events;
}

export async function scrapeLibraries(): Promise<ScrapedEvent[]> {
  const w = buildWindow();
  console.log(
    `[${LABEL}] Scraping ${SYSTEMS.length} library systems, ${w.startStr} to ${w.endStr}...`
  );

  const settled = await Promise.allSettled(SYSTEMS.map((system) => scrapeSystem(system, w)));

  const all: ScrapedEvent[] = [];
  const failures: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      all.push(...result.value);
    } else {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push(`${SYSTEMS[i].systemName}: ${message}`);
      console.error(`[${LABEL}] ${SYSTEMS[i].systemName} failed: ${message}`);
    }
  });

  // Every system down at once is a scraper problem worth surfacing as a failure.
  if (failures.length === SYSTEMS.length) {
    throw new Error(`All library systems failed - ${failures.join('; ')}`);
  }

  // url is the DB's unique key; keep the first occurrence of any repeat.
  const seen = new Set<string>();
  const unique = all.filter((event) => {
    if (seen.has(event.url)) return false;
    seen.add(event.url);
    return true;
  });
  unique.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  await debugSave('02-formatted-events.json', unique, { label: LABEL });
  console.log(
    `[${LABEL}] Finished: ${unique.length} events${failures.length ? `, ${failures.length} system(s) failed` : ''}`
  );
  return unique;
}
