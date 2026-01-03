import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import SubmitEventButton from '@/components/SubmitEventButton';
import UserMenu from '@/components/UserMenu';
import EventTabSwitcher from '@/components/EventTabSwitcher';

interface HeaderProps {
  /**
   * When provided, shows the event tab switcher.
   * Only use on events pages (/events, /events/top30, /events/your-list)
   */
  activeTab?: 'all' | 'top30' | 'yourList';
}

export default function Header({ activeTab }: HeaderProps) {
  const showTabs = activeTab !== undefined;

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
        {/* Mobile/Tablet layout */}
        <div className="flex flex-col gap-2 lg:hidden">
          {/* Row 1: Logo + buttons */}
          <div className="flex items-center justify-between">
            <Link href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[24px] sm:h-[30px] w-auto dark:brightness-0 dark:invert"
              />
            </Link>
            <div className="flex items-center gap-1 sm:gap-2">
              <SubmitEventButton />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
          {/* Row 2: Tabs (if shown) + attribution */}
          <div className="flex items-center justify-between">
            {showTabs ? (
              <EventTabSwitcher activeTab={activeTab} />
            ) : (
              <div /> /* Empty div to maintain spacing */
            )}
            <div className="text-xs text-gray-500/50 dark:text-gray-400/50">
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
          </div>
        </div>

        {/* Desktop layout */}
        <div className="hidden lg:flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[32px] w-auto dark:brightness-0 dark:invert"
              />
            </Link>
            {showTabs && <EventTabSwitcher activeTab={activeTab} />}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-500/50 dark:text-gray-400/50">
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
                mattbrooks.xyz
              </a>
            </div>
            <SubmitEventButton />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
