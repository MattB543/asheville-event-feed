import { NextResponse, type NextRequest } from 'next/server';
import { fetchParkingStatus } from '@/lib/cityStatus/parking';
import { fetchWaterFeed, getActiveWaterStatus } from '@/lib/cityStatus/water';
import { getWaterPreview, isWaterPreview } from '@/lib/cityStatus/preview';
import type { CityStatus, WaterState } from '@/lib/cityStatus/types';

/**
 * GET /api/city-status
 *
 * Live civic status for the header badges: downtown garage availability and any
 * active water outage / boil-water advisory. Public and anonymous.
 *
 * Caching: each feed is cached server-side as a validated envelope (parking 60s,
 * water 5 min) with a hard age ceiling (parking: Last-Modified within 10 min;
 * water: fetched within 20 min). The "active" rule runs per request. A healthy
 * response is CDN-cached for 60s; a degraded one for only 10s.
 *
 * Failures never become an error response or an all-clear: parking goes null
 * (the badges hide) and water becomes `unavailable` (the client keeps showing
 * the last advisories it knew about).
 */
export async function GET(request: NextRequest) {
  // Dev-only preview of the water badge/modal while nothing is active
  const preview = request.nextUrl.searchParams.get('preview');
  const usePreview = process.env.NODE_ENV === 'development' && isWaterPreview(preview);

  const now = Date.now();
  const [parking, feed] = await Promise.all([fetchParkingStatus(now), fetchWaterFeed(now)]);

  let water: WaterState = { status: 'unavailable' };
  if (usePreview) {
    water = { status: 'ok', active: getWaterPreview(preview, now) };
  } else if (feed) {
    try {
      water = { status: 'ok', active: getActiveWaterStatus(feed.alerts, now) };
    } catch (error) {
      console.warn('[city-status] water rule failed:', error);
    }
  }

  const healthy = parking !== null && water.status === 'ok';
  const body: CityStatus = { parking, water };
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': usePreview
        ? 'no-store'
        : healthy
          ? 'public, s-maxage=60, stale-while-revalidate=60'
          : 'public, s-maxage=10',
    },
  });
}
