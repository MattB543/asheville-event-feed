'use client';

import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, Star, X } from 'lucide-react';
import {
  CATEGORY_LABELS,
  HOURS_FILTERS,
  PRICE_BANDS,
  REGISTRATION_FILTERS,
  SUMMER_WEEKS,
  SUPPORT_LABELS,
  TARGET_SEASON,
  TYPE_LABELS,
  campSearchText,
  formatDate,
  gradeLabel,
  inTargetSeason,
  kidFit,
  matchesRegistration,
  type CampCardData,
  type CampRow,
  type CampSiteData,
  type HoursFilter,
  type KidFit,
  type PriceBand,
  type RegistrationStatus,
  type SupportKey,
} from '@/lib/camps/display';
import { kidName, parseKid, type Kid } from '@/lib/camps/chat/context';
import CampCard from './CampCard';
import CampChatButton from './CampChatButton';
import SavedCalendar from './SavedCalendar';
import { useSavedCamps } from './savedCamps';

type Sort = 'registration' | 'popular' | 'drive' | 'price' | 'name';
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'registration', label: 'Registration' },
  { value: 'popular', label: 'Most viewed' },
  { value: 'drive', label: 'Drive time' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' },
];
const DRIVE_LIMITS = ['15', '30', '45'];
const SUPPORT_KEYS = Object.keys(SUPPORT_LABELS) as SupportKey[];

/** The kids' ages and grades, kept on this device only (01 §4.1, "My kids"). */
const KIDS_STORAGE_KEY = 'avlgo:camps:kids';
const MAX_KIDS = 4;
/** Cards shown at first and per "Show more": all of them is ~1,000 cards and a slow page. */
const PAGE_SIZE = 30;

/** The valid kid tokens ("7" is age 7, "g3" a rising 3rd grader: see parseKid), up to four. */
function validKids(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) return [];
  return [
    ...new Set(
      tokens.filter((token): token is string => typeof token === 'string' && !!parseKid(token))
    ),
  ].slice(0, MAX_KIDS);
}

const AGE_OPTIONS = Array.from({ length: 16 }, (_, index) => index + 3);
const GRADE_OPTIONS = Array.from({ length: 14 }, (_, index) => index - 1);

// ---------------------------------------------------------------------------
// Matching: card filters say yes or no; row filters (kids, week, price, drive, town, hours) are
// tested together on each row (a week, session or age band, at its own site), and a camp matches
// when one row passes them all. Unknown is not "no": a camp stating no ages stays in as "may fit",
// and one with no drive time, town, price, dates or hours is hidden behind that filter's own
// "show them".
// ---------------------------------------------------------------------------

/** Yes, no, or can't tell (null). */
type Test = boolean | null;

/** The row filters a camp can lack the facts for, each with its own "show them". */
type UnknownKind = 'drive' | 'town' | 'week' | 'price' | 'hours';
const UNKNOWN_KINDS: Array<{ kind: UnknownKind; without: string }> = [
  { kind: 'drive', without: 'a drive time' },
  { kind: 'town', without: 'a town' },
  { kind: 'week', without: 'dates' },
  { kind: 'price', without: 'a price' },
  { kind: 'hours', without: 'hours' },
];
const UNKNOWN_VALUES = UNKNOWN_KINDS.map(({ kind }) => kind);
const EVERY_UNKNOWN = new Set(UNKNOWN_VALUES);

/** Which kids a camp must suit, when there are several: any one, each (by age/grade), or all in one session. */
type KidsMode = 'any' | 'all' | 'same';
const KIDS_MODES: KidsMode[] = ['any', 'all', 'same'];

interface RowFilters {
  week: { start: string; end: string } | null;
  band: (typeof PRICE_BANDS)[number] | null;
  drive: number | null;
  town: string | null;
  hours: HoursFilter | null;
}

/**
 * Does the row run that week? A row from an earlier summer is read as the same week of summer
 * 2027 (inTargetSeason), and the card then says "2026 schedule".
 */
function inWeek(row: CampRow, week: { start: string; end: string }): Test {
  if (!row.start || !row.end) return null;
  return inTargetSeason(row.start) <= week.end && inTargetSeason(row.end) >= week.start;
}

