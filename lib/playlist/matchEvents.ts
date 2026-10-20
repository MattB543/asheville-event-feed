import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, eventTracks } from '@/lib/db/schema';
import {
  classifyTitles,
  findTrack,
  toSkipReason,
  type Classification,
  type PlaylistEvent,
  type TrackMatch,
} from './match';

type TrackRow = typeof eventTracks.$inferSelect;

function toClassification(row: Pick<TrackRow, 'artist' | 'skipReason' | 'note'>): Classification {
  if (row.artist) return { artist: row.artist };
  return { skip: toSkipReason(row.skipReason), reason: row.note ?? '' };
}

export interface MatchResult {
  matches: Map<string, TrackMatch>;
  aiCalls: number;
  spotifySearches: number;
  classifierFailed: boolean;
}

/**
 * Each event's Spotify track, from a saved match when there is one, otherwise by
 * asking the AI for the headliner (one call for all new titles) and searching
 * Spotify, saving each result as it's found. Used by the weekly playlist and by
 * event pages.
 */
export async function matchEvents(
  list: PlaylistEvent[],
  {
    savedOnly = false,
    guessOnFailure = true,
  }: {
    /** Only return saved matches: no AI call or Spotify search */
    savedOnly?: boolean;
    /** When the AI call fails, search Spotify for the title itself (never saved) */
    guessOnFailure?: boolean;
  } = {}
): Promise<MatchResult> {
  // Rows for these exact events, then rows for other events with the same title
  // (a recurring show), so the AI is asked about each title once
  const ids = list.map((e) => e.id);
  const ownRows = ids.length
    ? await db.select().from(eventTracks).where(inArray(eventTracks.eventId, ids))
    : [];
  const rowByEvent = new Map(ownRows.map((r) => [r.eventId, r]));
  const missingTitles = [...new Set(list.filter((e) => !rowByEvent.has(e.id)).map((e) => e.title))];
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

  const toClassify = savedOnly
    ? []
    : list.filter((e) => !rowByEvent.has(e.id) && !rowByTitle.has(e.title));
  const uniqueToClassify = [...new Map(toClassify.map((e) => [e.title, e])).values()];
  const fresh = await classifyTitles(uniqueToClassify);
  const classifierFailed = fresh === null;
  const freshByTitle = new Map(
    uniqueToClassify.map((e, i): [string, Classification] => [
      e.title,
      // Treat the title as the artist so the week still fills, but don't save it
      fresh?.[i] ??
        (guessOnFailure
          ? { artist: e.title }
          : { skip: 'ambiguous', reason: 'headliner lookup failed' }),
    ])
  );

  let spotifySearches = 0;
  const matches = new Map<string, TrackMatch>();
  for (const event of list) {
    const own = rowByEvent.get(event.id);
    if (own) {
      matches.set(event.id, {
        trackId: own.spotifyTrackId,
        trackName: own.trackName,
        spotifyArtist: own.spotifyArtist,
        note: own.note ?? '',
      });
      continue;
    }

    const sameTitle = rowByTitle.get(event.title);
    if (!sameTitle && savedOnly) {
      matches.set(event.id, { trackId: null, trackName: null, spotifyArtist: null, note: '' });
      continue;
    }
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
    matches.set(event.id, match);

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

  return {
    matches,
    aiCalls: uniqueToClassify.length ? 1 : 0,
    spotifySearches,
    classifierFailed,
  };
}
