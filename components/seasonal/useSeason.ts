'use client';

import { useSyncExternalStore } from 'react';
import { currentSeason, SEASONS, type Season, type SeasonKey } from '@/lib/seasons';

const subscribe = () => () => {};

/**
 * The server's answer while hydrating, then the browser's own date: a page cached
 * on the season's last day still drops its links once the season is over.
 */
export function useSeason(serverKey: SeasonKey | null): Season | null {
  const key = useSyncExternalStore(
    subscribe,
    () => currentSeason()?.key ?? null,
    () => serverKey
  );
  return SEASONS.find((s) => s.key === key) ?? null;
}
