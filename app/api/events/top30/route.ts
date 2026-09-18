import { NextResponse, type NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import {
  queryTop30CategoryEvents,
  TOP30_MAX_CANDIDATES,
  type Top30Category,
} from '@/lib/db/queries/events';

const CATEGORIES = new Set<string>(['overall', 'weird', 'social']);

// The same unfiltered pool for every visitor, so it caches like the page's SSR
// data and is invalidated by the same 'events' tag after each cron run
const getCachedCategoryPool = unstable_cache(
  async (category: Top30Category) => queryTop30CategoryEvents(category, TOP30_MAX_CANDIDATES),
  ['events-top30-backfill'],
  { tags: ['events'], revalidate: 3600 }
);

/**
 * GET /api/events/top30?category=overall|weird|social
 *
 * The deep candidate pool for one Top 30 category: the top TOP30_MAX_CANDIDATES
 * scored events in the next 30 days, best first and unfiltered. The Top 30 tab
 * fetches it when the user's filters leave fewer than 30 of the SSR candidates
 * standing, then filters and ranks client-side so ranks never renumber.
 */
export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category');
  if (!category || !CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: 'category must be one of: overall, weird, social' },
      { status: 400 }
    );
  }

  try {
    const events = await getCachedCategoryPool(category as Top30Category);
    return NextResponse.json({ events }, { headers: { 'Cache-Control': 'public, s-maxage=3600' } });
  } catch (error) {
    console.error('[API] /api/events/top30 failed:', error);
    return NextResponse.json({ error: 'Failed to load Top 30 events' }, { status: 500 });
  }
}
