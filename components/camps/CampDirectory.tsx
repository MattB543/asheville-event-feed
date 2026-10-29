'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { CalendarClock, Car, ExternalLink, MapPin, Search, Tag, Users } from 'lucide-react';
import {
  CATEGORY_LABELS,
  TARGET_SEASON,
  TYPE_LABELS,
  fitsKid,
  gradeLabel,
  type CampCardData,
  type Labeled,
} from '@/lib/camps/display';

interface CampDirectoryProps {
  camps: CampCardData[];
}

type Sort = 'registration' | 'drive' | 'price' | 'name';
type DriveLimit = 'any' | '15' | '30' | '45';
const DRIVE_LIMITS: DriveLimit[] = ['any', '15', '30', '45'];
const SORTS: Sort[] = ['registration', 'drive', 'price', 'name'];

/** The kid's age or rising grade, kept on this device only (plan §4.1, "My kids"). */
const KID_STORAGE_KEY = 'avlgo:camps:kid';
const PROVIDER_PREVIEW = 4;

const GRADE_OPTIONS = [
  { value: '-1', label: 'Pre-K' },
  { value: '0', label: 'Kindergarten' },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: `${gradeLabel(i + 1)} grade`,
  })),
];

export default function CampDirectory({ camps }: CampDirectoryProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The filters live in the URL so Back from a camp restores them (as on /groups). The URL is only
  // read on mount; after that local state leads and the URL follows.
  const param = (key: string) => searchParams.get(key) ?? '';
  const [query, setQuery] = useState(() => param('q'));
  const [type, setType] = useState(() => param('type') || 'all');
  const [category, setCategory] = useState(() => param('cat') || 'all');
  const [drive, setDrive] = useState<DriveLimit>(() =>
    DRIVE_LIMITS.includes(param('drive') as DriveLimit) ? (param('drive') as DriveLimit) : 'any'
  );
  const [age, setAge] = useState(() => param('age'));
  const [grade, setGrade] = useState(() => param('grade'));
  const [sort, setSort] = useState<Sort>(() =>
    SORTS.includes(param('sort') as Sort) ? (param('sort') as Sort) : 'registration'
  );
  const [grouped, setGrouped] = useState(() => param('flat') !== '1');
  const [withUnknownDrive, setWithUnknownDrive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // replaceState, not router.replace: filtering is client-side, so no server round trip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const values: Array<[string, string, string]> = [
      ['q', query.trim(), ''],
      ['type', type, 'all'],
      ['cat', category, 'all'],
      ['drive', drive, 'any'],
      ['age', age, ''],
      ['grade', grade, ''],
      ['sort', sort, 'registration'],
      ['flat', grouped ? '' : '1', ''],
    ];
    for (const [key, value, fallback] of values) {
      if (value && value !== fallback) params.set(key, value);
      else params.delete(key);
    }
    const next = params.toString();
    if (next === window.location.search.replace(/^\?/, '')) return;
    window.history.replaceState(window.history.state, '', next ? `${pathname}?${next}` : pathname);
  }, [query, type, category, drive, age, grade, sort, grouped, pathname]);

  // Restore the kid's age / grade from this device, unless the link already says.
  useEffect(() => {
    if (searchParams.has('age') || searchParams.has('grade')) return;
    try {
      const saved = JSON.parse(localStorage.getItem(KID_STORAGE_KEY) ?? 'null') as {
        age?: string;
        grade?: string;
      } | null;
      /* eslint-disable react-hooks/set-state-in-effect -- SSR hydration: can't read localStorage during server render */
      if (saved?.age) setAge(saved.age);
      if (saved?.grade) setGrade(saved.grade);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Private mode or blocked storage: start empty.
    }
  }, [searchParams]);

  useEffect(() => {
    try {
      localStorage.setItem(KID_STORAGE_KEY, JSON.stringify({ age, grade }));
    } catch {
      // Not saved; the filter still works for this visit.
    }
  }, [age, grade]);

  const types = useMemo(() => [...new Set(camps.map((camp) => camp.type))].sort(), [camps]);
  const categories = useMemo(
    () => [...new Set(camps.flatMap((camp) => camp.categories))].sort(),
    [camps]
  );

  // Every filter but drive time, so we can say how many camps without one the drive filter hides.
  const matching = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const kid = {
      age: age === '' ? null : Number(age),
      grade: grade === '' ? null : Number(grade),
    };

    return (
      camps
        .filter((camp) => type === 'all' || camp.type === type)
        .filter((camp) => category === 'all' || camp.categories.includes(category))
        // A camp that states neither ages nor grades stays in: unknown is not "no".
        .filter((camp) => fitsKid(camp, kid) !== false)
        .filter((camp) => {
          if (terms.length === 0) return true;
          const haystack = [
            camp.name,
            camp.variant,
            camp.providerName,
            camp.town,
            TYPE_LABELS[camp.type],
            ...camp.categories.map((value) => CATEGORY_LABELS[value]),
          ]
            .join(' ')
            .toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
    );
  }, [camps, query, type, category, age, grade]);

  const filtered = useMemo(
    () =>
      matching
        .filter((camp) => {
          if (drive === 'any') return true;
          if (camp.driveMinutes === null) return withUnknownDrive;
          return camp.driveMinutes <= Number(drive);
        })
        .sort(compare(sort)),
    [matching, drive, withUnknownDrive, sort]
  );
  const noDriveTime =
    drive === 'any' ? 0 : matching.filter((camp) => camp.driveMinutes === null).length;

  function clearFilters() {
    setQuery('');
    setType('all');
    setCategory('all');
    setDrive('any');
    setAge('');
    setGrade('');
  }

  const providers = useMemo(() => {
    const map = new Map<string, CampCardData[]>();
    for (const camp of filtered)
      map.set(camp.providerName, [...(map.get(camp.providerName) ?? []), camp]);
    return [...map.entries()];
  }, [filtered]);

  const selectClasses =
    'h-9 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

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
            placeholder="Search camps, providers, towns"
            className="w-full h-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
        </label>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Age next summer</span>
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={19}
              value={age}
              onChange={(event) => setAge(event.target.value)}
              placeholder="Any"
              className={`${selectClasses} sm:w-28`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Grade in fall 2027</span>
            <select
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
              className={selectClasses}
            >
              <option value="">Any</option>
              {GRADE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
              onChange={(event) => setDrive(event.target.value as DriveLimit)}
              className={selectClasses}
            >
              <option value="any">Any distance</option>
              <option value="15">Up to 15 min</option>
              <option value="30">Up to 30 min</option>
              <option value="45">Up to 45 min</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className={selectClasses}
            >
              <option value="registration">Registration date</option>
              <option value="drive">Drive time</option>
              <option value="price">Price</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-400">
          <p aria-live="polite">
            {filtered.length} of {camps.length} camps
            {(age || grade) && ' · camps that state no ages or grades are included'}
            {noDriveTime > 0 && (
              <>
                {' · '}
                {noDriveTime} without a drive time {withUnknownDrive ? 'included' : 'hidden'}{' '}
                <button
                  type="button"
                  onClick={() => setWithUnknownDrive((current) => !current)}
                  className="font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {withUnknownDrive ? 'hide them' : 'show them'}
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

      {filtered.length === 0 ? (
        <p className="mt-6 p-8 text-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400">
          No camps match these filters.{' '}
          <button
            type="button"
            onClick={clearFilters}
            className="font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Clear filters
          </button>
        </p>
      ) : grouped ? (
        <div className="mt-6 space-y-8">
          {providers.map(([provider, list]) => {
            const open = expanded.has(provider);
            const shown = open ? list : list.slice(0, PROVIDER_PREVIEW);
            return (
              <section key={provider} aria-label={provider}>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {provider}{' '}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    ({list.length} {list.length === 1 ? 'camp' : 'camps'})
                  </span>
                </h2>
                <ul
                  id={`camps-${provider.replace(/\W+/g, '-')}`}
                  className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                >
                  {shown.map((camp) => (
                    <CampCard key={camp.slug} camp={camp} showProvider={false} />
                  ))}
                </ul>
                {list.length > PROVIDER_PREVIEW && (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`camps-${provider.replace(/\W+/g, '-')}`}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (open) next.delete(provider);
                        else next.add(provider);
                        return next;
                      })
                    }
                    className="mt-3 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
          {filtered.map((camp) => (
            <CampCard key={camp.slug} camp={camp} showProvider />
          ))}
        </ul>
      )}
    </div>
  );
}

function compare(sort: Sort) {
  const byName = (a: CampCardData, b: CampCardData) =>
    `${a.providerName} ${a.name} ${a.variant ?? ''}`.localeCompare(
      `${b.providerName} ${b.name} ${b.variant ?? ''}`
    );
  const nullsLast = (a: number | string | null, b: number | string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;

  return (a: CampCardData, b: CampCardData) => {
    if (sort === 'drive') return nullsLast(a.driveMinutes, b.driveMinutes) || byName(a, b);
    if (sort === 'price') return nullsLast(a.priceMin, b.priceMin) || byName(a, b);
    if (sort === 'registration') {
      // Upcoming openings first (soonest first), then open now, then expected, unannounced and
      // closed (Codex review §3: historical and past openings must not lead the default sort).
      return (
        TONE_RANK[a.registration.tone] - TONE_RANK[b.registration.tone] ||
        nullsLast(a.registration.sortDate, b.registration.sortDate) ||
        byName(a, b)
      );
    }
    return byName(a, b);
  };
}

const TONE_RANK: Record<string, number> = {
  upcoming: 0,
  open: 1,
  tentative: 2,
  unknown: 3,
  closed: 4,
};

const TONE_CLASSES: Record<string, string> = {
  upcoming:
    'bg-brand-50 text-brand-800 dark:bg-brand-950/60 dark:text-brand-200 border-brand-200 dark:border-brand-800',
  open: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
  closed:
    'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200 border-rose-200 dark:border-rose-800',
  tentative:
    'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 border-amber-200 dark:border-amber-800',
  unknown:
    'bg-gray-50 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300 border-gray-200 dark:border-gray-700',
};

export function YearTag({ value }: { value: { year: number; unconfirmed?: boolean } }) {
  return (
    <>
      {value.year < TARGET_SEASON && (
        <span
          title={`From summer ${value.year}; ${TARGET_SEASON} not posted yet`}
          className="ml-1.5 inline-block rounded px-1 text-[11px] font-medium leading-4 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        >
          {value.year}
        </span>
      )}
      {value.unconfirmed && (
        <span
          title="Our checker couldn't fully confirm this on the camp's page"
          className="ml-1 inline-block rounded px-1 text-[11px] font-medium leading-4 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
        >
          unconfirmed
        </span>
      )}
    </>
  );
}

function CampCard({ camp, showProvider }: { camp: CampCardData; showProvider: boolean }) {
  // Each part keeps its own summer: 2026 ages beside 2027 grades get their own "2026".
  const rows: Array<{ icon: typeof Users; label: string; parts: Labeled[] }> = [
    { icon: Users, label: 'Who', parts: camp.eligibility },
    { icon: CalendarClock, label: 'Dates', parts: camp.dates ? [camp.dates] : [] },
    { icon: CalendarClock, label: 'Hours', parts: camp.hours },
  ].filter((row) => row.parts.length > 0);

  const place =
    [camp.town, camp.state && camp.state !== 'NC' ? camp.state : null].filter(Boolean).join(', ') ||
    (camp.approximatePlace ? `Near ${camp.approximatePlace}` : '');

  return (
    <li className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className={`border-b px-3 py-2 text-sm ${TONE_CLASSES[camp.registration.tone]}`}>
        <p className="font-semibold">{camp.registration.text}</p>
        {camp.registration.detail && (
          <p className="text-xs opacity-80">{camp.registration.detail}</p>
        )}
      </div>

      <div className="flex-1 p-3">
        {showProvider && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{camp.providerName}</p>
        )}
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          <Link
            href={`/camps/${camp.slug}`}
            className="hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {camp.name}
          </Link>
        </h3>
        {camp.variant && <p className="text-sm text-gray-600 dark:text-gray-400">{camp.variant}</p>}

        <p className="mt-2 flex flex-wrap gap-1">
          <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300">
            {TYPE_LABELS[camp.type] ?? camp.type}
          </span>
          {camp.categories.slice(0, 2).map((value) => (
            <span
              key={value}
              className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300"
            >
              {CATEGORY_LABELS[value] ?? value}
            </span>
          ))}
        </p>

        <dl className="mt-3 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {rows.map(({ icon: Icon, label, parts }) => (
            <div key={label} className="flex items-start gap-2">
              <dt className="sr-only">{label}</dt>
              <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
              <dd>
                {parts.map((part, index) => (
                  <span key={part.text}>
                    {index > 0 && ' · '}
                    {part.text}
                    <YearTag value={part} />
                  </span>
                ))}
              </dd>
            </div>
          ))}
          {camp.price && (
            <div className="flex items-start gap-2">
              <dt className="sr-only">Price</dt>
              <Tag size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
              <dd>
                {camp.price.text}
                <YearTag value={camp.price} />
              </dd>
            </div>
          )}
          {(place || camp.driveMinutes !== null) && (
            <div className="flex items-start gap-2">
              <dt className="sr-only">Where</dt>
              {camp.driveMinutes !== null ? (
                <Car size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
              ) : (
                <MapPin size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
              )}
              <dd>
                {place || 'Location not stated'}
                {camp.driveMinutes !== null && ` · ${Math.round(camp.driveMinutes)} min drive`}
              </dd>
            </div>
          )}
        </dl>

        {camp.tags.length > 0 && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {camp.tags.map((tag, index) => (
              <span key={tag.text}>
                {index > 0 && ' · '}
                {tag.text}
                <YearTag value={tag} />
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-gray-100 dark:border-gray-800 px-3 py-2">
        <Link
          href={`/camps/${camp.slug}`}
          className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Details
        </Link>
        {camp.websiteUrl && (
          <a
            href={camp.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Camp website
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>
    </li>
  );
}
