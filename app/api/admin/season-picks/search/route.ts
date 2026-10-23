/** Super-admin search for events to add to a holiday page's weekend wall */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { searchEventsBetween } from '@/lib/db/queries/halloween';
import { addDaysToDateString } from '@/lib/utils/dateFilters';
import { getDayBoundariesEastern, getTodayStringEastern } from '@/lib/utils/timezone';
import { venueLine } from '@/lib/utils/venueName';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isSuperAdmin(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const query = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100);
  // The wall's two nights: Oct 30 and 31 of this year, Eastern
  const halloween = `${getTodayStringEastern().slice(0, 4)}-10-31`;
  try {
    const rows = await searchEventsBetween(
      query,
      getDayBoundariesEastern(addDaysToDateString(halloween, -1)).start,
      getDayBoundariesEastern(halloween).end
    );
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
