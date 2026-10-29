'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, Star, X } from 'lucide-react';
import {
  CATEGORY_LABELS,
  HOURS_FILTERS,
  PRICE_BANDS,
  REGISTRATION_FILTERS,
  matchesRegistration,
  SUMMER_WEEKS,
  SUPPORT_LABELS,
  TARGET_SEASON,
  TYPE_LABELS,
  formatDate,
  gradeLabel,
  kidFit,
  type CampCardData,
  type CampRow,
  type HoursFilter,
  type KidFit,
  type PriceBand,
  type RegistrationStatus,
  type SupportKey,
} from '@/lib/camps/display';
import CampCard from './CampCard';
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
const PROVIDER_PREVIEW = 4;

/**
 * A kid as the URL and this browser keep it: "7" is age 7 next summer, "g3" a rising 3rd grader
 * (grade in fall 2027; pre-K is g-1, kindergarten g0).
 */
interface Kid {
  age: number | null;
  grade: number | null;
}

function parseKid(token: string): Kid | null {
  const match = /^(g?)(-?\d{1,2})$/.exec(token);
  if (!match) return null;
  const value = Number(match[2]);
  if (match[1]) return value >= -1 && value <= 12 ? { age: null, grade: value } : null;
  return value >= 2 && value <= 19 ? { age: value, grade: null } : null;
}

function validKids(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) return [];
  return [
    ...new Set(
      tokens.filter((token): token is string => typeof token === 'string' && !!parseKid(token))
    ),
  ].slice(0, MAX_KIDS);
}

function gradeKid(grade: number): string {
  if (grade < 0) return 'rising pre-K';
  if (grade === 0) return 'rising kindergartner';
  return `rising ${gradeLabel(grade)} grader`;
}

/** "age 7", "rising 3rd grader" */
function kidName(token: string): string {
  const kid = parseKid(token)!;
  return kid.age !== null ? `age ${kid.age}` : gradeKid(kid.grade!);
}

const AGE_OPTIONS = Array.from({ length: 16 }, (_, index) => index + 3);
const GRADE_OPTIONS = Array.from({ length: 14 }, (_, index) => index - 1);

// ---------------------------------------------------------------------------
// Matching: card filters say yes or no; row filters (kids, week, price, drive, town, hours) are
// tested together on each row (a week, session or age band, at its own site), and a camp matches
// when one row passes them all. Unknown is not "no": a camp stating no ages stays in as "may fit",
// and one with no drive time, town, price, hours or 2027 dates is hidden behind "show them".
// ---------------------------------------------------------------------------

type Verdict = 'match' | 'unknown' | 'no';
/** Yes, no, or can't tell (null). */
type Test = boolean | null;

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

const allOf = (tests: Test[]): Test =>
  tests.includes(false) ? false : tests.includes(null) ? null : true;
const anyOf = (tests: Test[]): Test =>
  tests.includes(true) ? true : tests.includes(null) ? null : false;

/** Everything but the kids, on one row: drive time and town on the same site of that row. */
function rowVerdict(row: CampRow, camp: CampCardData, filters: RowFilters): Verdict {
  const tests: Test[] = [];
  if (filters.week) {
    // 2026 weeks say nothing about 2027's
    tests.push(
      !row.start || !row.end || !row.start.startsWith(String(TARGET_SEASON))
        ? null
        : row.start <= filters.week.end && row.end >= filters.week.start
    );
  }
  if (filters.band) {
    tests.push(row.weekly.length === 0 ? null : row.weekly.some(filters.band.test));
  }
  if (filters.drive !== null || filters.town) {
    const atSite = (index: number): Test => {
      const site = camp.sites[index];
      return allOf([
        filters.drive === null ? true : site.drive === null ? null : site.drive <= filters.drive,
        !filters.town ? true : site.town === null ? null : site.town === filters.town,
      ]);
    };
    tests.push(row.sites.length === 0 ? null : anyOf(row.sites.map(atSite)));
  }
  if (filters.hours) {
    tests.push(
      filters.hours === 'workday'
        ? row.workday
        : row.length === null
          ? null
          : row.length === filters.hours
    );
  }
  const result = allOf(tests);
  return result === false ? 'no' : result === null ? 'unknown' : 'match';
}

