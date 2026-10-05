'use client';

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { ChevronDown, Droplet, ExternalLink, Navigation } from 'lucide-react';
import {
  CITY_PARKING_URL,
  type ParkingDeck,
  type ParkingStatus,
  type WaterStatus,
} from '@/lib/cityStatus/types';
import { useCityStatus } from './useCityStatus';
import WaterAlertModal from './WaterAlertModal';

/** Under this many open spaces a garage's count turns amber */
const LOW_SPACES = 25;

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/** The water badge's pill shape */
function pillSize(compact: boolean): string {
  // Inset ring in the mobile row: its overflow-x scroller clips anything outside
  return compact ? 'h-7 px-2.5' : 'h-9 px-3 focus-visible:ring-inset';
}

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

function spaces(available: number): string {
  return available === 0 ? 'full' : `${available} space${available === 1 ? '' : 's'}`;
}

/** Every garage by full name with its count; each row opens directions. */
function GarageList({ parking }: { parking: ParkingStatus }) {
  const asOf = clock.format(new Date(parking.asOf));
  return (
    <>
      <p className="whitespace-nowrap px-3 pb-1.5 text-xs text-gray-500 dark:text-gray-400">
        Open spaces in city garages · as of {asOf}
      </p>
      <ul>
        {parking.decks.map((deck) => (
          <li key={deck.slug}>
            <a
              href={directionsUrl(deck)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${deck.name} garage, ${spaces(deck.available)}: directions in Google Maps`}
              className={`flex min-h-10 items-center gap-2.5 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 ${FOCUS_RING} focus-visible:ring-inset`}
            >
              <span className="min-w-0 flex-1 truncate">{deck.name}</span>
              <span className={`font-semibold tabular-nums ${countTone(deck.available)}`}>
                {deck.available}
              </span>
              <Navigation size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-gray-100 px-3 pt-2 text-xs dark:border-gray-800">
        <span className="text-gray-500 dark:text-gray-400">Tap for directions</span>
        <a
          href={CITY_PARKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 rounded text-brand-600 hover:underline dark:text-brand-400 ${FOCUS_RING}`}
        >
          City parking map
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </>
  );
}

/**
 * "Parking", styled like the header's nav tabs, opens a native popover
 * (top layer, so the mobile row's scroller can't clip it; light-dismiss and
 * Escape for free) listing every garage with its count and directions.
 *
 * `compact`: the desktop layout (the mobile row's scroller needs an inset ring).
 */
function ParkingBadge({ parking, compact }: { parking: ParkingStatus; compact: boolean }) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const asOf = clock.format(new Date(parking.asOf));
  const total = parking.decks.reduce((sum, deck) => sum + deck.available, 0);

  // Pin the panel under the pill (it opens just after this click). 304px keeps
  // its "Open spaces in city garages · as of 12:45 PM" header on one line.
  const position = (event: MouseEvent<HTMLButtonElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(304, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  };

  // It's pinned to the viewport, so any scroll or resize closes it rather than leaving it adrift
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const close = () => {
      if (panel.matches(':popover-open')) panel.hidePopover();
    };
    const onToggle = (event: Event) => {
      const open = (event as ToggleEvent).newState === 'open';
      setIsOpen(open);
      const method = open ? 'addEventListener' : 'removeEventListener';
      window[method]('scroll', close, true);
      window[method]('resize', close);
    };
    panel.addEventListener('toggle', onToggle);
    return () => {
      panel.removeEventListener('toggle', onToggle);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        popoverTarget={panelId}
        onClick={position}
        aria-label={`Parking: ${total} space${total === 1 ? '' : 's'} in downtown garages as of ${asOf}. Show each garage with directions.`}
        title={`Open spaces in city garages · as of ${asOf}`}
        // Same size and colors as the EventTabSwitcher tabs; reads as active while open
        className={`flex shrink-0 items-center gap-1 whitespace-nowrap min-h-9 px-2.5 sm:px-3 lg:min-h-0 lg:py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors ${
          isOpen
            ? 'text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        } ${FOCUS_RING} ${compact ? '' : 'focus-visible:ring-inset'}`}
      >
        Parking
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        className="fixed inset-auto m-0 rounded-lg border border-gray-200 bg-white py-2 text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      >
        <GarageList parking={parking} />
      </div>
    </>
  );
}

/** "Boil water · Haw Creek", "Water outage · Rumbough Pl", "3 water outages" */
function waterLabels(water: WaterStatus): { full: string; short: string } {
  const boil = water.notices.filter((n) => n.kind === 'boil');
  const outages = water.notices.filter((n) => n.kind === 'outage');
  if (boil.length > 0) {
    return {
      full:
        boil.length > 1
          ? `${boil.length} boil water advisories`
          : boil[0].place
            ? `Boil water · ${boil[0].place}`
            : 'Boil water advisory',
      short: boil.length > 1 ? `Boil water (${boil.length})` : 'Boil water',
    };
  }
  return {
    full:
      outages.length > 1
        ? `${outages.length} water outages`
        : outages[0]?.place
          ? `Water outage · ${outages[0].place}`
          : 'Water outage',
    short: outages.length > 1 ? `${outages.length} outages` : 'Outage',
  };
}

/** Orange for boil-water (urgent); outages get a quieter neutral pill with an amber droplet. */
function WaterBadge({ water, compact }: { water: WaterStatus; compact: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const isBoil = water.level === 'boil';
  const { full, short } = waterLabels(water);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        // The header hides its credit line beside this (CSS :has, no client state)
        data-water-badge=""
        aria-haspopup="dialog"
        aria-label={`${full}. See what's happening.`}
        title={`${full}: see what's happening`}
        className={`inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border text-xs font-semibold transition-colors cursor-pointer ${pillSize(compact)} ${
          isBoil
            ? 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-300 dark:hover:bg-orange-950'
            : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700'
        } ${FOCUS_RING}`}
      >
        <Droplet
          size={13}
          aria-hidden="true"
          className={isBoil ? 'fill-current' : 'fill-amber-400 text-amber-500'}
        />
        {compact ? (
          <>
            {/* lg is tight beside the tabs and garages: a short label, the full one at xl */}
            <span className="xl:hidden">{short}</span>
            <span className="hidden max-w-[11rem] truncate xl:inline">{full}</span>
          </>
        ) : (
          <span className="max-w-[16rem] truncate">{full}</span>
        )}
      </button>
      {isOpen && <WaterAlertModal status={water} onClose={() => setIsOpen(false)} />}
    </>
  );
}

interface CityStatusBadgesProps {
  /**
   * mobile (< lg): its own row under the tabs, scrolling sideways if it must.
   * desktop: inline after the tabs.
   */
  layout: 'mobile' | 'desktop';
}

/**
 * Live civic status in the header: an active boil-water advisory / major water
 * outage badge (opens the notices) and the downtown garages' open spaces.
 * Renders nothing until data arrives; parking hides on any failure, while water
 * keeps the last advisories it knew about.
 */
export default function CityStatusBadges({ layout }: CityStatusBadgesProps) {
  const { parking, water } = useCityStatus();

  if (layout === 'mobile') {
    return (
      // Always rendered at badge height so the page doesn't jump when data arrives
      <div className="-mx-3 flex min-h-10 items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
        {water && <WaterBadge water={water} compact={false} />}
        {parking && <ParkingBadge parking={parking} compact={false} />}
      </div>
    );
  }

  if (!parking && !water) return null;
  return (
    // Parking first so it sits beside the tabs it's styled like
    <div className="flex shrink-0 items-center gap-2">
      {parking && <ParkingBadge parking={parking} compact />}
      {water && <WaterBadge water={water} compact />}
    </div>
  );
}
