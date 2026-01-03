import { EventFeedSkeleton } from '@/components/EventCardSkeleton';

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avlgo_banner_logo_v2.svg"
            alt="AVL GO"
            className="h-[24px] sm:h-[36px] w-auto dark:brightness-0 dark:invert"
          />
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-xs sm:text-sm text-gray-500/70 dark:text-gray-400/70 text-right">
              <a
                href="https://github.com/MattB543/asheville-event-feed"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-gray-300"
              >
                Open-sourced
              </a>{' '}
              by{' '}
              <a
                href="https://mattbrooks.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-gray-300"
              >
                mattbrooks.xyz
              </a>
            </div>
            {/* Theme toggle placeholder */}
            <div className="w-[28px] h-[28px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" />
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
