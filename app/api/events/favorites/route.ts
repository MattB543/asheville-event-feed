import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { isRecord, isStringArray } from '@/lib/utils/validation';
import { publicEventColumns } from '@/lib/db/queries/publicEventColumns';

const MAX_IDS = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // Drop malformed ids (a share link cut off mid-id) instead of letting one
    // fail the whole uuid query
    const uniqueIds = Array.from(new Set(ids.filter((id) => UUID_REGEX.test(id))));
    if (uniqueIds.length === 0) {
      return NextResponse.json({ error: 'No valid event ids' }, { status: 400 });
    }

    const limitedIds = uniqueIds.slice(0, MAX_IDS);

    const results = await db
      .select(publicEventColumns)
      .from(events)
      .where(
        and(
          inArray(events.id, limitedIds),
          or(isNull(events.hidden), eq(events.hidden, false)),
          isNull(events.dedupedAt),
          isNull(events.deadAt)
        )
      )
      .orderBy(asc(events.startDate));

    return NextResponse.json({ events: results });
  } catch (error) {
    console.error('[Favorites API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch favorites' }, { status: 500 });
  }
}
