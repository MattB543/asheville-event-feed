import { NextResponse } from 'next/server';
import { TARGET_SEASON } from '@/lib/camps/display';
import { campsForCalendar } from '@/lib/db/queries/camps';
import { calendarFile, milestoneEvents, seasonStartEvent } from '../../ics';

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/camps/calendar/<token>.ics: the saved-camps feed calendar apps subscribe to (01 §4.4).
 * Built from current data on every request, so a date a camp posts later reaches the parent's
 * calendar on the app's next poll. Every 2027 registration date of each saved camp (past ones
 * too, so they don't vanish), plus each camp's first day once posted.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  try {
    const camps = await campsForCalendar(token.replace(/\.ics$/, ''));
    if (!camps) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

    const now = new Date();
    const events = camps.flatMap((camp) => {
      const dates = camp.card.registration.filter((milestone) => milestone.year === TARGET_SEASON);
      const start = seasonStartEvent(camp, now);
      return [...milestoneEvents(camp, dates, now), ...(start ? [start] : [])];
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
