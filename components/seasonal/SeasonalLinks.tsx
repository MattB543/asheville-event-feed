'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ghost, Leaf, ScrollText, Tent, type LucideIcon } from 'lucide-react';
import { Bat, Pumpkin } from '@/components/holidays/halloween/Decor';
import Turkey from '@/components/holidays/thanksgiving/Turkey';
import type { Season, SeasonKey } from '@/lib/seasons';
import { useSeason } from './useSeason';

// Halloween's original fade, as a step in hue, saturation and lightness: from #f97316 in the
// middle to #c2410c at the ends
const FADE_STEP = [-7, -7, -13];

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

const hsl = ([h, s, l]: number[]) =>
  `hsl(${h.toFixed(1)} ${Math.min(100, Math.max(0, s)).toFixed(1)}% ${Math.min(100, Math.max(0, l)).toFixed(1)}%)`;

/** The banner's colours, with dark or white text to suit. Faded, a light colour deepens toward
 * the ends; a dark one, with no room to deepen, brightens toward the middle instead */
export function bannerStyle({ color, fade }: Pick<Season, 'color' | 'fade'>): CSSProperties {
  const base = toHsl(color);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
  const text = light ? '#1a0a00' : '#fff';
  if (!fade) return { background: color, color: text };
  const step = (sign: number) => hsl(base.map((v, i) => v + sign * FADE_STEP[i]));
  const [middle, ends] = base[2] >= 30 ? [color, step(1)] : [step(-1), color];
  return { background: `linear-gradient(to right, ${ends}, ${middle}, ${ends})`, color: text };
}

// Each season's look: the badge beside the logo, the banner's mark and the menu icon. All
// still: their animations live in the season page's stylesheet, and these show on every page.
// The badge and the menu icon are each optional; a season with neither shows only its banner
const LOOK: Record<
  SeasonKey,
  { badge?: ReactNode; mark: ReactNode; endMark: ReactNode; icon?: LucideIcon }
> = {
  halloween: {
    badge: <Pumpkin size={24} glow still />,
    mark: <Bat width={22} color="#1a0a00" still />,
    endMark: <Pumpkin size={20} still />,
    icon: Ghost,
  },
  thanksgiving: {
    badge: <Turkey size={26} />,
    mark: <Leaf size={16} aria-hidden="true" className="shrink-0" />,
    endMark: <span aria-hidden="true">→</span>,
    icon: Leaf,
  },
  // Disaster Plan already has its own header tab
  plan: {
    mark: <ScrollText size={16} aria-hidden="true" className="shrink-0" />,
    endMark: <span aria-hidden="true">→</span>,
  },
  // No logo badge (cut from the launch scope)
  camps: {
    mark: <Tent size={16} aria-hidden="true" className="shrink-0" />,
    endMark: <span aria-hidden="true">→</span>,
    icon: Tent,
  },
};

/** The season's badge beside the header logo, linking to its page */
export function SeasonalBadge() {
  const current = useSeason();
  const badge = current && LOOK[current.season.key].badge;
  if (!current || !badge) return null;
  const { season, banner } = current;
  return (
    <Link
      href={season.href}
      aria-label={banner}
      title={season.label}
      className="-ml-0.5 shrink-0 transition-transform hover:scale-110 lg:-ml-2"
    >
      {badge}
    </Link>
  );
}

/** The banner's icon: an admin's emoji, or the season's drawn one */
export function BannerIcon({ season }: { season: Pick<Season, 'key' | 'icon'> }) {
  return season.icon ? (
    <span aria-hidden="true" className="text-base leading-none">
      {season.icon}
    </span>
  ) : (
    LOOK[season.key].mark
  );
}

/** The banner itself: a link on every page, or a still preview on the admins' seasons page */
export function BannerBar({
  season,
  banner,
  href,
}: {
  season: Season;
  banner: string;
  href?: string;
}) {
  const look = LOOK[season.key];
  const content = (
    <>
      <BannerIcon season={season} />
      {/* On phones a long line wraps rather than cut off */}
      <span className="text-center sm:hidden">{season.short}</span>
      <span className="hidden truncate sm:inline">{banner}</span>
      <span className="sm:hidden">{look.endMark}</span>
      <span aria-hidden="true" className="hidden sm:inline">
        →
      </span>
    </>
  );
  const className =
    'flex min-h-9 items-center justify-center gap-2 px-3 py-1.5 text-sm font-semibold';
  return href ? (
    <Link href={href} style={bannerStyle(season)} className={`${className} hover:brightness-110`}>
      {content}
    </Link>
  ) : (
    <div style={bannerStyle(season)} className={className}>
      {content}
    </div>
  );
}

/** A thin bar across the top of every page while the season runs */
export function SeasonalBanner() {
  const current = useSeason();
  const pathname = usePathname();
  if (!current) return null;
  const { season, banner } = current;
  // Not on the season's own pages (a camp's page sits under /camps)
  if (pathname === season.href || pathname.startsWith(`${season.href}/`)) return null;
  return <BannerBar season={season} banner={banner} href={season.href} />;
}

/** The Events menu entry for the running season, if any */
export function useSeasonalMenuItem() {
  const season = useSeason()?.season;
  const icon = season && LOOK[season.key].icon;
  return season && icon ? { href: season.href, label: season.label, icon } : null;
}
