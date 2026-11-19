import { NextResponse } from 'next/server';
import { toCardData } from '@/lib/camps/display';
import { listLiveCamps } from '@/lib/db/queries/camps';

export const dynamic = 'force-dynamic';

/**
 * GET /api/camps/cards - every listed camp as the /camps directory's cards (CampCardData), which
 * the directory fetches once the page is up (lib/camps/directory.ts says why). Not a documented
 * API: the exports are. Never cached, like the page: a card says "opens" or "opened" by the clock,
 * and a copy from a minute before an opening would put "opens" back over the page's "opened".
 */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const now = new Date();
    const camps = (await listLiveCamps()).map((camp) => toCardData(camp, now));
    return NextResponse.json({ camps }, { headers });
  } catch (error) {
    console.error('[Camps cards] Error:', error);
    return NextResponse.json({ error: 'Failed to load the camps' }, { status: 500, headers });
  }
}
