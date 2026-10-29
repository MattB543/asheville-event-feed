import { NextResponse } from 'next/server';
import { reminderMilestones } from '@/lib/camps/display';
import { getCampById } from '@/lib/db/queries/camps';
import { calendarFile, milestoneEvents } from '../../ics';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/camps/[id]/reminder: a .ics file with the camp's 2027 registration dates still ahead
 * (01 §4.4), for "Add reminder": only dates announced to the day (isRemindable). 404 when the camp
 * has none.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const camp = await getCampById(id);
    if (!camp) return NextResponse.json({ error: 'Camp not found' }, { status: 404 });

    const now = new Date();
    const events = milestoneEvents(camp, reminderMilestones(camp.card, now), now);
    if (events.length === 0) {
      return NextResponse.json({ error: 'Registration date not posted yet' }, { status: 404 });
    }

    return new NextResponse(calendarFile(`${camp.card.name} registration`, events), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${camp.slug}-registration.ics"`,
        'Cache-Control': 'public, max-age=300, s-maxage=900',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    console.error('[Camps] Reminder failed:', error);
    return NextResponse.json({ error: 'Could not build the reminder' }, { status: 500 });
  }
}