const bestFit = (fits: KidFit[]): KidFit =>
  fits.includes('fits') ? 'fits' : fits.includes('may_fit') ? 'may_fit' : 'no';
const worstFit = (fits: KidFit[]): KidFit =>
  fits.includes('no') ? 'no' : fits.includes('may_fit') ? 'may_fit' : 'fits';
const bestVerdict = (verdicts: Verdict[]): Verdict =>
  verdicts.includes('match') ? 'match' : verdicts.includes('unknown') ? 'unknown' : 'no';
const worstVerdict = (verdicts: Verdict[]): Verdict =>
  verdicts.includes('no') ? 'no' : verdicts.includes('unknown') ? 'unknown' : 'match';

interface Judged {
  verdict: Verdict;
  /** Matching rows the kids surely fit... */
  fits: number;
  /** ...and those they only may fit (by a converted age or grade, or no stated eligibility). */
  mayFit: number;
}

/** A camp's verdict and how many of its rows matched; null when no row passes. */
function judgeCamp(
  camp: CampCardData,
  kids: Kid[],
  mode: KidsMode,
  filters: RowFilters
): Judged | null {
  const rows = camp.rows.map((row) => {
    const fits = kids.map((kid) => kidFit(row, kid));
    const fit = fits.length === 0 ? 'fits' : mode === 'same' ? worstFit(fits) : bestFit(fits);
    return { fits, fit, verdict: fit === 'no' ? 'no' : rowVerdict(row, camp, filters) };
  });
  // "All of them": each kid needs a row of its own that passes
  const verdict =
    mode === 'all'
      ? worstVerdict(
          kids.map((_, index) =>
            bestVerdict(rows.filter((row) => row.fits[index] !== 'no').map((row) => row.verdict))
          )
        )
      : bestVerdict(rows.map((row) => row.verdict));
  if (verdict === 'no') return null;
  const matched = rows.filter((row) => row.verdict === 'match');
  return {
    verdict,
    fits: matched.filter((row) => row.fit === 'fits').length,
    mayFit: matched.filter((row) => row.fit === 'may_fit').length,
  };
}

