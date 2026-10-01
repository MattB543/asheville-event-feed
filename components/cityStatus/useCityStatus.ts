'use client';

import { useQuery, type QueryFunctionContext } from '@tanstack/react-query';
import {
  PARKING_STALE_AFTER_MS,
  type CityStatus,
  type ParkingStatus,
  type WaterStatus,
} from '@/lib/cityStatus/types';

type CityStatusKey = readonly ['city-status', string];

/**
 * Dev-only: forward ?cityPreview=boil|outage from the page to the API. Read once
 * per page load, because /events rewrites its own URL (filter sync) and would
 * otherwise drop the param and the preview with it.
 */
let previewFromLoad: string | undefined;
function previewParam(): string {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return '';
  previewFromLoad ??= new URLSearchParams(window.location.search).get('cityPreview') ?? '';
  return previewFromLoad;
}

async function fetchCityStatus({
  client,
  queryKey,
  signal,
}: QueryFunctionContext<CityStatusKey>): Promise<CityStatus> {
  const preview = queryKey[1];
  const res = await fetch(
    `/api/city-status${preview ? `?preview=${encodeURIComponent(preview)}` : ''}`,
    { signal }
  );
  if (!res.ok) throw new Error(`city-status ${res.status}`);
  const next = (await res.json()) as CityStatus;

  // Feed trouble is not an all-clear: keep the last advisories we knew about
  const previous = client.getQueryData<CityStatus>(queryKey);
  if (next.water?.status !== 'ok' && previous?.water.status === 'ok') {
    return { ...next, water: previous.water };
  }
  return next;
}

/**
 * Live city status for the header badges, polled every minute while the tab is
 * visible. Both header layouts call this; TanStack Query shares the one request.
 *
 * Parking shows while the latest poll succeeded and the city's own timestamp is
 * under 10 minutes old (checked again on every render, so counts left over from
 * a long-hidden tab disappear rather than read as live). Water survives failed
 * polls.
 */
export function useCityStatus(): { parking: ParkingStatus | null; water: WaterStatus | null } {
  const { data, isError } = useQuery({
    queryKey: ['city-status', previewParam()] as const,
    queryFn: fetchCityStatus,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    // Coming back to the tab: refresh right away if the last poll is a minute old
    refetchOnWindowFocus: true,
    retry: 1,
    // Inline, so it re-runs on each render and the age check uses the current time
    select: (status) => ({
      parking:
        status.parking && Date.now() - Date.parse(status.parking.asOf) <= PARKING_STALE_AFTER_MS
          ? status.parking
          : null,
      water: status.water.status === 'ok' ? status.water.active : null,
    }),
  });

  return { parking: isError ? null : (data?.parking ?? null), water: data?.water ?? null };
}
