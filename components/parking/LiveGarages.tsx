'use client';

import { ExternalLink, Navigation } from 'lucide-react';
import { CITY_PARKING_URL, type ParkingDeck } from '@/lib/cityStatus/types';
import { useCityStatus } from '@/components/cityStatus/useCityStatus';

/** Under this many open spaces a garage's count turns amber */
const LOW_SPACES = 25;

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});

/** Opens turn-by-turn directions in Google Maps (the native app on phones). */
function directionsUrl(deck: ParkingDeck): string {
  const destination =
    deck.lat !== null && deck.lng !== null
      ? `${deck.lat},${deck.lng}`
      : (deck.address ?? deck.name);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function countTone(available: number): string {
  if (available === 0) return 'text-red-600 dark:text-red-400';
  if (available < LOW_SPACES) return 'text-amber-600 dark:text-amber-400';
  return 'text-gray-900 dark:text-white';
}

const CARD = 'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';

/**
 * Open spaces in every downtown garage, from the same once-a-minute poll the
 * header uses. Hidden counts (feed down or over 10 minutes old) read as
 * unavailable, never as stale numbers.
 */
export default function LiveGarages() {
  const { parking, loading } = useCityStatus();

  return (
    <section aria-labelledby="live-garages" className={`${CARD} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="live-garages" className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Open garage spaces right now
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {parking
            ? `City + county garages · updated ${clock.format(new Date(parking.asOf))}`
            : 'City + county garages'}
        </p>
      </div>

      {parking ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {parking.decks.map((deck) => (
            <li key={deck.slug}>
              <a
                href={directionsUrl(deck)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${deck.name} garage, ${deck.available === 0 ? 'full' : `${deck.available} open spaces`}: directions in Google Maps`}
                className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-gray-800 dark:hover:bg-gray-800/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {deck.name}
                  </span>
                  {deck.address && (
                    <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                      {deck.address}
                    </span>
                  )}
                </span>
                <span className="text-right">
                  <span
                    className={`block text-lg font-semibold leading-tight tabular-nums ${countTone(deck.available)}`}
                  >
                    {deck.available === 0 ? 'Full' : deck.available}
                  </span>
                  {deck.available > 0 && (
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">open</span>
                  )}
                </span>
                <Navigation size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {loading
            ? 'Checking the garages…'
            : "The city's live garage counts aren't available right now."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>Tap a garage for directions. Counts refresh every minute.</span>
        <a
          href={CITY_PARKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
        >
          City parking map
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
