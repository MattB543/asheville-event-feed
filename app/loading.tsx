import Header from '@/components/Header';
import { EventFeedSkeleton } from '@/components/EventCardSkeleton';

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* The real header, not a copy: a copy drifts out of step and the bar jumps
          when the page swaps in. No tab is highlighted, since this serves every route */}
      <Header />

      <EventFeedSkeleton />

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>
          &copy; {new Date().getFullYear()} AVL GO. Not affiliated with AVL Today or Eventbrite.
        </p>
      </footer>
    </main>
  );
}
