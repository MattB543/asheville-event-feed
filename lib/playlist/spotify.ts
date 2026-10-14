import { env } from '@/lib/config/env';

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

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString(
    'base64'
  );
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.SPOTIFY_REFRESH_TOKEN ?? '',
    }),
  });
  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status} ${await response.text()}`);
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

async function spotifyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new SpotifyRateLimitError(Number.isFinite(retryAfter) ? retryAfter : null);
      }
      if (!response.ok) {
        throw new Error(`Spotify ${init.method ?? 'GET'} ${path}: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (error instanceof SpotifyRateLimitError) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
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
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: 'PUT',
    body: JSON.stringify({ uris: trackIds.slice(0, 100).map((id) => `spotify:track:${id}`) }),
  });
  await spotifyFetch(`/playlists/${playlistId}`, {
    method: 'PUT',
    body: JSON.stringify({ description }),
  });
}
