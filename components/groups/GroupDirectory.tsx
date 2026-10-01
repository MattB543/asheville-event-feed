'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { MapPin, Search, X } from 'lucide-react';
import { GROUP_CATEGORIES, groupCategoryLabel } from '@/lib/groups/categories';
import { useDebounce } from '@/lib/hooks/useDebounce';
import type { GroupDirectoryEntry } from '@/lib/db/queries/groups';

interface GroupDirectoryProps {
  groups: GroupDirectoryEntry[];
  /** Fresh per request (see app/groups/page.tsx); orders ties, see tiebreak(). */
  shuffleSeed: string;
}

/** 'all' or a category value. Unknown categories (shouldn't exist) collect under 'other'. */
type CategoryFilter = string;

const ALL = 'all';
const OTHER = 'other';
const KNOWN_CATEGORIES = new Set<string>(GROUP_CATEGORIES.map((c) => c.value));

/** The unfiltered "All" view shows this many cards per category before "See all N". */
const COMPACT_SECTION_LIMIT = 6;

/** How long typing has to settle before the search is written to the URL. */
const URL_DEBOUNCE_MS = 300;

function sectionOf(group: GroupDirectoryEntry): string {
  return KNOWN_CATEGORIES.has(group.category) ? group.category : OTHER;
}

/**
 * Every search word has to appear somewhere in the name, description, home base or category label.
 * A word of 4+ letters ending in "s" also matches without it, so "board games" finds "board game".
 */
function matchesSearch(group: GroupDirectoryEntry, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    group.name,
    group.description,
    group.homeBase,
    groupCategoryLabel(group.category),
  ]
    .join(' ')
    .toLowerCase();
  return terms.every(
    (term) =>
      haystack.includes(term) ||
      (term.length >= 4 && term.endsWith('s') && haystack.includes(term.slice(0, -1)))
  );
}

/** How much a group has going on: every upcoming event counts 1, every past one 0.5. */
function activityScore(group: GroupDirectoryEntry): number {
  return group.upcomingCount + 0.5 * group.pastCount;
}

/**
 * A random-looking but repeatable rank for breaking ties: FNV-1a over seed + slug. Not
 * Math.random, because the server and the browser both render this list and must agree on the
 * order or React throws a hydration mismatch (same reason as posterJitter in
 * lib/posters/posterDisplay.ts). The seed is new on every request, so ties reshuffle per visit.
 */