/**
 * Everything but the kids, on one row: the ways it can pass, each listing the filters it can't
 * tell for ([] is a sure match), and none when it fails one. Drive time and town are read at the
 * same site, any of the row's, so each site is a way.
 */
function rowWays(row: CampRow, camp: CampCardData, filters: RowFilters): UnknownKind[][] {
  const { week, band, drive, town, hours } = filters;
  const tests: Array<[UnknownKind, Test]> = [];
  if (week) tests.push(['week', inWeek(row, week)]);
  if (band) tests.push(['price', row.weekly.length === 0 ? null : row.weekly.some(band.test)]);
  if (hours) {
    const length = row.length === null ? null : row.length === hours;
    tests.push(['hours', hours === 'workday' ? row.workday : length]);
  }
  // A row at no known site is one way, with its drive time and town unknown
  const sites: Array<CampSiteData | null> =
    (drive !== null || town) && row.sites.length > 0
      ? row.sites.map((index) => camp.sites[index])
      : [null];
  return sites.flatMap((site) => {
    const atSite = [...tests];
    if (drive !== null) {
      atSite.push(['drive', !site || site.drive === null ? null : site.drive <= drive]);
    }
    if (town) atSite.push(['town', !site || site.town === null ? null : site.town === town]);
    if (atSite.some(([, test]) => test === false)) return [];
    return [atSite.filter(([, test]) => test === null).map(([kind]) => kind)];
  });
}

const bestFit = (fits: KidFit[]): KidFit =>
  fits.includes('fits') ? 'fits' : fits.includes('may_fit') ? 'may_fit' : 'no';
const worstFit = (fits: KidFit[]): KidFit =>
  fits.includes('no') ? 'no' : fits.includes('may_fit') ? 'may_fit' : 'fits';

interface JudgedRow {
  /** How each kid fits, and how the row fits for the kids mode. */
  fits: KidFit[];
  fit: KidFit;
  /** rowWays; none when the kids don't fit. */
  ways: UnknownKind[][];
  /** The summer the row's dates are from. */
  year: number | null;
}

interface Judged {
  camp: CampCardData;
  rows: JudgedRow[];
}

function judgeRows(
  camp: CampCardData,
  kids: Kid[],
  mode: KidsMode,
  filters: RowFilters
): JudgedRow[] {
  return camp.rows.map((row) => {
    const fits = kids.map((kid) => kidFit(row, kid));
    const fit = fits.length === 0 ? 'fits' : mode === 'same' ? worstFit(fits) : bestFit(fits);
    return {
      fits,
      fit,
      ways: fit === 'no' ? [] : rowWays(row, camp, filters),
      year: row.start ? Number(row.start.slice(0, 4)) : null,
    };
  });
}

/** The row passes when every fact it lacks is one whose camps are shown. */
const passes = (row: JudgedRow, shown: Set<UnknownKind>) =>
  row.ways.some((way) => way.every((kind) => shown.has(kind)));

/** A camp is listed when a row passes; for "all of them (by age/grade)", one per kid. */
function isListed(rows: JudgedRow[], kidCount: number, mode: KidsMode, shown: Set<UnknownKind>) {
  if (mode !== 'all') return rows.some((row) => passes(row, shown));
  return Array.from({ length: kidCount }, (_, index) =>
    rows.some((row) => row.fits[index] !== 'no' && passes(row, shown))
  ).every(Boolean);
}

interface MatchCounts {
  /** Rows that surely match (every fact known) the kids surely fit... */
  fits: number;
  /** ...and those they only may fit (by a converted age or grade, or no stated eligibility). */
  mayFit: number;
  /** The earlier summer whose weeks matched the week filter, when no 2027 week did. */
  schedule: number | null;
}

function matchCounts(rows: JudgedRow[], byWeek: boolean, shown: Set<UnknownKind>): MatchCounts {
  const sure = rows.filter((row) => row.ways.some((way) => way.length === 0));
  // The schedule is read off the rows that passed on a known week, whatever else they lack
  const dated = rows.filter((row) =>
    row.ways.some((way) => !way.includes('week') && way.every((kind) => shown.has(kind)))
  );
  const earlier = dated.every((row) => row.year !== null && row.year < TARGET_SEASON);
  return {
    fits: sure.filter((row) => row.fit === 'fits').length,
    mayFit: sure.filter((row) => row.fit === 'may_fit').length,
    schedule:
      byWeek && dated.length > 0 && earlier ? Math.max(...dated.map((row) => row.year!)) : null,
  };
}

