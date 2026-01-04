import { EventFeedSkeleton } from '@/components/EventCardSkeleton';

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          {/* Mobile/Tablet layout */}
          <div className="flex flex-col gap-2 lg:hidden">
            {/* Row 1: Logo + buttons */}
            <div className="flex items-center justify-between">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[24px] sm:h-[30px] w-auto dark:brightness-0 dark:invert"
              />
              <div className="flex items-center gap-1 sm:gap-2">
                {/* Submit button placeholder */}
                <div className="w-[28px] h-[28px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                {/* Theme toggle placeholder */}
                <div className="w-[28px] h-[28px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                {/* User menu placeholder */}
                <div className="w-[28px] h-[28px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              </div>
            </div>
            {/* Row 2: Tabs + attribution */}
            <div className="flex items-center justify-between">
              {/* Tab placeholders */}
              <div className="flex items-center gap-0.5 sm:gap-1">
                <div className="w-8 sm:w-20 h-6 sm:h-7 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="w-12 sm:w-14 h-6 sm:h-7 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="w-14 sm:w-16 h-6 sm:h-7 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              </div>
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[32px] w-auto dark:brightness-0 dark:invert"
              />
              {/* Tab placeholders */}
              <div className="flex items-center gap-1">
                <div className="w-24 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="w-16 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="w-20 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              </div>
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
                  Matt
                </a>
              </div>
              {/* Submit button placeholder */}
              <div className="w-[32px] h-[32px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              {/* Theme toggle placeholder */}
              <div className="w-[32px] h-[32px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              {/* User menu placeholder */}
              <div className="w-[32px] h-[32px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      <EventFeedSkeleton />

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>
          &copy; {new Date().getFullYear()} Asheville Event Feed. Not affiliated with AVL Today or
          Eventbrite.
        </p>
      </footer>
    </main>
  );
}
