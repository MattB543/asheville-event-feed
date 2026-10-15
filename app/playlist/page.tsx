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
// Short names ("Wed, Oct 14") fit a phone on one line
function showRange(dates: Date[], length: 'long' | 'short'): string {
  const day = (d: Date) => formatDateEastern(d, { weekday: length, month: length, day: 'numeric' });
  const first = dates[0];
  const last = dates[dates.length - 1];
  const range = `${day(first)} – ${day(last)}`;
  return length === 'long' ? `${range}, ${formatDateEastern(last, { year: 'numeric' })}` : range;
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
          {/* Share sits beside the title on wider screens, under it on phones */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              {title}
            </h1>
            <span className="hidden sm:block">
              <ShareButton path="/playlist" title={title} />
            </span>
          </div>
          {week && week.shows.length > 0 && (
            <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              <span className="sm:hidden">
                {showRange(
                  week.shows.map((show) => show.startDate),
                  'short'
                )}
              </span>
              <span className="hidden sm:inline">
                {showRange(
                  week.shows.map((show) => show.startDate),
                  'long'
                )}
              </span>
            </p>
          )}
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Each Sunday morning, the week&apos;s top-scored shows on AVL GO (rated on how rare,
            novel and big they are), one song per headliner.
          </p>
          <div className="mt-1 flex items-center justify-between gap-3">
            {week && (
              <span className="text-xs text-gray-500 dark:text-gray-500">
                Updated{' '}
                <span className="sm:hidden">
                  {formatDateEastern(week.updatedAt, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <span className="hidden sm:inline">
                  {formatDateEastern(week.updatedAt, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>{' '}
                ET
              </span>
            )}
            <span className="sm:hidden">
              <ShareButton path="/playlist" title={title} />
            </span>
          </div>

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
                  className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2.5 even:bg-gray-50 dark:even:bg-gray-800/40"
                >
                  {/* Day over date in a narrow column, so a phone row stays two lines tall */}
                  <div className="w-10 sm:w-14 shrink-0 text-center leading-tight">
                    <div className="text-[11px] font-medium uppercase text-gray-500 dark:text-gray-400">
                      {formatDateEastern(show.startDate, { weekday: 'short' })}
                    </div>
                    <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {formatDateEastern(show.startDate, { month: 'numeric', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={eventHref(show)}
                      className="block truncate font-semibold text-gray-900 dark:text-gray-100 hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {show.artist}
                    </Link>
                    {(show.venue || shownPrice(show.price)) && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {show.venue && (
                          <a
                            href={mapsSearchUrl(show.location ?? `${show.venue}, Asheville, NC`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
                          >
                            {show.venue}
                          </a>
                        )}
                        {/* Phones show the price here; wider screens beside Tickets */}
                        {shownPrice(show.price) && (
                          <span className="sm:hidden">
                            {show.venue && ' · '}
                            {shownPrice(show.price)}
                          </span>
                        )}
                      </div>
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
                  <div className="flex items-center gap-2 shrink-0">
                    {shownPrice(show.price) && (
                      <span className="hidden sm:inline text-sm text-gray-600 dark:text-gray-400">
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
