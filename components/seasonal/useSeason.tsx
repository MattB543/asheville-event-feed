'use client';

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { currentSeason, seasonBanner, type Season } from '@/lib/seasons';
import { getTodayStringEastern } from '@/lib/utils/timezone';

// The Eastern date the page was rendered on, taken once by the root layout
const RenderDate = createContext<string | null>(null);

export function RenderDateProvider({ today, children }: { today: string; children: ReactNode }) {
  return <RenderDate.Provider value={today}>{children}</RenderDate.Provider>;
}

const subscribe = () => () => {};

/**
 * The running season and its banner text, both from one date. While hydrating that is
 * the date the page was rendered on, so the HTML matches however long it was cached and
 * whether a server or client component drew the header; after that it is the browser's
 * own date, so a page cached before Nov 1 still drops its links once the season is over.
 */
export function useSeason(): { season: Season; banner: string } | null {
  const rendered = useContext(RenderDate);
  const today = useSyncExternalStore(
    subscribe,
    getTodayStringEastern,
    () => rendered ?? getTodayStringEastern()
  );
  const season = currentSeason(today);
  return season ? { season, banner: seasonBanner(season, today) } : null;
}
