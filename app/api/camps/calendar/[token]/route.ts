import { NextResponse } from 'next/server';
import { campsForCalendar, isCalendarToken } from '@/lib/db/queries/camps';
import { clientIp, isRateLimited } from '@/lib/utils/rate-limit';
import { calendarFile, milestoneEvents, seasonStartEvent } from '../../ics';

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * Fetches an hour per IP. Calendar apps poll every few hours, but Google's fetchers poll many
 * people's feeds from one address, so this is loose: it stops a script, not a calendar.
 */
const RATE_LIMIT_MAX = 240;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

/**
 * GET /api/camps/calendar/<token>.ics: the saved-camps feed calendar apps subscribe to (01 §4.4).
 * Built from current data on every request, so a date a camp posts later reaches the parent's
 * calendar on the app's next poll. Every remindable public 2027 registration date of each saved
 * camp (past ones too, so they don't vanish; members', returning families' and lottery dates are
 * the camp page's own reminders, N10), plus each camp's first day once posted. A malformed token
 * and an over-limit IP are turned away before the database is touched.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const token = (await params).token.replace(/\.ics$/, '');
  if (!isCalendarToken(token)) {
    return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
  }
  if (isRateLimited(`camp-calendar-feed:${clientIp(request)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const camps = await campsForCalendar(token);
    if (!camps) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

    const now = new Date();
    const events = camps.flatMap((camp) => {
      const start = seasonStartEvent(camp, now);
      const publicDates = camp.card.registration.filter(
        (milestone) => milestone.audience === 'public'
      );
      return [...milestoneEvents(camp, publicDates, now), ...(start ? [start] : [])];
    });

    return new NextResponse(calendarFile('Summer camps (AVL GO)', events, 'PT6H'), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="avlgo-camps.ics"',
        'Cache-Control': 'public, max-age=900, s-maxage=900',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    console.error('[Camps] Calendar feed failed:', error);
    return NextResponse.json({ error: 'Could not build the calendar' }, { status: 500 });
  }
}