function tiebreak(seed: string, slug: string): number {
  let hash = 0x811c9dc5;
  const input = `${seed}:${slug}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Groups with something coming up first, then the rest (so a dormant group with a long history
 * never outranks one that's meeting this week); by activity score within each; ties in random order.
 */
function compareGroups(seed: string) {
  return (a: GroupDirectoryEntry, b: GroupDirectoryEntry): number => {
    const aActive = a.upcomingCount > 0 ? 0 : 1;
    const bActive = b.upcomingCount > 0 ? 0 : 1;
    return (
      aActive - bActive ||
      activityScore(b) - activityScore(a) ||
      tiebreak(seed, a.slug) - tiebreak(seed, b.slug)
    );
  };
}

/**
 * On the one-row phone chip strip, scroll the strip (never the page) so the chip for `value` is in
 * view - a category restored from the URL could otherwise be selected but off-screen. From `sm:` up
 * the chips wrap and nothing overflows, so this does nothing there.
 */
function revealChip(row: HTMLElement | null, value: string) {
  const chip = row?.querySelector<HTMLElement>(`[data-category="${value}"]`);
  if (!row || !chip) return;
  const rowRect = row.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  if (chipRect.left < rowRect.left || chipRect.right > rowRect.right) {
    row.scrollLeft += chipRect.left - rowRect.left - 12;
  }
}

function chipClasses(active: boolean, empty: boolean): string {
  const base =
    'inline-flex shrink-0 items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 dark:focus-visible:ring-offset-gray-950';
  if (active) {
    return `${base} bg-brand-600 border-brand-600 text-white`;
  }
  return `${base} bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-500 ${
    empty ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-300'
  }`;
}

/** The count inside a chip; full-strength text so it stays readable (4.5:1) on both backgrounds. */
function chipCountClasses(active: boolean): string {
  return active ? 'text-white' : 'text-gray-600 dark:text-gray-400';
}

export default function GroupDirectory({ groups, shuffleSeed }: GroupDirectoryProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const categories = useMemo(() => {
    const list: { value: string; label: string }[] = GROUP_CATEGORIES.map((c) => ({
      value: c.value,
      label: c.label,
    }));
    if (groups.some((g) => sectionOf(g) === OTHER)) {
      list.push({ value: OTHER, label: groupCategoryLabel(OTHER) });
    }
    return list;
  }, [groups]);

  // The filters live in the URL (?q=, ?cat=) so Back from a group page restores them. The URL is
  // only read on mount; after that local state leads and the URL follows.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [category, setCategory] = useState<CategoryFilter>(() => {
    const cat = searchParams.get('cat');
    return cat && categories.some((c) => c.value === cat) ? cat : ALL;
  });
  const debouncedQuery = useDebounce(query, URL_DEBOUNCE_MS);
  const searchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const chipRowRef = useRef<HTMLDivElement>(null);

  // replaceState, not router.replace: the filtering is all client-side, and a router navigation
  // would re-render the dynamic page on the server (all ~390 groups) on every keystroke. Next keeps
  // useSearchParams in sync with history.replaceState. Replace rather than push so filtering never
  // piles up history entries; defaults and an unknown ?cat= drop out, other params are left alone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = debouncedQuery.trim();
    if (q) params.set('q', q);
    else params.delete('q');
    if (category !== ALL) params.set('cat', category);
    else params.delete('cat');

    const next = params.toString();
    if (next === window.location.search.replace(/^\?/, '')) return;
    window.history.replaceState(window.history.state, '', next ? `${pathname}?${next}` : pathname);
  }, [debouncedQuery, category, pathname]);

  useEffect(() => {
    if (category !== ALL) revealChip(chipRowRef.current, category);
  }, [category]);

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  // Search first, so chip counts say how many each category would show for this search.
  const searched = useMemo(() => groups.filter((g) => matchesSearch(g, terms)), [groups, terms]);

  const countsByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of searched) {
      const section = sectionOf(group);
      counts.set(section, (counts.get(section) ?? 0) + 1);
    }
    return counts;
  }, [searched]);

  const sections = useMemo(
    () =>
      categories
        .filter((c) => category === ALL || c.value === category)
        .map((c) => ({
          ...c,
          groups: searched.filter((g) => sectionOf(g) === c.value).sort(compareGroups(shuffleSeed)),
        }))
        .filter((section) => section.groups.length > 0),
    [categories, category, searched, shuffleSeed]
  );

  const visibleCount = sections.reduce((sum, section) => sum + section.groups.length, 0);
  const filtering = terms.length > 0 || category !== ALL;
  // Nothing in this category, but the search does match elsewhere: offer to widen, not to clear.
  const canWidenSearch = terms.length > 0 && category !== ALL && searched.length > 0;

  // The clear / widen buttons disappear once they've done their job, so hand focus back to the
  // search box.
  function clearSearch() {
    setQuery('');
    searchRef.current?.focus();
  }

  function clearFilters() {
    setCategory(ALL);
    clearSearch();
  }

  function searchAllCategories() {
    setCategory(ALL);
    searchRef.current?.focus();
  }

  // "See all N" disappears with the compact view, so focus moves to the chip it just selected.
  function seeAll(value: string) {
    setCategory(value);
    chipRowRef.current
      ?.querySelector<HTMLButtonElement>(`[data-category="${value}"]`)
      ?.focus({ preventScroll: true });
    rootRef.current?.scrollIntoView({ block: 'start' });
  }

  return (
    <div ref={rootRef}>
      <div className="relative max-w-xl">
        <label htmlFor={searchId} className="sr-only">
          Search groups
        </label>
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
        />
        <input
          ref={searchRef}
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search groups, interests, places"
          autoComplete="off"
          className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Phones: one row that scrolls sideways and bleeds to the screen edge (py-1 keeps the focus
          ring from being clipped by the scroller). sm and up: the chips wrap. */}
      <div
        ref={chipRowRef}
        role="group"
        aria-label="Filter by category"
        className="mt-3 sm:mt-4 -mx-3 px-3 py-1 sm:mx-0 sm:px-0 sm:py-0 flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          type="button"
          aria-pressed={category === ALL}
          onClick={() => setCategory(ALL)}
          className={chipClasses(category === ALL, searched.length === 0)}
        >
          All
          <span className={chipCountClasses(category === ALL)}>{searched.length}</span>
        </button>
        {categories.map((c) => {
          const count = countsByCategory.get(c.value) ?? 0;
          const active = category === c.value;
          return (
            <button
              key={c.value}
              type="button"
              data-category={c.value}
              aria-pressed={active}
              onClick={() => setCategory(active ? ALL : c.value)}
              className={chipClasses(active, count === 0)}
            >
              {c.label}
              <span className={chipCountClasses(active)}>{count}</span>
            </button>
          );
        })}
      </div>

      <p aria-live="polite" className="sr-only">
        {filtering ? `${visibleCount} group${visibleCount === 1 ? '' : 's'} shown` : ''}
      </p>

      {sections.length === 0 ? (
        <div className="mt-8 p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <p className="text-gray-600 dark:text-gray-400">
            {terms.length > 0 ? (
              <>
                No groups match <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span>
                {category !== ALL && <> in {groupCategoryLabel(category)}</>}.
              </>
            ) : (
              'No groups in this category yet.'
            )}
          </p>
          <button
            type="button"
            onClick={canWidenSearch ? searchAllCategories : clearFilters}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
          >
            {canWidenSearch ? (
              <>
                <Search size={16} aria-hidden="true" />
                Search all categories
              </>
            ) : (
              <>
                <X size={16} aria-hidden="true" />
                {terms.length > 0 ? 'Clear search' : 'Show all groups'}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {sections.map((section) => {
            // Unfiltered "All" is a browse view: a taste of each category, then "See all N".
            const shown = filtering
              ? section.groups
              : section.groups.slice(0, COMPACT_SECTION_LIMIT);
            const withUpcoming = shown.filter((g) => g.upcomingCount > 0);
            const withoutUpcoming = shown.filter((g) => g.upcomingCount === 0);

            return (
              <section key={section.value} aria-labelledby={`group-section-${section.value}`}>
                <h2
                  id={`group-section-${section.value}`}
                  className="flex items-baseline gap-2 text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100"
                >
                  {section.label}
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                    {section.groups.length}
                  </span>
                </h2>
                {withUpcoming.length > 0 && <GroupGrid groups={withUpcoming} />}
                {withUpcoming.length > 0 && withoutUpcoming.length > 0 && (
                  <p className="mt-6 mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    No upcoming events
                  </p>
                )}
                {withoutUpcoming.length > 0 && (
                  <GroupGrid groups={withoutUpcoming} flush={withUpcoming.length > 0} />
                )}
                {shown.length < section.groups.length && (
                  <button
                    type="button"
                    onClick={() => seeAll(section.value)}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:underline underline-offset-2 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    See all {section.groups.length}
                    <span className="sr-only"> {section.label} groups</span>
                    <span aria-hidden="true">&rarr;</span>
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** `flush` drops the top margin when the "No upcoming events" divider sits right above. */
function GroupGrid({ groups, flush = false }: { groups: GroupDirectoryEntry[]; flush?: boolean }) {
  return (
    <ul className={`${flush ? '' : 'mt-3 '}grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`}>
      {groups.map((group) => (
        <li key={group.slug}>
          <GroupCard group={group} />
        </li>
      ))}
    </ul>
  );
}

function GroupCard({ group }: { group: GroupDirectoryEntry }) {
  return (
    <Link
      href={`/groups/${group.slug}`}
      className="group flex flex-col h-full p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-md hover:shadow-brand-600/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 dark:focus-visible:ring-offset-gray-950"
    >
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
        {group.name}
      </h3>
      {group.description && (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
          {group.description}
        </p>
      )}
      <div className="mt-auto pt-3 space-y-1 text-xs">
        {group.upcomingCount > 0 && group.nextEventLabel ? (
          <p className="font-medium text-brand-600 dark:text-brand-400">
            Next: {group.nextEventLabel} · {group.upcomingCount} upcoming
          </p>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">
            {group.lastEventLabel ? `Last event ${group.lastEventLabel}` : 'No events listed'}
          </p>
        )}
        {group.homeBase && (
          <p className="flex items-start gap-1 text-gray-500 dark:text-gray-400">
            <MapPin size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="line-clamp-1">{group.homeBase}</span>
          </p>
        )}
      </div>
    </Link>
  );
}
