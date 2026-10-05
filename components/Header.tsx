import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import SubmitEventButton from '@/components/SubmitEventButton';
import UserMenu from '@/components/UserMenu';
import EventTabSwitcher from '@/components/EventTabSwitcher';
import CityStatusBadges from '@/components/cityStatus/CityStatusBadges';

/** "Open-sourced by Matt" (the footers carry a longer FooterCredit) */
function Attribution({ className }: { className: string }) {
  return (
    <div className={`whitespace-nowrap text-gray-500/50 dark:text-gray-400/50 ${className}`}>
      <a
        href="https://github.com/MattB543/asheville-event-feed"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-600 dark:hover:text-gray-300"
      >
        Open-sourced
      </a>{' '}
      by{' '}
      <a
        href="https://mattbrooks.xyz"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-600 dark:hover:text-gray-300"
      >
        Matt
      </a>
    </div>
  );
}

interface HeaderProps {
  /**
   * Highlights the active tab in the event tab switcher.
   * undefined = no tab highlighted (e.g., home page)
   */
  activeTab?: 'all' | 'top30' | 'groups' | 'news' | 'parking';
}

export default function Header({ activeTab }: HeaderProps) {
  return (
    <header className="group/header bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
        {/* Mobile/Tablet layout */}
        <div className="flex flex-col gap-2 lg:hidden">
          {/* Row 1: Logo + credit + buttons. The credit always shows here, water
              notice or not; it truncates rather than overlap on very narrow phones. */}
          <div className="flex items-center gap-2">
            <Link href="/" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_logo.png"
                alt="AVL GO"
                className="h-[19px] sm:h-[24px] w-auto dark:brightness-0 dark:invert"
              />
            </Link>
            <Attribution className="ml-auto min-w-0 truncate text-xs" />
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <SubmitEventButton />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
          {/* Row 2: Tabs */}
          <EventTabSwitcher activeTab={activeTab} />
          {/* Row 3: water notice, only while one is active */}
          <CityStatusBadges layout="mobile" />
        </div>

        {/* Desktop layout */}
        <div className="hidden lg:flex items-center justify-between gap-4">
          {/* Tighter at lg so the tabs, badges and credit fit at 1024px */}
          <div className="flex items-center gap-4 xl:gap-6">
            <Link href="/" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_logo.png"
                alt="AVL GO"
                className="h-[22px] xl:h-[26px] w-auto dark:brightness-0 dark:invert"
              />
            </Link>
            {/* Any water notice sits right after the last tab */}
            <div className="flex items-center gap-1">
              <EventTabSwitcher activeTab={activeTab} />
              <CityStatusBadges layout="desktop" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Steps aside only while a water badge needs the room (CSS :has, no
                client state); the footers always carry it */}
            <Attribution className="text-xs xl:text-sm group-has-[[data-water-badge]]/header:hidden" />
            <SubmitEventButton />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
