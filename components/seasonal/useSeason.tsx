'use client';

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import {
  DEFAULT_SEASONS,
  currentSeason,
  seasonBanner,
  type Season,
  type SeasonKey,
} from '@/lib/seasons';
import { getTodayStringEastern } from '@/lib/utils/timezone';

// The Eastern date the page was rendered on and the seasons as admins set them, both
// taken once by the root layout
const Seasons = createContext<{ today: string; seasons: readonly Season[] } | null>(null);

export function SeasonProvider({
  today,
  seasons,
  children,
}: {
  today: string;
  seasons: readonly Season[];
  children: ReactNode;
}) {
  return <Seasons.Provider value={{ today, seasons }}>{children}</Seasons.Provider>;
}

// A closed season's page being previewed: its header shows that season's badge and look
const Previewed = createContext<SeasonKey | null>(null);

export function SeasonPreview({
  seasonKey,
  children,
}: {
  seasonKey: SeasonKey | null;
  children: ReactNode;
}) {
  return <Previewed.Provider value={seasonKey}>{children}</Previewed.Provider>;
}

/** Whether this page is a preview of a closed season */
export const usePreviewing = () => useContext(Previewed) !== null;

const subscribe = () => () => {};

/**
 * The running season and its banner text, both from one date. While hydrating that is
 * the date the page was rendered on, so the HTML matches however long it was cached and
 * whether a server or client component drew the header; after that it is the browser's
 * own date, so a page cached before Nov 1 still drops its links once the season is over.
 */
export function useSeason(): { season: Season; banner: string } | null {
  const rendered = useContext(Seasons);
  const previewed = useContext(Previewed);
  const today = useSyncExternalStore(
    subscribe,
    getTodayStringEastern,
    () => rendered?.today ?? getTodayStringEastern()
  );
  const seasons = rendered?.seasons ?? DEFAULT_SEASONS;
  const season = previewed
    ? seasons.find((s) => s.key === previewed)!
    : currentSeason(seasons, today);
  return season ? { season, banner: seasonBanner(season, today) } : null;
}
