import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { liveEvent } from '@/lib/db/liveEvent';
import { isSpotifyEnabled } from '@/lib/config/env';
import { clientIp, isRateLimited } from '@/lib/utils/rate-limit';
import { isClassifierEnabled } from '@/lib/playlist/match';
import { isMusicEvent } from '@/lib/playlist/music';
import { matchEvents } from '@/lib/playlist/matchEvents';
import { SpotifyRateLimitError } from '@/lib/playlist/spotify';

// Matching can cost an AI call and a Spotify search; saved matches cost neither
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/events/[id]/track -> { track: { id, name, artist } | null }
// The headliner's Spotify track for a music event, matched on first request and saved
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const none = NextResponse.json({ track: null });
  if (!UUID_RE.test(id) || !isSpotifyEnabled() || !isClassifierEnabled()) return none;
  if (isRateLimited(`track:${clientIp(request)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
    return NextResponse.json({ track: null }, { status: 429 });
  }

  const [event] = await db
    .select({
      id: events.id,
      title: events.title,
      source: events.source,
      tags: events.tags,
      description: events.description,
      aiSummary: events.aiSummary,
      url: events.url,
      location: events.location,
      organizer: events.organizer,
      startDate: events.startDate,
      score: events.score,
    })
    .from(events)
    .where(and(eq(events.id, id), liveEvent))
    .limit(1);
  if (!event || !isMusicEvent(event)) return none;

  try {
    const { matches } = await matchEvents([event]);
    const match = matches.get(event.id);
    if (!match?.trackId) return none;
    return NextResponse.json(
      { track: { id: match.trackId, name: match.trackName, artist: match.spotifyArtist } },
      // A saved match doesn't change, so let the CDN answer repeat visits
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } }
    );
  } catch (error) {
    if (!(error instanceof SpotifyRateLimitError)) console.error('[Track] Match failed:', error);
    return NextResponse.json({ track: null }, { status: 503 });
  }
}
