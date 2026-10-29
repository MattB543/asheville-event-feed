import { NextResponse } from 'next/server';
import { recordCampView } from '@/lib/db/queries/camps';
import { clientIp, isRateLimited } from '@/lib/utils/rate-limit';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HOUR = 60 * 60 * 1000;
// The browser already sends once per camp per day; these only blunt a script. Like favorites, the
// count stays forgeable (01 §4.5).
const IP_LIMIT = 120; // views an hour from one IP, across camps
const CAMP_LIMIT = 3; // views of one camp a day from one IP (a household shares an IP)

/**
 * POST /api/camps/[id]/view: the popularity beacon. Anonymous. 204 once counted (an unknown or
 * hidden camp is quietly ignored).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid camp id' }, { status: 400 });
  }

  const ip = clientIp(request);
  if (
    isRateLimited(`camp-view:${ip}`, IP_LIMIT, HOUR) ||
    isRateLimited(`camp-view:${ip}:${id}`, CAMP_LIMIT, 24 * HOUR)
  ) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    await recordCampView(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[Camps] View beacon failed:', error);
    return NextResponse.json({ error: 'Could not record the view' }, { status: 500 });
  }
}
