import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { isRecord, isStringArray } from '@/lib/utils/validation';

const MAX_IDS = 200;

export async function POST(request: Request) {
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const ids = isStringArray(parsed.ids) ? parsed.ids : [];
    const uniqueIds = Array.from(new Set(ids)).filter((id) => id.trim().length > 0);

    if (uniqueIds.length === 0) {
      return NextResponse.json({ events: [] });
    }

    const limitedIds = uniqueIds.slice(0, MAX_IDS);

    const results = await db
      .select()
      .from(events)
      .where(
        and(inArray(events.id, limitedIds), or(isNull(events.hidden), eq(events.hidden, false)))
      )
      .orderBy(asc(events.startDate));

    return NextResponse.json({ events: results });
  } catch (error) {
    console.error('[Favorites API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch favorites' }, { status: 500 });
  }
}
