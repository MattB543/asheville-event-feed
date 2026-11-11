import { env } from '@/lib/config/env';
import { fetchWithRetry, HttpResponseError, isTransientStatus, withRetry } from '@/lib/utils/retry';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { sendSpotifyLoginNotification } from '@/lib/notifications/slack';

const API = 'https://api.spotify.com/v1';

export interface SpotifyArtist {
  name: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
}

// A 429 must stop the run before the playlist changes, and must never be saved
// as "no match", so it gets its own error type.
export class SpotifyRateLimitError extends Error {
  constructor(public retryAfterSeconds: number | null) {
    super(`Spotify rate limit (retry after ${retryAfterSeconds ?? '?'}s)`);
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

// After a 429, every call waits out Spotify's Retry-After instead of piling on
let blockedUntil = 0;
// Event pages can each trigger a search, so cap them beyond each visitor's own limit;
// the count is per server instance, so the real ceiling scales with instances
const SEARCHES_PER_HOUR = 300;

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString(
    'base64'
  );
  // A dropped connection or a server error is tried again; a refusal (4xx) comes straight
  // back, since its body says why
  const response = await withRetry(async () => {
    const attempt = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.SPOTIFY_REFRESH_TOKEN ?? '',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (isTransientStatus(attempt.status)) {
      throw new HttpResponseError(attempt.status, attempt.statusText, TOKEN_URL, attempt.headers);
    }
    return attempt;
  });
  if (!response.ok) {
    // Spotify's reason is in the body; a 400 means the saved login itself was refused
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const reason = `${response.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim();
    if (response.status === 400) await reportLoginRefused(reason);
    throw new Error(`Spotify token exchange failed: ${reason}`);
  }
  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  if (data.refresh_token && data.refresh_token !== env.SPOTIFY_REFRESH_TOKEN) {
    // The stored token keeps working today, but if Spotify ever retires it this
    // is the value SPOTIFY_REFRESH_TOKEN needs to become.
    console.warn('[Spotify] Issued a new refresh token; update SPOTIFY_REFRESH_TOKEN');
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

// Sign-ins last 6 months, so this fires twice a year at least; one Slack post a day is enough.
// Each attempt is a failed `spotify-login` run (cron:health shows it); only one Slack
// accepted counts as said, and a failed post is tried again at most every 15 minutes
async function reportLoginRefused(reason: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Requests failing at the same moment would otherwise each post
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('spotify-login'))`);
      const [recent] = await tx.execute<{ id: string }>(sql`
        SELECT id FROM cron_job_runs
        WHERE job_name = 'spotify-login'
          AND (started_at > now() - interval '15 minutes'
            OR (started_at > now() - interval '1 day' AND (result->>'notified')::boolean))
        LIMIT 1`);
      if (recent) return;
      const notified = await sendSpotifyLoginNotification(reason);
      await tx.execute(sql`
        INSERT INTO cron_job_runs (job_name, status, completed_at, result)
        VALUES ('spotify-login', 'failed', now(), ${JSON.stringify({ error: reason, notified })}::jsonb)`);
    });
  } catch (error) {
    console.error('[Spotify] Could not report the refused login:', error);
  }
}

async function spotifyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (Date.now() < blockedUntil) {
    throw new SpotifyRateLimitError(Math.ceil((blockedUntil - Date.now()) / 1000));
  }
  const headers = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
    ...init.headers,
  };
  try {
    return await fetchWithRetry(
      `${API}${path}`,
      { ...init, headers },
      // A 429 waits out Retry-After below rather than retrying straight away
      { shouldRetry: (error) => !(error instanceof HttpResponseError && error.status === 429) }
    );
  } catch (error) {
    if (error instanceof HttpResponseError && error.status === 429) {
      const retryAfter = Number(error.headers?.get('retry-after'));
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
      blockedUntil = Date.now() + seconds * 1000;
      throw new SpotifyRateLimitError(seconds);
    }
    throw error;
  }
}

export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
  if (isRateLimited('spotify-search', SEARCHES_PER_HOUR, 60 * 60 * 1000)) {
    throw new SpotifyRateLimitError(null);
  }
  const params = new URLSearchParams({ q: query, type: 'track', limit: '10' });
  const response = await spotifyFetch(`/search?${params}`);
  const data = (await response.json()) as { tracks?: { items?: SpotifyTrack[] } };
  return data.tracks?.items ?? [];
}

export async function getTrack(trackId: string): Promise<SpotifyTrack | null> {
  try {
    const response = await spotifyFetch(`/tracks/${trackId}`);
    return (await response.json()) as SpotifyTrack;
  } catch (error) {
    if (error instanceof SpotifyRateLimitError) throw error;
    return null;
  }
}

export async function replacePlaylist(
  playlistId: string,
  trackIds: string[],
  description: string
): Promise<void> {
  // Spotify caps a replace at 100 tracks; the playlist is 25
  // /items, not the older /tracks path, which Spotify now answers with 403
  await spotifyFetch(`/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify({ uris: trackIds.slice(0, 100).map((id) => `spotify:track:${id}`) }),
  });
  // The songs are already replaced, so a failed description update mustn't fail the
  // run: the picks would then go unsaved and /playlist would show last week's
  try {
    await spotifyFetch(`/playlists/${playlistId}`, {
      method: 'PUT',
      body: JSON.stringify({ description }),
    });
  } catch (error) {
    console.warn('[Spotify] Playlist description not updated:', error);
  }
}
