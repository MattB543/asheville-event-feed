/**
 * What the /camps page (server) and its directory (browser) share. The page renders the first page
 * of the default order and the directory fetches every camp once it's up: inlined in the HTML, the
 * whole list made the page 2MB with its cards at the very end, and Googlebot reads only the first
 * 2MB. Client-safe: no database, no server-only imports.
 */
import type { CampCardData } from './display';

export type CampSort = 'registration' | 'popular' | 'drive' | 'price' | 'name';
export const DEFAULT_CAMP_SORT: CampSort = 'registration';

/** Cards shown at first and per "Show more": all of them is ~1,000 cards and a slow page. */
export const CAMPS_PAGE_SIZE = 30;

/** Every listed camp's card, for the directory (app/api/camps/cards). */
export const CAMP_CARDS_PATH = '/api/camps/cards';

const TONE_RANK: Record<string, number> = {
  upcoming: 0,
  open: 1,
  tentative: 2,
  unknown: 3,
  closed: 4,
};

/**
 * Each camp's place in name order, worked out once: localeCompare is slow inside every sort. In
 * English whatever the browser's language, or the server's first page and the browser's would
 * differ ("Chess Camp" sorts after "Dance Camp" in Czech).
 */
export function nameRanks(camps: CampCardData[]): Map<string, number> {
  const sorted = [...camps].sort((a, b) =>
    `${a.name} ${a.providerName}`.localeCompare(`${b.name} ${b.providerName}`, 'en')
  );
  return new Map(sorted.map((camp, index) => [camp.id, index]));
}

/**
 * The order for a sort. A bare listing (CampCardData.bare: nothing but a name and a link) goes last
 * in the default order, and after the rest of a tie in the others, which it'd otherwise contradict
 * (by name, never). `nameMatches` (with a search) is how many search words a camp's or provider's
 * name has: the default order puts more first, before the bare rule, so "art" lists the art camps
 * before camps that only mention art.
 */
export function compareCamps(
  sort: CampSort,
  ranks: Map<string, number>,
  nameMatches: Map<string, number> | null
) {
  const byName = (a: CampCardData, b: CampCardData) => ranks.get(a.id)! - ranks.get(b.id)!;
  const nullsLast = (a: number | string | null, b: number | string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  const bareLast = (a: CampCardData, b: CampCardData) => Number(!!a.bare) - Number(!!b.bare);
  const byNameMatch = (a: CampCardData, b: CampCardData) =>
    nameMatches ? nameMatches.get(b.id)! - nameMatches.get(a.id)! : 0;

  return (a: CampCardData, b: CampCardData) => {
    if (sort === 'popular') return b.views - a.views || bareLast(a, b) || byName(a, b);
    if (sort === 'drive') {
      return nullsLast(a.driveMinutes, b.driveMinutes) || bareLast(a, b) || byName(a, b);
    }
    if (sort === 'price') {
      return nullsLast(a.priceSort, b.priceSort) || bareLast(a, b) || byName(a, b);
    }
    if (sort === 'registration') {
      // Openings still ahead first (soonest first), then open now, expected, unannounced, closed
      return (
        byNameMatch(a, b) ||
        bareLast(a, b) ||
        TONE_RANK[a.registration.tone] - TONE_RANK[b.registration.tone] ||
        nullsLast(a.registration.sortDate, b.registration.sortDate) ||
        byName(a, b)
      );
    }
    return byName(a, b);
  };
}

/** The cards the plain directory (no filters, the default sort) shows first. */
export function firstCampPage(camps: CampCardData[]): CampCardData[] {
  return [...camps]
    .sort(compareCamps(DEFAULT_CAMP_SORT, nameRanks(camps), null))
    .slice(0, CAMPS_PAGE_SIZE);
}

/** The choices in the Town, Type and Category filters. */
export interface CampFacets {
  towns: string[];
  types: string[];
  categories: string[];
}

export function campFacets(camps: CampCardData[]): CampFacets {
  return {
    towns: [
      ...new Set(
        camps.flatMap((camp) =>
          camp.sites.map((site) => site.town).filter((name): name is string => !!name)
        )
      ),
    ].sort((a, b) => a.localeCompare(b, 'en')),
    types: [...new Set(camps.map((camp) => camp.type))].sort(),
    categories: [...new Set(camps.flatMap((camp) => camp.categories))].sort(),
  };
}
