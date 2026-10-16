import { NextResponse } from 'next/server';
import { env, isSpotifyEnabled } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { startCronJob, completeCronJob, failCronJob } from '@/lib/cron/jobTracker';
import { runPlaylist } from '@/lib/playlist/run';
import { isClassifierEnabled } from '@/lib/playlist/match';
import { SpotifyRateLimitError } from '@/lib/playlist/spotify';
import { sendPlaylistFailedNotification } from '@/lib/notifications/slack';

export const maxDuration = 300;

// Weekly Spotify playlist of the top music shows. ?dryRun=1 matches tracks
// (and saves the matches) without touching the playlist or the picks.
//
// Schedule: Sundays at 7 AM EDT / 6 AM EST (cron: "0 11 * * 0"); Vercel crons run in UTC
export async function GET(request: Request) {
  if (!verifyAuthToken(request.headers.get('authorization'), env.CRON_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!isSpotifyEnabled() || !isClassifierEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Playlist needs the SPOTIFY_* settings and ANTHROPIC_API_KEY or Azure AI',
      },
      { status: 400 }
    );
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  let runId: string | null = null;
  try {
    runId = await startCronJob('playlist');
  } catch (trackerErr) {
    console.error('[Playlist] Failed to start cron job tracker:', trackerErr);
  }

  try {
    const result = await runPlaylist({ dryRun });
    const stats = {
      dryRun,
      weekStart: result.weekStart,
      musicEvents: result.musicEvents,
      candidates: result.candidates,
      shows: result.shows.length,
      soldOut: result.shows.filter((s) => s.soldOut).length,
      spotifySearches: result.spotifySearches,
      classifierFailed: result.classifierFailed,
    };
    await completeCronJob(runId, stats);
    return NextResponse.json({ success: true, ...stats, skipped: result.skipped });
  } catch (error) {
    // A rate limit stops the run before the playlist changes; matches found so
    // far are saved, so the next run resumes from them
    const message = error instanceof SpotifyRateLimitError ? error.message : 'Playlist run failed';
    console.error('[Playlist]', error);
    await failCronJob(runId, error);
    if (!dryRun) await sendPlaylistFailedNotification(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
