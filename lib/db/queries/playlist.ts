import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, eventTracks, genreNotes, playlistPicks } from '@/lib/db/schema';
import { getDayBoundariesEastern } from '@/lib/utils/timezone';
import { normalizeName, venueFor } from '@/lib/utils/venueName';
import { WINDOW_DAYS } from '@/lib/playlist/run';
import { liveEvent } from '@/lib/db/liveEvent';
import { mainGenre } from '@/lib/playlist/genreNotes';

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
  imageUrl: string | null;
  timeUnknown: boolean;
  /** e.g. "Zydeco" */
  genre: string | null;
  /** What an unusual genre means; null for well-known ones */
  genreNote: string | null;
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
  // A week's picks are written in one transaction, so any row's createdAt is when
  // it was built, even if every pick has since been hidden
  const [latest] = await db
    .select({ weekStart: playlistPicks.weekStart, updatedAt: playlistPicks.createdAt })
    .from(playlistPicks)
    .orderBy(desc(playlistPicks.weekStart), desc(playlistPicks.createdAt))
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
      imageUrl: events.imageUrl,
      timeUnknown: events.timeUnknown,
      tags: events.tags,
      artist: eventTracks.artist,
      spotifyArtist: eventTracks.spotifyArtist,
      trackName: eventTracks.trackName,
      trackId: playlistPicks.spotifyTrackId,
      soldOut: playlistPicks.soldOut,
    })
    .from(playlistPicks)
    .innerJoin(events, eq(events.id, playlistPicks.eventId))
    .leftJoin(eventTracks, eq(eventTracks.eventId, playlistPicks.eventId))
    // Hidden events 404, so they leave the page; duplicate and dead ones still open a page
    // and stay, so the list keeps matching what's on Spotify
    .where(and(eq(playlistPicks.weekStart, latest.weekStart), sql`${events.hidden} IS NOT TRUE`))
    .orderBy(asc(playlistPicks.position));

  const genres = [...new Set(picks.map((p) => mainGenre(p.tags)).filter((g) => g !== null))];
  const notes = new Map<string, string | null>();
  try {
    if (genres.length) {
      const rows = await db.select().from(genreNotes).where(inArray(genreNotes.genre, genres));
      for (const row of rows) notes.set(row.genre, row.note);
    }
  } catch (error) {
    // Tooltips are extra: the page still works if the table is missing or unreadable
    console.warn('[Playlist] Genre notes unavailable:', error);
  }
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
      imageUrl: p.imageUrl,
      timeUnknown: p.timeUnknown ?? false,
      genre: mainGenre(p.tags),
      genreNote: mainGenre(p.tags) ? (notes.get(mainGenre(p.tags)!) ?? null) : null,
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

  return {
    weekStart: latest.weekStart,
    updatedAt: latest.updatedAt,
    shows,
    notOnSpotify,
    tributes,
  };
}