function listJoin(parts: string[], conjunction = 'and'): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts.at(-1)}`;
}

/**
 * "3 of 9 weeks fit age 7", when the camp lists rows and a row filter is on. A row that only may
 * fit (a converted age or grade) is never counted as fitting: "2 more may fit". A camp stating no
 * ages or grades says "Ages not stated" on the card instead of "may fit".
 */
function matchNote(
  camp: CampCardData,
  counts: MatchCounts,
  filters: RowFilters,
  kidTokens: string[],
  mode: KidsMode
): string | null {
  const withKids = kidTokens.length > 0 && camp.rows.some((row) => row.ages || row.grades);
  const kids =
    kidTokens.length === 1
      ? kidName(kidTokens[0])
      : mode === 'same'
        ? kidTokens.length === 2
          ? 'both kids'
          : `all ${kidTokens.length} kids`
        : 'one of your kids';
  // The "2026 schedule" badge sits beside the note, so a camp it applies to always gets one, even
  // with no row a sure match to count
  const runsThatWeek =
    counts.schedule && filters.week ? `Runs the week of ${formatDate(filters.week.start)}` : null;
  if (!camp.listsRows || camp.rows.length < 2) {
    return (
      [
        withKids && counts.fits === 0 && counts.mayFit > 0 && `May fit ${kids}: check the ages`,
        runsThatWeek,
      ]
        .filter(Boolean)
        .join(' · ') || null
    );
  }
  const rowFiltered =
    withKids ||
    filters.week ||
    filters.band ||
    filters.drive !== null ||
    filters.town ||
    filters.hours;
  if (!rowFiltered) return null;

  const total = camp.rows.length;
  const noun = `${camp.rowNoun}${total === 1 ? '' : 's'}`;
  const sentence = (count: number, maybe: boolean) => {
    const one = count === 1;
    const verbs = [
      withKids && `${maybe ? 'may fit' : one ? 'fits' : 'fit'} ${kids}`,
      filters.week && `${one ? 'runs' : 'run'} the week of ${formatDate(filters.week.start)}`,
      filters.band && `${one ? 'is' : 'are'} ${filters.band.label.toLowerCase()}`,
      filters.drive !== null && `${one ? 'is' : 'are'} within ${filters.drive} min`,
      filters.town && `${one ? 'is' : 'are'} in ${filters.town}`,
      filters.hours &&
        (filters.hours === 'workday'
          ? `${one ? 'covers' : 'cover'} a workday`
          : `${one ? 'is' : 'are'} ${filters.hours} day`),
    ].filter((verb): verb is string => !!verb);
    return `${count === total ? `All ${total}` : `${count} of ${total}`} ${noun} ${listJoin(verbs)}`;
  };
  if (!withKids) {
    const matched = counts.fits + counts.mayFit;
    return matched > 0 ? sentence(matched, false) : runsThatWeek;
  }
  if (counts.fits > 0) {
    return `${sentence(counts.fits, false)}${counts.mayFit > 0 ? ` (${counts.mayFit} more may fit)` : ''}`;
  }
  return counts.mayFit > 0 ? sentence(counts.mayFit, true) : runsThatWeek;
}

const TONE_RANK: Record<string, number> = {
  upcoming: 0,
  open: 1,
  tentative: 2,
  unknown: 3,
  closed: 4,
};

/** Each camp's place in name order, worked out once: localeCompare is slow inside every sort. */
function nameRanks(camps: CampCardData[]): Map<string, number> {
  const sorted = [...camps].sort((a, b) =>
    `${a.name} ${a.providerName}`.localeCompare(`${b.name} ${b.providerName}`)
  );
  return new Map(sorted.map((camp, index) => [camp.id, index]));
}

function compare(sort: Sort, ranks: Map<string, number>) {
  const byName = (a: CampCardData, b: CampCardData) => ranks.get(a.id)! - ranks.get(b.id)!;
  const nullsLast = (a: number | string | null, b: number | string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;

  return (a: CampCardData, b: CampCardData) => {
    if (sort === 'popular') return b.views - a.views || byName(a, b);
    if (sort === 'drive') return nullsLast(a.driveMinutes, b.driveMinutes) || byName(a, b);
    if (sort === 'price') return nullsLast(a.priceSort, b.priceSort) || byName(a, b);
    if (sort === 'registration') {
      // Openings still ahead first (soonest first), then open now, expected, unannounced, closed
      return (
        TONE_RANK[a.registration.tone] - TONE_RANK[b.registration.tone] ||
        nullsLast(a.registration.sortDate, b.registration.sortDate) ||
        byName(a, b)
      );
    }
    return byName(a, b);
  };
}

/** The URL keys this page owns (others in the URL are left alone). */
const URL_KEYS = [
  'q',
  'kids',
  'all',
  'type',
  'cat',
  'drive',
  'town',
  'week',
  'hours',
  'price',
  'reg',
  'need',
  'sort',
  'saved',
  'group',
  'unknown',
];

const selectClasses =
  'h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const textButtonClasses =
  'font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const labelClasses = 'text-xs text-gray-500 dark:text-gray-400';

function chipClasses(active: boolean): string {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1.5 sm:py-1 text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    active
      ? 'bg-brand-600 border-brand-600 text-white'
      : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-brand-400 dark:hover:border-brand-500'
  }`;
}

