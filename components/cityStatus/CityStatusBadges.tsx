'use client';

import { useState } from 'react';
import { Droplet } from 'lucide-react';
import type { WaterStatus } from '@/lib/cityStatus/types';
import { useCityStatus } from './useCityStatus';
import WaterAlertModal from './WaterAlertModal';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/** The water badge's pill shape */
function pillSize(compact: boolean): string {
  // Inset ring in the mobile row: its overflow-x scroller clips anything outside
  return compact ? 'h-7 px-2.5' : 'h-9 px-3 focus-visible:ring-inset';
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
 * outage badge that opens the notices. Renders nothing until there is one, and
 * keeps the last advisories it knew about through failed polls. (Garage counts
 * live on /parking.)
 */
export default function CityStatusBadges({ layout }: CityStatusBadgesProps) {
  const { water } = useCityStatus();
  if (!water) return null;

  if (layout === 'mobile') {
    return (
      <div className="-mx-3 flex min-h-10 items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
        <WaterBadge water={water} compact={false} />
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <WaterBadge water={water} compact />
    </div>
  );
}