function listJoin(parts: string[], conjunction = 'and'): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts.at(-1)}`;
}

/**
 * "3 of 9 weeks fit age 7", when the camp lists rows and a row filter is on. A row that only may
 * fit (a converted age or grade, or none stated) is never counted as fitting: "2 more may fit".
 */
function matchNote(
  camp: CampCardData,
  judged: Judged,
  filters: RowFilters,
  kidTokens: string[],
  mode: KidsMode
): string | null {
  const kids =
    kidTokens.length === 1
      ? kidName(kidTokens[0])
      : mode === 'same'
        ? kidTokens.length === 2
          ? 'both kids'
          : `all ${kidTokens.length} kids`
        : 'one of your kids';
  if (!camp.listsRows || camp.rows.length < 2) {
    return kidTokens.length > 0 && judged.fits === 0 && judged.mayFit > 0
      ? `May fit ${kids}: check the ages`
      : null;
  }
  const rowFiltered =
    kidTokens.length > 0 ||
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
      kidTokens.length > 0 && `${maybe ? 'may fit' : one ? 'fits' : 'fit'} ${kids}`,
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
  if (judged.fits > 0) {
    return `${sentence(judged.fits, false)}${judged.mayFit > 0 ? ` (${judged.mayFit} more may fit)` : ''}`;
  }
  return judged.mayFit > 0 ? sentence(judged.mayFit, true) : null;
}

const TONE_RANK: Record<string, number> = {
  upcoming: 0,
  open: 1,
  tentative: 2,
  unknown: 3,
  closed: 4,
};

function compare(sort: Sort) {
  const byName = (a: CampCardData, b: CampCardData) =>
    `${a.name} ${a.providerName}`.localeCompare(`${b.name} ${b.providerName}`);
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

const selectClasses =
  'h-9 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const textButtonClasses =
  'font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

function chipClasses(active: boolean): string {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1.5 sm:py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
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
  const [grouped, setGrouped] = useState(() => param('flat') !== '1');
  const [withUnknown, setWithUnknown] = useState(() => param('unknown') === '1');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(
    () =>
      !!(
        param('week') ||
        param('price') ||
        param('reg') ||
        param('need') ||
        param('town') ||
        param('hours')
      )
  );

  // replaceState, not router.replace: filtering is client-side, so no server round trip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const values: Array<[string, string]> = [
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
      ['flat', grouped ? '' : '1'],
      ['unknown', withUnknown ? '1' : ''],
    ];
    for (const [key, value] of values) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const next = params.toString();
    if (next === window.location.search.replace(/^\?/, '')) return;
    window.history.replaceState(window.history.state, '', next ? `${pathname}?${next}` : pathname);
  }, [
    query,
    kids,
    kidsMode,
    type,
    category,
    drive,
    town,
    week,
    hours,
    price,
    registration,
    needs,
    sort,
    savedOnly,
    grouped,
    withUnknown,
    pathname,
  ]);

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

  const filters = useMemo(() => {
    const band = PRICE_BANDS.find((option) => option.value === price) ?? null;
    const summerWeek = SUMMER_WEEKS.find((option) => option.start === week) ?? null;
    return {
      terms: query.toLowerCase().split(/\s+/).filter(Boolean),
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
  }, [query, kids, kidsMode, week, price, drive, town, towns, hours]);

  const types = useMemo(() => [...new Set(camps.map((camp) => camp.type))].sort(), [camps]);
  const categories = useMemo(
    () => [...new Set(camps.flatMap((camp) => camp.categories))].sort(),
    [camps]
  );

  // Every camp with its verdict and how many of its rows matched.
  const judged = useMemo(() => {
    const saved = new Set(savedIds);
    return camps.flatMap((camp) => {
      if (savedOnly && !saved.has(camp.id)) return [];
      if (type !== 'all' && camp.type !== type) return [];
      if (category !== 'all' && !camp.categories.includes(category)) return [];
      if (registration && !matchesRegistration(camp.registration.status, registration)) return [];
      if (!needs.every((need) => camp.support.includes(need))) return [];
      if (!filters.terms.every((term) => camp.search.includes(term))) return [];
      const result = judgeCamp(camp, filters.kids, filters.kidsMode, filters.rows);
      return result ? [{ camp, ...result }] : [];
    });
  }, [camps, savedIds, savedOnly, type, category, registration, needs, filters]);

  const unknownCount = judged.filter((entry) => entry.verdict === 'unknown').length;
  const unknownKinds = [
    filters.rows.drive !== null && 'a drive time',
    filters.rows.town && 'a town',
    filters.rows.band && 'a price',
    filters.rows.week && '2027 dates',
    filters.rows.hours && 'hours',
  ].filter((kind): kind is string => !!kind);

  const shown = useMemo(
    () =>
      judged
        .filter((entry) => withUnknown || entry.verdict === 'match')
        .sort((a, b) => compare(sort)(a.camp, b.camp)),
    [judged, withUnknown, sort]
  );

  const providers = useMemo(() => {
    const map = new Map<string, typeof shown>();
    for (const entry of shown)
      map.set(entry.camp.providerName, [...(map.get(entry.camp.providerName) ?? []), entry]);
    return [...map.entries()];
  }, [shown]);

  const moreCount =
    [week, price, registration, filters.rows.town, hours].filter(Boolean).length + needs.length;
  const filtered =
    moreCount > 0 ||
    !!query.trim() ||
    kids.length > 0 ||
    type !== 'all' ||
    category !== 'all' ||
    !!drive ||
    savedOnly;

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
  }

  const card = (entry: (typeof shown)[number], showProvider: boolean) => (
    <CampCard
      key={entry.camp.id}
      camp={entry.camp}
      showProvider={showProvider}
      match={matchNote(entry.camp, entry, filters.rows, kids, filters.kidsMode)}
    />
  );

  return (
    <div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 sm:p-4 space-y-3">
        <label className="relative block">
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
            className="w-full h-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
        </label>

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Your kids{' '}
            <span className="text-gray-400 dark:text-gray-500">(kept in this browser)</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
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
              <label className="w-44">
                <span className="sr-only">Add a kid by age or grade</span>
                <select
                  value=""
                  onChange={(event) => {
                    const token = event.target.value;
                    if (token && !kids.includes(token)) updateKids([...kids, token]);
                  }}
                  className={selectClasses}
                >
                  <option value="">{kids.length ? 'Add another kid…' : 'Add a kid…'}</option>
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
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Type</span>
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
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Category</span>
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
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Drive from downtown</span>
            <select
              value={drive}
              onChange={(event) => setDrive(event.target.value)}
              className={selectClasses}
            >
              <option value="">Any distance</option>
              {DRIVE_LIMITS.map((limit) => (
                <option key={limit} value={limit}>
                  Up to {limit} min
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className={selectClasses}
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {/* Below sm these sit behind "More filters", so the list starts higher on a phone */}
          <label className={`${moreOpen ? 'flex' : 'hidden'} sm:flex flex-col gap-1`}>
            <span className="text-xs text-gray-500 dark:text-gray-400">Town</span>
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
          <label className={`${moreOpen ? 'flex' : 'hidden'} sm:flex flex-col gap-1`}>
            <span className="text-xs text-gray-500 dark:text-gray-400">Week</span>
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
          <label className={`${moreOpen ? 'flex' : 'hidden'} sm:flex flex-col gap-1`}>
            <span className="text-xs text-gray-500 dark:text-gray-400">Hours</span>
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
          <label className={`${moreOpen ? 'flex' : 'hidden'} sm:flex flex-col gap-1`}>
            <span className="text-xs text-gray-500 dark:text-gray-400">Price</span>
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
          <label className={`${moreOpen ? 'flex' : 'hidden'} sm:flex flex-col gap-1`}>
            <span className="text-xs text-gray-500 dark:text-gray-400">Registration</span>
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

        <div
          className={`${moreOpen ? 'flex' : 'hidden'} sm:flex flex-wrap gap-2`}
          role="group"
          aria-label="Must offer"
        >
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

        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className={`sm:hidden inline-flex items-center gap-1.5 text-sm ${textButtonClasses}`}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {moreOpen ? 'Fewer filters' : `More filters${moreCount ? ` (${moreCount} on)` : ''}`}
        </button>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-400">
          <p aria-live="polite">
            {shown.length} of {camps.length} camps
            {kids.length > 0 && ' · camps that state no ages or grades are included'}
            {unknownCount > 0 && unknownKinds.length > 0 && (
              <>
                {' · '}
                {unknownCount} without {listJoin(unknownKinds, 'or')}{' '}
                {withUnknown ? 'included' : 'hidden'}{' '}
                <button
                  type="button"
                  onClick={() => setWithUnknown((current) => !current)}
                  className={textButtonClasses}
                >
                  {withUnknown ? 'hide them' : 'show them'}
                </button>
              </>
            )}
            {filtered && (
              <>
                {' · '}
                <button type="button" onClick={clearFilters} className={textButtonClasses}>
                  Clear filters
                </button>
              </>
            )}
          </p>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(event) => setGrouped(event.target.checked)}
            />
            Group by provider
          </label>
        </div>
      </div>

      {(savedIds.length > 0 || savedOnly) && (
        <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 sm:p-4 space-y-3">
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
          </div>
          <SavedCalendar />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="mt-6 p-8 text-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400">
          No camps match these filters.{' '}
          <button type="button" onClick={clearFilters} className={textButtonClasses}>
            Clear filters
          </button>
        </p>
      ) : grouped ? (
        <div className="mt-6 space-y-8">
          {providers.map(([provider, list]) => {
            const open = expanded.has(provider);
            const listId = `camps-${provider.replace(/\W+/g, '-')}`;
            return (
              <section key={provider} aria-label={provider}>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {provider}{' '}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    ({list.length} {list.length === 1 ? 'camp' : 'camps'})
                  </span>
                </h2>
                <ul id={listId} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(open ? list : list.slice(0, PROVIDER_PREVIEW)).map((entry) =>
                    card(entry, false)
                  )}
                </ul>
                {list.length > PROVIDER_PREVIEW && (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (open) next.delete(provider);
                        else next.add(provider);
                        return next;
                      })
                    }
                    className={`mt-3 text-sm ${textButtonClasses}`}
                  >
                    {open ? 'Show fewer' : `Show all ${list.length} ${provider} camps`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((entry) => card(entry, true))}
        </ul>
      )}
    </div>
  );
}