export default function CampDirectory({ camps }: { camps: CampCardData[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ids: savedIds } = useSavedCamps();

  // The filters live in the URL so a filtered view can be shared and Back from a camp restores it
  // (as on /groups). The URL is only read on mount; after that local state leads and the URL follows.
  const param = (key: string) => searchParams.get(key) ?? '';
  const oneOf = <T extends string>(value: string, options: readonly T[], fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback;
  const listParam = <T extends string>(key: string, options: readonly T[]): T[] =>
    param(key)
      .split(',')
      .filter((value): value is T => options.includes(value as T));

  const [query, setQuery] = useState(() => param('q'));
  const [kids, setKids] = useState<string[]>(() => validKids(param('kids').split(',')));
  // ?all=1 is "all of them", ?all=same "all in one session"
  const [kidsMode, setKidsMode] = useState<KidsMode>(() =>
    param('all') === '1' ? 'all' : oneOf(param('all'), KIDS_MODES, 'any')
  );
  const [type, setType] = useState(() => param('type') || 'all');
  const [category, setCategory] = useState(() => param('cat') || 'all');
  const [drive, setDrive] = useState(() => oneOf(param('drive'), DRIVE_LIMITS, ''));
  const [town, setTown] = useState(() => param('town'));
  const [hours, setHours] = useState<HoursFilter | ''>(() =>
    oneOf(
      param('hours'),
      HOURS_FILTERS.map((option) => option.value),
      ''
    )
  );
  const [week, setWeek] = useState(() =>
    oneOf(
      param('week'),
      SUMMER_WEEKS.map((option) => option.start),
      ''
    )
  );
  const [price, setPrice] = useState(() =>
    oneOf(
      param('price'),
      PRICE_BANDS.map((band) => band.value),
      ''
    )
  );
  const [registration, setRegistration] = useState<RegistrationStatus | ''>(() =>
    oneOf(
      param('reg'),
      REGISTRATION_FILTERS.map((option) => option.value),
      ''
    )
  );
  const [needs, setNeeds] = useState<SupportKey[]>(() => listParam('need', SUPPORT_KEYS));
  const [sort, setSort] = useState<Sort>(() =>
    oneOf(
      param('sort'),
      SORTS.map((option) => option.value),
      'registration'
    )
  );
  const [savedOnly, setSavedOnly] = useState(() => param('saved') === '1');
  const [grouped, setGrouped] = useState(() => param('group') === '1');
  // ?unknown=1 (older links) shows every kind
  const [showUnknown, setShowUnknown] = useState<UnknownKind[]>(() =>
    param('unknown') === '1' ? UNKNOWN_VALUES : listParam('unknown', UNKNOWN_VALUES)
  );
  // Everything past the search box and the kids sits behind "Filters", so the list starts high
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();

  // The view as URL parameters: the URL follows it, and "Show more" starts over when it changes.
  const listKey = new URLSearchParams(
    (
      [
        ['q', query.trim()],
        ['kids', kids.join(',')],
        ['all', kids.length > 1 && kidsMode !== 'any' ? (kidsMode === 'all' ? '1' : kidsMode) : ''],
        ['type', type === 'all' ? '' : type],
        ['cat', category === 'all' ? '' : category],
        ['drive', drive],
        ['town', town],
        ['week', week],
        ['hours', hours],
        ['price', price],
        ['reg', registration],
        ['need', needs.join(',')],
        ['sort', sort === 'registration' ? '' : sort],
        ['saved', savedOnly ? '1' : ''],
        ['group', grouped ? '1' : ''],
        ['unknown', showUnknown.join(',')],
      ] as Array<[string, string]>
    ).filter(([, value]) => value)
  ).toString();

  // replaceState, not router.replace: filtering is client-side, so no server round trip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const own = new URLSearchParams(listKey);
    for (const key of URL_KEYS) {
      const value = own.get(key);
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const next = params.toString();
    if (next === window.location.search.replace(/^\?/, '')) return;
    window.history.replaceState(window.history.state, '', next ? `${pathname}?${next}` : pathname);
  }, [listKey, pathname]);

  // Restore the kids from this device, unless the link already names some.
  useEffect(() => {
    if (searchParams.has('kids')) return;
    try {
      const saved = validKids(JSON.parse(localStorage.getItem(KIDS_STORAGE_KEY) ?? '[]'));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration: can't read localStorage during server render
      if (saved.length > 0) setKids(saved);
    } catch {
      // Private mode or blocked storage: start empty.
    }
  }, [searchParams]);

  function updateKids(next: string[]) {
    setKids(next);
    try {
      localStorage.setItem(KIDS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not saved; the filter still works for this visit.
    }
  }

  // "Show more" is for one view: a change of filters, sort or grouping starts again at one page.
  const [more, setMore] = useState({ view: listKey, count: PAGE_SIZE });
  const limit = more.view === listKey ? more.count : PAGE_SIZE;

  const towns = useMemo(
    () =>
      [
        ...new Set(
          camps.flatMap((camp) =>
            camp.sites.map((site) => site.town).filter((name): name is string => !!name)
          )
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [camps]
  );
  const searchTexts = useMemo(
    () => new Map(camps.map((camp) => [camp.id, campSearchText(camp)])),
    [camps]
  );

  const ranks = useMemo(() => nameRanks(camps), [camps]);

  // Typing stays quick: the list catches up with the search box a moment later, and a keystroke
  // only re-runs the text match (the rows are judged when the other filters change).
  const searchQuery = useDeferredValue(query);
  const terms = useMemo(
    () => searchQuery.toLowerCase().split(/\s+/).filter(Boolean),
    [searchQuery]
  );
  const filters = useMemo(() => {
    const band = PRICE_BANDS.find((option) => option.value === price) ?? null;
    const summerWeek = SUMMER_WEEKS.find((option) => option.start === week) ?? null;
    return {
      kids: kids.map((token) => parseKid(token)!),
      // One kid is "any of them"
      kidsMode: kids.length > 1 ? kidsMode : ('any' as const),
      rows: {
        week: summerWeek && { start: summerWeek.start, end: summerWeek.end },
        band,
        drive: drive ? Number(drive) : null,
        // A town from an old link that no camp is in any more is ignored, not an empty list
        town: towns.includes(town) ? town : null,
        hours: hours || null,
      } satisfies RowFilters,
    };
  }, [kids, kidsMode, week, price, drive, town, towns, hours]);

  const types = useMemo(() => [...new Set(camps.map((camp) => camp.type))].sort(), [camps]);
  const categories = useMemo(
    () => [...new Set(camps.flatMap((camp) => camp.categories))].sort(),
    [camps]
  );

  const rowsById = useMemo(
    () =>
      new Map(
        camps.map((camp) => [
          camp.id,
          judgeRows(camp, filters.kids, filters.kidsMode, filters.rows),
        ])
      ),
    [camps, filters]
  );

  // Every camp that could be listed (with every unknown shown), with its rows judged.
  const judged = useMemo(() => {
    const saved = new Set(savedIds);
    return camps.flatMap((camp): Judged[] => {
      if (savedOnly && !saved.has(camp.id)) return [];
      if (type !== 'all' && camp.type !== type) return [];
      if (category !== 'all' && !camp.categories.includes(category)) return [];
      if (registration && !matchesRegistration(camp.registration.status, registration)) return [];
      if (!needs.every((need) => camp.support.includes(need))) return [];
      const text = searchTexts.get(camp.id)!;
      if (!terms.every((term) => text.includes(term))) return [];
      const rows = rowsById.get(camp.id)!;
      return isListed(rows, filters.kids.length, filters.kidsMode, EVERY_UNKNOWN)
        ? [{ camp, rows }]
        : [];
    });
  }, [
    camps,
    searchTexts,
    rowsById,
    savedIds,
    savedOnly,
    type,
    category,
    registration,
    needs,
    terms,
    filters,
  ]);

  const shownKinds = useMemo(() => new Set(showUnknown), [showUnknown]);

  const shown = useMemo(() => {
    const order = compare(sort, ranks);
    return judged
      .filter((entry) => isListed(entry.rows, filters.kids.length, filters.kidsMode, shownKinds))
      .sort((a, b) => order(a.camp, b.camp));
  }, [judged, filters, shownKinds, sort, ranks]);

  // Per filter that's on: how many camps its "hide them" takes away, or how many hidden camps lack
  // its fact on a row that passes the rest. A camp another unknown hides too still counts, or a camp
  // with neither a price nor hours would leave neither filter a "show them".
  const unknownNotes = useMemo(() => {
    const { rows } = filters;
    const on: Record<UnknownKind, boolean> = {
      drive: rows.drive !== null,
      town: !!rows.town,
      week: !!rows.week,
      price: !!rows.band,
      hours: !!rows.hours,
    };
    const listed = (entry: Judged, kinds: Set<UnknownKind>) =>
      isListed(entry.rows, filters.kids.length, filters.kidsMode, kinds);
    return UNKNOWN_KINDS.filter(({ kind }) => on[kind]).flatMap(({ kind, without }) => {
      const included = shownKinds.has(kind);
      const afterHiding = new Set([...shownKinds].filter((value) => value !== kind));
      const lacksIt = (entry: Judged) =>
        entry.rows.some((row) => row.ways.some((way) => way.includes(kind)));
      const count = judged.filter((entry) =>
        included
          ? listed(entry, shownKinds) && !listed(entry, afterHiding)
          : !listed(entry, shownKinds) && lacksIt(entry)
      ).length;
      return count > 0 ? [{ kind, without, included, count }] : [];
    });
  }, [judged, filters, shownKinds]);

  // Grouped: providers in the order of their first camp, cut off at the same number of cards.
  const groups = useMemo(() => {
    if (!grouped) return [];
    const byProvider = new Map<string, Judged[]>();
    for (const entry of shown) {
      const list = byProvider.get(entry.camp.providerName);
      if (list) list.push(entry);
      else byProvider.set(entry.camp.providerName, [entry]);
    }
    const visible: Array<{ provider: string; total: number; list: Judged[] }> = [];
    let left = limit;
    for (const [provider, list] of byProvider) {
      if (left <= 0) break;
      visible.push({ provider, total: list.length, list: list.slice(0, left) });
      left -= list.length;
    }
    return visible;
  }, [grouped, shown, limit]);

  // The filters behind the "Filters" button that are on
  const filterCount =
    [
      week,
      drive,
      type !== 'all',
      category !== 'all',
      filters.rows.town,
      hours,
      price,
      registration,
    ].filter(Boolean).length + needs.length;
  const filtered = filterCount > 0 || !!query.trim() || kids.length > 0 || savedOnly;

  function clearFilters() {
    setQuery('');
    updateKids([]);
    setKidsMode('any');
    setType('all');
    setCategory('all');
    setDrive('');
    setTown('');
    setWeek('');
    setHours('');
    setPrice('');
    setRegistration('');
    setNeeds([]);
    setSavedOnly(false);
    setShowUnknown([]);
  }

  function toggleUnknown(kind: UnknownKind) {
    setShowUnknown((current) =>
      current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]
    );
  }

  const card = (entry: Judged, showProvider: boolean) => {
    const counts = matchCounts(entry.rows, !!filters.rows.week, shownKinds);
    return (
      <CampCard
        key={entry.camp.id}
        camp={entry.camp}
        showProvider={showProvider}
        match={matchNote(entry.camp, counts, filters.rows, kids, filters.kidsMode)}
        schedule={counts.schedule}
      />
    );
  };

  const field = 'flex flex-col gap-1';
  // "12 of 889 camps · Clear filters": above the cards and again below them
  const countLine = (
    <>
      <span className="font-semibold text-gray-900 dark:text-gray-100">
        {shown.length.toLocaleString('en-US')}
      </span>{' '}
      of {camps.length.toLocaleString('en-US')} camps
      {filtered && (
        <>
          {' · '}
          <button type="button" onClick={clearFilters} className={textButtonClasses}>
            Clear filters
          </button>
        </>
      )}
    </>
  );

  return (
    <div>
      {/* On the page itself, no box around them */}
      <div>
        {/* The search box, then the kids and "Filters": one row from lg, two on a phone */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
          <label className="relative block lg:min-w-72 lg:flex-1">
            <span className="sr-only">Search camps</span>
            <Search
              size={16}
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search camps, activities, towns"
              className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
          </label>

          {/* The buttons drop under the kids, to the right, when a narrow phone can't fit both */}
          <div className="flex flex-wrap items-start gap-2">
            <div
              role="group"
              aria-label="Your kids (kept in this browser)"
              className="flex min-w-0 grow basis-40 flex-wrap items-center gap-2"
            >
              {kids.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => updateKids(kids.filter((kid) => kid !== token))}
                  aria-label={`Remove ${kidName(token)}`}
                  className={chipClasses(true)}
                >
                  {kidName(token).replace(/^./, (letter) => letter.toUpperCase())}
                  <X size={14} aria-hidden="true" />
                </button>
              ))}
              {kids.length < MAX_KIDS && (
                <label className="w-40" title="Kept in this browser">
                  <span className="sr-only">Add a kid by age or grade</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const token = event.target.value;
                      if (token && !kids.includes(token)) updateKids([...kids, token]);
                    }}
                    className={selectClasses}
                  >
                    <option value="">Add kid details</option>
                    <optgroup label="Age next summer">
                      {AGE_OPTIONS.map((age) => (
                        <option key={age} value={String(age)}>
                          Age {age}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Grade in fall 2027">
                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={`g${grade}`}>
                          {grade === -1
                            ? 'Pre-K'
                            : grade === 0
                              ? 'Kindergarten'
                              : `${gradeLabel(grade)} grade`}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              )}
              {kids.length > 1 && (
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  Camps for
                  <select
                    value={kidsMode}
                    onChange={(event) => setKidsMode(event.target.value as KidsMode)}
                    className={`${selectClasses} w-auto`}
                  >
                    <option value="any">any of them</option>
                    <option value="all">all of them (by age/grade)</option>
                    <option value="same">all of them, same session</option>
                  </select>
                </label>
              )}
            </div>
            <div className="ml-auto flex shrink-0 gap-2">
              <button
                type="button"
                aria-expanded={filtersOpen}
                aria-controls={filtersId}
                onClick={() => setFiltersOpen((open) => !open)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  filterCount > 0 || filtersOpen
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/50 dark:text-brand-300'
                    : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-brand-400 dark:hover:border-brand-500'
                }`}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                Filters{filterCount > 0 && ` (${filterCount})`}
              </button>
              <CampChatButton directory={listKey} totalCount={camps.length} />
            </div>
          </div>
        </div>

        <div id={filtersId} hidden={!filtersOpen} className="mt-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <label className={field}>
              <span className={labelClasses}>Week</span>
              <select
                value={week}
                onChange={(event) => setWeek(event.target.value)}
                className={selectClasses}
              >
                <option value="">Any week</option>
                {SUMMER_WEEKS.map((option) => (
                  <option key={option.start} value={option.start}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className={labelClasses}>Drive from downtown</span>
              <select
                value={drive}
                onChange={(event) => setDrive(event.target.value)}
                className={selectClasses}
              >
                <option value="">Any distance</option>
                {DRIVE_LIMITS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    Up to {minutes} min
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className={labelClasses}>Type</span>
              <select
                value={type}
                onChange={(event) => setType(event.target.value)}
                className={selectClasses}
              >
                <option value="all">All types</option>
                {types.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className={labelClasses}>Category</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className={selectClasses}
              >
                <option value="all">All categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className={labelClasses}>Town</span>
              <select
                value={filters.rows.town ?? ''}
                onChange={(event) => setTown(event.target.value)}
                className={selectClasses}
              >
                <option value="">Any town</option>
                {towns.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className={labelClasses}>Hours</span>
              <select
                value={hours}
                onChange={(event) => setHours(event.target.value as HoursFilter | '')}
                className={selectClasses}
              >
                <option value="">Any hours</option>
                {HOURS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className={labelClasses}>Price</span>
              <select
                value={price}
                onChange={(event) => setPrice(event.target.value as PriceBand | '')}
                className={selectClasses}
              >
                <option value="">Any price</option>
                {PRICE_BANDS.map((band) => (
                  <option key={band.value} value={band.value}>
                    {band.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className={labelClasses}>Registration</span>
              <select
                value={registration}
                onChange={(event) => setRegistration(event.target.value as RegistrationStatus | '')}
                className={selectClasses}
              >
                <option value="">Any</option>
                {REGISTRATION_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Must offer">
            {SUPPORT_KEYS.map((key) => {
              const active = needs.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setNeeds(active ? needs.filter((need) => need !== key) : [...needs, key])
                  }
                  className={chipClasses(active)}
                >
                  {SUPPORT_LABELS[key]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {(savedIds.length > 0 || savedOnly) && (
        <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 sm:p-4">
          {/* The calendar button sits on this row; once subscribed, its links take a full line */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Star
              size={16}
              aria-hidden="true"
              className="text-amber-600 dark:text-amber-400"
              fill="currentColor"
            />
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {savedIds.length} saved {savedIds.length === 1 ? 'camp' : 'camps'}
            </span>
            <button
              type="button"
              aria-pressed={savedOnly}
              onClick={() => setSavedOnly((current) => !current)}
              className={chipClasses(savedOnly)}
            >
              Show only saved
            </button>
            <SavedCalendar />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
        <div aria-live="polite" className="space-y-0.5">
          <p>{countLine}</p>
          {kids.length > 0 && (
            <p className="text-xs">Camps that state no ages or grades are included.</p>
          )}
          {unknownNotes.map((note) => (
            <p key={note.kind}>
              {note.count} without {note.without} {note.included ? 'included' : 'hidden'}
              {' · '}
              <button
                type="button"
                onClick={() => toggleUnknown(note.kind)}
                className={textButtonClasses}
              >
                {note.included ? 'hide them' : 'show them'}
              </button>
            </p>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="inline-flex items-center gap-2">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className={`${selectClasses} w-auto`}
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex min-h-9 items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(event) => setGrouped(event.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
            Group by provider
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 p-8 text-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400">
          No camps match these filters.{' '}
          <button type="button" onClick={clearFilters} className={textButtonClasses}>
            Clear filters
          </button>
        </p>
      ) : grouped ? (
        <div className="mt-4 space-y-8">
          {groups.map(({ provider, total, list }) => (
            <section key={provider} aria-label={provider}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {provider}{' '}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  ({total} {total === 1 ? 'camp' : 'camps'})
                </span>
              </h2>
              <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((entry) => card(entry, false))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.slice(0, limit).map((entry) => card(entry, true))}
        </ul>
      )}

      {shown.length > limit && (
        <div className="mt-6 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMore({ view: listKey, count: limit + PAGE_SIZE })}
            className="min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 text-sm font-medium cursor-pointer text-gray-800 dark:text-gray-200 hover:border-brand-400 hover:text-brand-700 dark:hover:border-brand-500 dark:hover:text-brand-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Show {Math.min(PAGE_SIZE, shown.length - limit)} more
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Showing {limit} of {shown.length.toLocaleString('en-US')}
          </p>
        </div>
      )}

      {shown.length > 0 && (
        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">{countLine}</p>
      )}
    </div>
  );
}
