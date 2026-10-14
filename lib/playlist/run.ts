import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, eventTracks, playlistPicks } from '@/lib/db/schema';
import { env } from '@/lib/config/env';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import {
  classifyTitles,
  findTrack,
  isMusicEvent,
  normalizeName,
  playlistDescription,
  type Classification,
  type PlaylistEvent,
  type TrackMatch,
} from './match';
import { findSoldOut } from './soldOut';
import { replacePlaylist } from './spotify';

const WINDOW_DAYS = 8; // Sunday through the next Sunday
const CANDIDATES = 25; // Wider than the playlist: skipped shows would otherwise eat slots
const PLAYLIST_SHOWS = 25;

type TrackRow = typeof eventTracks.$inferSelect;

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

function toClassification(row: Pick<TrackRow, 'artist' | 'skipReason' | 'note'>): Classification {
  if (row.artist) return { artist: row.artist };
  return {
    skip: (row.skipReason ?? 'ambiguous') as
      | 'tribute'
      | 'non_headliner'
      | 'non_music'
      | 'ambiguous',
    reason: row.note ?? '',
  };
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
    .where(
      and(
        gte(events.startDate, now),
        lte(events.startDate, end),
        or(isNull(events.hidden), eq(events.hidden, false)),
        isNull(events.dedupedAt),
        isNull(events.deadAt)
      )
    )
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

  // Rows for these exact events, then rows for other events with the same title
  // (a recurring show), so the AI is asked about each title once
  const ids = candidates.map((e) => e.id);
  const ownRows = ids.length
    ? await db.select().from(eventTracks).where(inArray(eventTracks.eventId, ids))
    : [];
  const rowByEvent = new Map(ownRows.map((r) => [r.eventId, r]));
  const missingTitles = [
    ...new Set(candidates.filter((e) => !rowByEvent.has(e.id)).map((e) => e.title)),
  ];
  const rowByTitle = new Map<string, TrackRow>();
  if (missingTitles.length) {
    const titled = await db
      .select({ title: events.title, row: eventTracks })
      .from(eventTracks)
      .innerJoin(events, eq(events.id, eventTracks.eventId))
      .where(inArray(events.title, missingTitles))
      .orderBy(desc(eventTracks.checkedAt));
    for (const { title, row } of titled) if (!rowByTitle.has(title)) rowByTitle.set(title, row);
  }

  const toClassify = candidates.filter((e) => !rowByEvent.has(e.id) && !rowByTitle.has(e.title));
  const uniqueToClassify = [...new Map(toClassify.map((e) => [e.title, e])).values()];
  const fresh = await classifyTitles(uniqueToClassify);
  const classifierFailed = fresh === null;
  const freshByTitle = new Map(
    uniqueToClassify.map((e, i): [string, Classification] => [
      e.title,
      // Treat the title as the artist so the week still fills, but don't save it
      fresh?.[i] ?? { artist: e.title },
    ])
  );

  let spotifySearches = 0;
  const matches = new Map<string, { classification: Classification; match: TrackMatch }>();
  for (const event of candidates) {
    const own = rowByEvent.get(event.id);
    if (own) {
      matches.set(event.id, {
        classification: toClassification(own),
        match: {
          trackId: own.spotifyTrackId,
          trackName: own.trackName,
          spotifyArtist: own.spotifyArtist,
          note: own.note ?? '',
        },
      });
      continue;
    }

    const sameTitle = rowByTitle.get(event.title);
    const classification = sameTitle ? toClassification(sameTitle) : freshByTitle.get(event.title)!;
    let match: TrackMatch;
    if ('skip' in classification) {
      match = { trackId: null, trackName: null, spotifyArtist: null, note: classification.reason };
    } else if (sameTitle && sameTitle.artist === classification.artist) {
      match = {
        trackId: sameTitle.spotifyTrackId,
        trackName: sameTitle.trackName,
        spotifyArtist: sameTitle.spotifyArtist,
        note: sameTitle.note ?? '',
      };
    } else {
      spotifySearches++;
      match = await findTrack(event, classification.artist);
    }
    matches.set(event.id, { classification, match });

    if (sameTitle || !classifierFailed) {
      await db
        .insert(eventTracks)
        .values({
          eventId: event.id,
          artist: 'artist' in classification ? classification.artist : null,
          skipReason: 'skip' in classification ? classification.skip : null,
          spotifyTrackId: match.trackId,
          trackName: match.trackName,
          spotifyArtist: match.spotifyArtist,
          note: match.note,
        })
        .onConflictDoNothing();
    }
  }

  // Highest score first, one track per artist and per track, then by date: scores
  // cluster too tightly to be a useful listening order
  const seenArtists = new Set<string>();
  const seenTracks = new Set<string>();
  const kept: Omit<PlaylistShow, 'soldOut'>[] = [];
  const skipped: { title: string; note: string }[] = [];
  for (const event of candidates) {
    const { match } = matches.get(event.id)!;
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
    aiCalls: uniqueToClassify.length ? 1 : 0,
    spotifySearches,
    classifierFailed,
    shows,
    skipped,
  };
}
