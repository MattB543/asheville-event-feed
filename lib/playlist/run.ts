import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, playlistPicks } from '@/lib/db/schema';
import { env } from '@/lib/config/env';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import { normalizeName, playlistDescription, type PlaylistEvent } from './match';
import { isMusicEvent } from './music';
import { matchEvents } from './matchEvents';
import { findSoldOut } from './soldOut';
import { replacePlaylist } from './spotify';
import { liveEvent } from '@/lib/db/liveEvent';

export const WINDOW_DAYS = 8; // Sunday through the next Sunday
const CANDIDATES = 25; // Wider than the playlist: skipped shows would otherwise eat slots
const PLAYLIST_SHOWS = 25;

export interface PlaylistShow {
  event: PlaylistEvent;
  trackId: string;
  trackName: string | null;
  spotifyArtist: string | null;
  soldOut: boolean;
}

export interface PlaylistRunResult {
  dryRun: boolean;
  weekStart: string;
  musicEvents: number;
  candidates: number;
  aiCalls: number;
  spotifySearches: number;
  classifierFailed: boolean;
  shows: PlaylistShow[];
  skipped: { title: string; note: string }[];
}

async function loadCandidates(now: Date): Promise<{ music: number; candidates: PlaylistEvent[] }> {
  const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
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
    .where(and(gte(events.startDate, now), lte(events.startDate, end), liveEvent))
    // Postgres sorts nulls first on DESC; unscored events belong last
    .orderBy(sql`${events.score} desc nulls last`, asc(events.startDate));
  const music = rows.filter(isMusicEvent);
  return { music: music.length, candidates: music.slice(0, CANDIDATES) };
}

/**
 * Builds this week's playlist: the top-scored music shows, each headliner's
 * Spotify track, then (unless dryRun) replaces the Spotify playlist and records
 * the picks. Matches are saved as they're found, so a run stopped by a Spotify
 * rate limit picks up where it left off.
 */
export async function runPlaylist({
  dryRun,
  lineupUrl = `${env.NEXT_PUBLIC_APP_URL}/playlist`,
}: {
  dryRun: boolean;
  /** Where the playlist description sends listeners for the full lineup */
  lineupUrl?: string;
}): Promise<PlaylistRunResult> {
  const weekStart = getTodayStringEastern();
  const { music, candidates } = await loadCandidates(new Date());

  const { matches, aiCalls, spotifySearches, classifierFailed } = await matchEvents(candidates);

  // Highest score first, one track per artist and per track, then by date: scores
  // cluster too tightly to be a useful listening order
  const seenArtists = new Set<string>();
  const seenTracks = new Set<string>();
  const kept: Omit<PlaylistShow, 'soldOut'>[] = [];
  const skipped: { title: string; note: string }[] = [];
  for (const event of candidates) {
    const match = matches.get(event.id)!;
    if (!match.trackId) {
      skipped.push({ title: event.title, note: match.note });
      continue;
    }
    const artistKey = match.spotifyArtist ? normalizeName(match.spotifyArtist) : '';
    if (seenTracks.has(match.trackId) || (artistKey && seenArtists.has(artistKey))) continue;
    seenTracks.add(match.trackId);
    if (artistKey) seenArtists.add(artistKey);
    kept.push({
      event,
      trackId: match.trackId,
      trackName: match.trackName,
      spotifyArtist: match.spotifyArtist,
    });
  }
  const chosen = kept.slice(0, PLAYLIST_SHOWS);
  chosen.sort((a, b) => a.event.startDate.getTime() - b.event.startDate.getTime());

  const soldOut = await findSoldOut(chosen.map((s) => s.event));
  const shows = chosen.map((s) => ({ ...s, soldOut: soldOut.has(s.event.id) }));

  if (!dryRun && shows.length > 0) {
    const description = playlistDescription(
      shows.map((s) => s.spotifyArtist ?? '?'),
      lineupUrl
    );
    await replacePlaylist(
      env.SPOTIFY_PLAYLIST_ID!,
      shows.map((s) => s.trackId),
      description
    );
    await db.transaction(async (tx) => {
      await tx.delete(playlistPicks).where(eq(playlistPicks.weekStart, weekStart));
      await tx.insert(playlistPicks).values(
        shows.map((s, position) => ({
          weekStart,
          position,
          eventId: s.event.id,
          spotifyTrackId: s.trackId,
          soldOut: s.soldOut,
        }))
      );
    });
  }

  return {
    dryRun,
    weekStart,
    musicEvents: music,
    candidates: candidates.length,
    aiCalls,
    spotifySearches,
    classifierFailed,
    shows,
    skipped,
  };
}
