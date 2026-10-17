import { NextResponse } from 'next/server';
import { isRecord, isStringArray } from '@/lib/utils/validation';
import { cleanEventIds, getEventsByIds } from '@/lib/db/queries/sharedList';

export async function POST(request: Request) {
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const ids = (isStringArray(parsed.ids) ? parsed.ids : [])
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (ids.length === 0) {
      return NextResponse.json({ events: [] });
    }

    const limitedIds = cleanEventIds(ids);
    if (limitedIds.length === 0) {
      return NextResponse.json({ error: 'No valid event ids' }, { status: 400 });
    }

    const results = await getEventsByIds(limitedIds);

    return NextResponse.json({ events: results });
  } catch (error) {
    console.error('[Favorites API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch favorites' }, { status: 500 });
  }
}
