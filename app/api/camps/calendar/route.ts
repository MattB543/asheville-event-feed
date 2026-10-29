import { NextResponse } from 'next/server';
import { MAX_CALENDAR_CAMPS, saveCampCalendar } from '@/lib/db/queries/camps';
import { clientIp, isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord, isString, isStringArray } from '@/lib/utils/validation';

const RATE_LIMIT_MAX = 60; // saves an hour per IP: one per star tap once subscribed
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

/**
 * POST /api/camps/calendar { token?, campIds }: create or update a browser's saved-camps calendar
 * (01 §4.4). With a token it already has, the row is rewritten so the subscribed URL never changes;
 * otherwise a new token is issued. Returns { token }.
 */
export async function POST(request: Request) {
  if (isRateLimited(`camp-calendar:${clientIp(request)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (
    !isRecord(parsed) ||
    !isStringArray(parsed.campIds) ||
    parsed.campIds.length > MAX_CALENDAR_CAMPS
  ) {
    return NextResponse.json(
      { error: `campIds must be a list of at most ${MAX_CALENDAR_CAMPS} camp ids` },
      { status: 400 }
    );
  }

  try {
    const token = await saveCampCalendar(
      isString(parsed.token) ? parsed.token : null,
      parsed.campIds
    );
    return NextResponse.json({ token });
  } catch (error) {
    console.error('[Camps] Calendar save failed:', error);
    return NextResponse.json({ error: 'Could not save the calendar' }, { status: 500 });
  }
}
