/** Admin search for events to add to a holiday page's wall (`?season=` and `?q=`) */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/utils/admin';
import { HOLIDAYS, holidayWallRange } from '@/lib/holidays/config';
import { searchEventsBetween } from '@/lib/holidays/events';
import { getSeasons } from '@/lib/db/queries/seasonSettings';
import { venueLine } from '@/lib/utils/venueName';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isAdmin(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const query = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100);
  const season = request.nextUrl.searchParams.get('season');
  const holiday = HOLIDAYS.find((h) => h.key === season);
  if (!holiday) return NextResponse.json({ error: 'Unknown season' }, { status: 400 });
  // Only the wall's days, from today on
  const { start, end } = holidayWallRange(holiday.key, await getSeasons());
  try {
    const rows = await searchEventsBetween(query, start, end);
    return NextResponse.json({
      results: rows.map((row) => ({
        id: row.id,
        title: row.title,
        startDate: row.startDate.toISOString(),
        venue: venueLine(row),
      })),
    });
  } catch (error) {
    console.error('[SeasonPicks] Search failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
