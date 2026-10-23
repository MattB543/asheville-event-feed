'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ghost, type LucideIcon } from 'lucide-react';
import { Bat, Pumpkin } from '@/components/halloween/Decor';
import type { SeasonKey } from '@/lib/seasons';
import { useSeason } from './useSeason';

// Each season's look: the badge beside the logo, the banner's mark and the menu icon. All
// still: their animations live in the season page's stylesheet, and these show on every page
const LOOK: Record<
  SeasonKey,
  { badge: ReactNode; mark: ReactNode; endMark: ReactNode; icon: LucideIcon; bar: string }
> = {
  halloween: {
    badge: <Pumpkin size={24} glow still />,
    mark: <Bat width={22} color="#1a0a00" still />,
    endMark: <Pumpkin size={20} still />,
    icon: Ghost,
    bar: 'bg-gradient-to-r from-[#c2410c] via-[#f97316] to-[#c2410c] text-[#1a0a00]',
  },
};

/** The season's badge beside the header logo, linking to its page */
export function SeasonalBadge() {
  const current = useSeason();
  if (!current) return null;
  const { season, banner } = current;
  return (
    <Link
      href={season.href}
      aria-label={banner}
      title={season.label}
      className="-ml-0.5 shrink-0 transition-transform hover:scale-110 lg:-ml-2"
    >
      {LOOK[season.key].badge}
    </Link>
  );
}

/** A thin bar across the top of every page while the season runs */
export function SeasonalBanner() {
  const current = useSeason();
  const pathname = usePathname();
  if (!current || pathname === current.season.href) return null;
  const { season, banner } = current;
  const look = LOOK[season.key];
  return (
    <Link
      href={season.href}
      className={`flex h-9 items-center justify-center gap-2 px-3 text-sm font-semibold hover:brightness-110 ${look.bar}`}
    >
      {look.mark}
      <span className="truncate sm:hidden">{season.short}</span>
      <span className="hidden truncate sm:inline">{banner}</span>
      <span className="sm:hidden">{look.endMark}</span>
      <span aria-hidden="true" className="hidden sm:inline">
        →
      </span>
    </Link>
  );
}

/** The Events menu entry for the running season, if any */
export function useSeasonalMenuItem() {
  const season = useSeason()?.season;
  return season ? { href: season.href, label: season.label, icon: LOOK[season.key].icon } : null;
}
