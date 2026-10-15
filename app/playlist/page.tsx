import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import ShareButton from '@/components/ShareButton';
import { env } from '@/lib/config/env';
import { getLatestPlaylistWeek, type PlaylistWeek } from '@/lib/db/queries/playlist';
import { generateEventSlug } from '@/lib/utils/slugify';
import { addDaysToDateString } from '@/lib/utils/dateFilters';
import { formatDateEastern } from '@/lib/utils/timezone';
import { formatPriceDisplay } from '@/lib/utils/priceDisplay';
import { mapsSearchUrl } from '@/lib/utils/maps';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';
const pageUrl = `${siteUrl}/playlist`;
const title = 'Bands playing in Asheville this week';
const description =
  "A weekly Spotify playlist of the week's biggest shows in Asheville, one song per band.";

const cover = {
  url: '/playlist-cover.jpg',
  width: 640,
  height: 640,
  alt: 'AVL GO: live this week in Asheville, NC',
};

export const metadata: Metadata = {
  title: 'Asheville Live Music This Week: Spotify Playlist',
  description,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'website',
    url: pageUrl,
    title,
    description,
    siteName: 'AVL GO',
    locale: 'en_US',
    images: [cover],
  },
  // Square art reads better as a small card than stretched into a wide one
  twitter: { card: 'summary', title, description, images: [cover.url] },
};

// "Wednesday, October 14 – Thursday, October 22, 2026": the span of the shows themselves
function showRange(dates: Date[]): string {
  const day = (d: Date) => formatDateEastern(d, { weekday: 'long', month: 'long', day: 'numeric' });
  const first = dates[0];
  const last = dates[dates.length - 1];
  return `${day(first)} – ${day(last)}, ${formatDateEastern(last, { year: 'numeric' })}`;
}

// Dollar amounts and "Free" only: "Ticketed" beside a Tickets button says nothing
function shownPrice(price: string | null): string | null {
  const display = formatPriceDisplay(price);
  return display === 'Free' || /^\$\d/.test(display) ? display : null;
}

const eventHref = (e: { title: string; startDate: Date; eventId: string }) =>
  `/events/${generateEventSlug(e.title, e.startDate, e.eventId)}`;

export default async function PlaylistPage() {
  // Per request: the picks change weekly and the query is two small reads
  await connection();

  let week: PlaylistWeek | null = null;
  let failed = false;
  try {
    week = await getLatestPlaylistWeek();
  } catch (error) {
    console.error('[Playlist] Failed to load the playlist:', error);
    failed = true;
  }

  const playlistId = env.SPOTIFY_PLAYLIST_ID;
  const allShowsHref = week
    ? `/events?dateFilter=custom&dateStart=${week.weekStart}&dateEnd=${addDaysToDateString(week.weekStart, 7)}&tagsInclude=Live+Music`
    : '/events';

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="flex-grow">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 pt-6 pb-10">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              {title}
            </h1>
            <ShareButton path="/playlist" title={title} />
          </div>
          {week && week.shows.length > 0 && (
            <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              {showRange(week.shows.map((show) => show.startDate))}
            </p>
          )}
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Every Sunday morning, the highest-scored upcoming shows on AVL GO are picked (the score
            weighs how rare, novel and big each event is), and each headliner&apos;s most popular
            song goes on the playlist.
            {week && (
              <span className="block mt-1 text-xs text-gray-500 dark:text-gray-500">
                Last updated{' '}
                {formatDateEastern(week.updatedAt, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                ET
              </span>
            )}
          </p>

          {playlistId && (
            <iframe
              title="AVL GO weekly playlist on Spotify"
              src={`https://open.spotify.com/embed/playlist/${playlistId}`}
              className="mt-6 w-full rounded-xl border-0"
              // Tall enough to show about six tracks without scrolling
              height={560}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            />
          )}

          {!week ? (
            <div className="mt-6 p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              <p className="text-gray-600 dark:text-gray-400">
                {failed
                  ? 'The playlist is unavailable right now. Please try again shortly.'
                  : "This week's playlist hasn't been built yet."}
              </p>
            </div>
          ) : (
            <ul className="mt-6 overflow-hidden divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              {week.shows.map((show) => (
                <li
                  key={show.eventId}
                  className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-3 even:bg-gray-50 dark:even:bg-gray-800/40"
                >
                  <span className="sm:w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">
                    {formatDateEastern(show.startDate, {
                      weekday: 'short',
                      month: 'numeric',
                      day: 'numeric',
                    })}
                  </span>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={eventHref(show)}
                      className="font-semibold text-gray-900 dark:text-gray-100 hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {show.artist}
                    </Link>
                    {show.venue && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {' '}
                        at{' '}
                        <a
                          href={mapsSearchUrl(show.location ?? `${show.venue}, Asheville, NC`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
                        >
                          {show.venue}
                        </a>
                      </span>
                    )}
                    {show.trackName && (
                      <a
                        href={`https://open.spotify.com/track/${show.trackId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-gray-600 dark:text-gray-400 hover:text-[#1DB954] truncate"
                      >
                        ♪ {show.trackName}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                    {shownPrice(show.price) && (
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {shownPrice(show.price)}
                      </span>
                    )}
                    <a
                      href={show.ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`px-3 py-1 text-xs font-medium rounded-md border ${
                        show.soldOut
                          ? 'border-red-200 dark:border-red-900 text-red-600 dark:text-red-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      {show.soldOut ? 'Sold out' : 'Tickets'}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-sm">
            <Link
              href={allShowsHref}
              className="text-brand-600 dark:text-brand-400 hover:underline"
            >
              See every live-music show this week →
            </Link>
          </p>

          {week && (week.notOnSpotify.length > 0 || week.tributes.length > 0) && (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 text-sm">
              {[
                { label: 'Headliners not on Spotify', rows: week.notOnSpotify },
                { label: 'Tribute and cover shows', rows: week.tributes },
              ]
                .filter((group) => group.rows.length > 0)
                .map((group) => (
                  <div key={group.label}>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {group.label}
                    </h2>
                    <ul className="mt-2 space-y-1">
                      {group.rows.map((e) => (
                        <li key={e.eventId} className="flex gap-3">
                          <span className="w-20 shrink-0 text-gray-500 dark:text-gray-400">
                            {formatDateEastern(e.startDate, {
                              weekday: 'short',
                              month: 'numeric',
                              day: 'numeric',
                            })}
                          </span>
                          <Link
                            href={eventHref(e)}
                            className="text-gray-700 dark:text-gray-300 hover:underline"
                          >
                            {e.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <FooterCredit />
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
