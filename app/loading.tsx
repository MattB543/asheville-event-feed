import { EventFeedSkeleton } from '@/components/EventCardSkeleton';

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          {/* Mobile/Tablet layout */}
          <div className="flex flex-col gap-2 lg:hidden">
            {/* Row 1: Logo + credit + buttons */}
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_logo.png"
                alt="AVL GO"
                className="h-[19px] sm:h-[24px] w-auto shrink-0 dark:brightness-0 dark:invert"
              />
              <div className="ml-auto min-w-0 truncate whitespace-nowrap text-xs text-gray-500/50 dark:text-gray-400/50">
                Open-sourced by Matt
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                {/* Submit button placeholder */}
                <div className="w-[28px] h-[28px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                {/* Theme toggle placeholder */}
                <div className="w-[28px] h-[28px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                {/* User menu placeholder */}
                <div className="w-[28px] h-[28px] rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              </div>
            </div>
            {/* Row 2: Tabs (content-width, 36px, like the real ones) */}
            <div className="flex items-center gap-0.5 sm:gap-1">
              <div className="w-20 h-9 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              <div className="w-16 h-9 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              <div className="w-16 h-9 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              <div className="w-14 h-9 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
            {/* Row 3: city status badges */}
            <div className="flex h-10 items-center">
              <div className="w-64 h-6 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
          </div>

          {/* Desktop layout */}
          <div className="hidden lg:flex items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_logo.png"
                alt="AVL GO"
                className="h-[26px] w-auto dark:brightness-0 dark:invert"
              />
              {/* Tab placeholders */}
              <div className="flex items-center gap-1">
                <div className="w-24 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="w-16 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="w-20 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="w-14 h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
              </div>
              {/* City status badges placeholder */}
              <div className="w-64 h-6 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <div className="whitespace-nowrap text-xs xl:text-sm text-gray-500/50 dark:text-gray-400/50">
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
          &copy; {new Date().getFullYear()} AVL GO. Not affiliated with AVL Today or Eventbrite.
        </p>
      </footer>
    </main>
  );
}
