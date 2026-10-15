import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, eventTracks, playlistPicks } from '@/lib/db/schema';
import { getDayBoundariesEastern } from '@/lib/utils/timezone';
import { normalizeName, venueFor } from '@/lib/playlist/match';
import { WINDOW_DAYS } from '@/lib/playlist/run';
import { liveEvent } from '@/lib/db/liveEvent';

export interface PlaylistShowRow {
  eventId: string;
  title: string;
  startDate: Date;
  ticketUrl: string;
  price: string | null;
  artist: string;
  venue: string;
  /** The full location, for the map link */
  location: string | null;
  trackId: string;
  trackName: string | null;
  soldOut: boolean;
}

export interface PlaylistExcludedRow {
  eventId: string;
  title: string;
  startDate: Date;
}

export interface PlaylistWeek {
  weekStart: string;
  /** When the playlist was last rebuilt */
  updatedAt: Date;
  shows: PlaylistShowRow[];
  notOnSpotify: PlaylistExcludedRow[];
  tributes: PlaylistExcludedRow[];
}

/** The most recent playlist, in playlist order, plus the shows it left out. */
export async function getLatestPlaylistWeek(): Promise<PlaylistWeek | null> {
  const [latest] = await db
    .select({ weekStart: playlistPicks.weekStart })
    .from(playlistPicks)
    .orderBy(desc(playlistPicks.weekStart))
    .limit(1);
  if (!latest) return null;

  const picks = await db
    .select({
      eventId: events.id,
      title: events.title,
      startDate: events.startDate,
      url: events.url,
      price: events.price,
      location: events.location,
      organizer: events.organizer,
      artist: eventTracks.artist,
      spotifyArtist: eventTracks.spotifyArtist,
      trackName: eventTracks.trackName,
      trackId: playlistPicks.spotifyTrackId,
      soldOut: playlistPicks.soldOut,
      createdAt: playlistPicks.createdAt,
    })
    .from(playlistPicks)
    .innerJoin(events, eq(events.id, playlistPicks.eventId))
    .leftJoin(eventTracks, eq(eventTracks.eventId, playlistPicks.eventId))
    .where(eq(playlistPicks.weekStart, latest.weekStart))
    .orderBy(asc(playlistPicks.position));

  const shows = picks.map((p) => {
    const artist = p.spotifyArtist ?? p.artist ?? p.title;
    return {
      eventId: p.eventId,
      title: p.title,
      startDate: p.startDate,
      ticketUrl: p.url,
      price: p.price,
      artist,
      venue: venueFor(p, artist),
      location: p.location,
      trackId: p.trackId,
      trackName: p.trackName,
      soldOut: p.soldOut,
    };
  });

  // Shows the job looked at that week but couldn't put on the playlist
  const start = getDayBoundariesEastern(latest.weekStart).start;
  const end = new Date(start.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const missed = await db
    .select({
      eventId: events.id,
      title: events.title,
      startDate: events.startDate,
      skipReason: eventTracks.skipReason,
    })
    .from(eventTracks)
    .innerJoin(events, eq(events.id, eventTracks.eventId))
    .where(
      and(
        gte(events.startDate, start),
        lt(events.startDate, end),
        isNull(eventTracks.spotifyTrackId),
        or(
          isNull(eventTracks.skipReason),
          inArray(eventTracks.skipReason, ['tribute', 'ambiguous'])
        ),
        liveEvent
      )
    )
    .orderBy(asc(events.startDate));

  // Another date of a band already on the playlist isn't missing anything
  const keptArtists = shows.map((s) => normalizeName(s.artist)).filter(Boolean);
  const seenTitles = new Set<string>();
  const notOnSpotify: PlaylistExcludedRow[] = [];
  const tributes: PlaylistExcludedRow[] = [];
  for (const m of missed) {
    if (seenTitles.has(m.title)) continue;
    seenTitles.add(m.title);
    const row = { eventId: m.eventId, title: m.title, startDate: m.startDate };
    if (m.skipReason === 'tribute') tributes.push(row);
    else if (!keptArtists.some((a) => normalizeName(m.title).includes(a))) notOnSpotify.push(row);
  }

  const updatedAt = new Date(Math.max(...picks.map((p) => p.createdAt.getTime())));
  return { weekStart: latest.weekStart, updatedAt, shows, notOnSpotify, tributes };
}
