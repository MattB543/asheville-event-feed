'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ghost, type LucideIcon } from 'lucide-react';
import { Bat, Pumpkin } from '@/components/halloween/Decor';
import { seasonBanner, type SeasonKey } from '@/lib/seasons';
import { useSeason } from './useSeason';

// Each season's look: the badge beside the logo, the banner's mark and the menu icon
const LOOK: Record<
  SeasonKey,
  { badge: ReactNode; mark: ReactNode; endMark: ReactNode; icon: LucideIcon; bar: string }
> = {
  halloween: {
    badge: <Pumpkin size={24} glow />,
    mark: <Bat width={22} color="#1a0a00" />,
    endMark: <Pumpkin size={20} />,
    icon: Ghost,
    bar: 'bg-gradient-to-r from-[#c2410c] via-[#f97316] to-[#c2410c] text-[#1a0a00]',
  },
};

/** The season's badge beside the header logo, linking to its page */
export function SeasonalBadge({ season }: { season: SeasonKey | null }) {
  const current = useSeason(season);
  if (!current) return null;
  return (
    <Link
      href={current.href}
      aria-label={seasonBanner(current)}
      title={current.label}
      className="-ml-0.5 shrink-0 transition-transform hover:scale-110 lg:-ml-2"
    >
      {LOOK[current.key].badge}
    </Link>
  );
}

/** A thin bar across the top of every page while the season runs */
export function SeasonalBanner({ season }: { season: SeasonKey | null }) {
  const current = useSeason(season);
  const pathname = usePathname();
  if (!current || pathname === current.href) return null;
  const look = LOOK[current.key];
  return (
    <Link
      href={current.href}
      className={`flex h-9 items-center justify-center gap-2 px-3 text-sm font-semibold hover:brightness-110 ${look.bar}`}
    >
      {look.mark}
      <span className="truncate sm:hidden">{current.short}</span>
      <span className="hidden truncate sm:inline">{seasonBanner(current)}</span>
      <span className="sm:hidden">{look.endMark}</span>
      <span aria-hidden="true" className="hidden sm:inline">
        →
      </span>
    </Link>
  );
}

/** The Events menu entry for the running season, if any */
export function useSeasonalMenuItem(season: SeasonKey | null) {
  const current = useSeason(season);
  return current
    ? { href: current.href, label: current.label, icon: LOOK[current.key].icon }
    : null;
}
