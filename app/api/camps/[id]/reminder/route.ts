import { NextResponse } from 'next/server';
import { AUDIENCES, type Audience } from '@/lib/camps/contract';
import { reminderMilestones } from '@/lib/camps/display';
import { getCampById } from '@/lib/db/queries/camps';
import { calendarFile, googleCalendarUrl, milestoneEvents } from '../../ics';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=900',
  'X-Robots-Tag': 'noindex',
};

/**
 * GET /api/camps/[id]/reminder[?audience=member]: a .ics file with the camp's 2027 registration
 * dates still ahead for one audience (01 §4.4, N10), for "Add reminder": the public dates unless
 * `audience` names another (member, returning, lottery ...), and only dates announced to the day
 * (isRemindable). 404 when the camp has none.
 *
 * With `calendar=google&kind=opens&date=2027-01-10[&time=09:00]`, a redirect to Google Calendar's
 * new-event page for that one date instead (a link holds one event): the audience's date of that
 * kind, day and time exactly, or 404 when the camp's dates have changed since the menu was drawn
 * (never another date in its place). Without kind, date and time, its first date.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const audience = search.get('audience') ?? 'public';
  if (!(AUDIENCES as readonly string[]).includes(audience)) {
    return NextResponse.json({ error: 'Unknown audience' }, { status: 404 });
  }
  try {
    const camp = await getCampById(id);
    if (!camp) return NextResponse.json({ error: 'Camp not found' }, { status: 404 });

    const now = new Date();
    const milestones = reminderMilestones(camp.card, now, audience as Audience);
    const events = milestoneEvents(camp, milestones, now);
    if (events.length === 0) {
      return NextResponse.json({ error: 'Registration date not posted yet' }, { status: 404 });
    }

    if (search.get('calendar') === 'google') {
      const selected = ['kind', 'date', 'time'].some((key) => search.has(key));
      const milestone = selected
        ? milestones.find(
            (candidate) =>
              candidate.kind === search.get('kind') &&
              candidate.date === search.get('date') &&
              (candidate.time ?? '') === (search.get('time') ?? '')
          )
        : milestones[0];
      if (!milestone) {
        return NextResponse.json(
          { error: 'That registration date has changed: reload the camp page' },
          { status: 404 }
        );
      }
      return NextResponse.redirect(googleCalendarUrl(camp, milestone), {
        status: 302,
        headers: HEADERS,
      });
    }

    const who = audience === 'public' ? '' : `${audience.replace('_', '-')}-`;
    return new NextResponse(calendarFile(`${camp.card.name} registration`, events), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${camp.slug}-${who}registration.ics"`,
        ...HEADERS,
      },
    });
  } catch (error) {
    console.error('[Camps] Reminder failed:', error);
    return NextResponse.json({ error: 'Could not build the reminder' }, { status: 500 });
  }
}
