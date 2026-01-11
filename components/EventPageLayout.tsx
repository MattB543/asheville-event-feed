import EventFeed from '@/components/EventFeed';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import InfoBanner from '@/components/InfoBanner';
import Header from '@/components/Header';
import {
  type DbEvent,
  type EventMetadata,
  type Top30EventsByCategory,
} from '@/lib/db/queries/events';

interface EventPageLayoutProps {
  activeTab: 'all' | 'top30' | 'yourList';
  initialEvents: DbEvent[];
  initialTotalCount: number;
  metadata: EventMetadata;
  top30Events: Top30EventsByCategory;
}

export default function EventPageLayout({
  activeTab,
  initialEvents,
  initialTotalCount,
  metadata,
  top30Events,
}: EventPageLayoutProps) {
  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab={activeTab} />

      <InfoBanner />

      <div className="flex-grow">
        <ErrorBoundary>
          <EventFeed
            initialEvents={initialEvents}
            initialTotalCount={initialTotalCount}
            initialMetadata={metadata}
            activeTab={activeTab}
            top30Events={top30Events}
          />
        </ErrorBoundary>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="mb-2">
          Built by{' '}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            Matt
          </a>{' '}
          at Brooks Solutions, LLC.
        </p>
        <p>
          © {new Date().getFullYear()} AVL GO. Not affiliated with AVL Today, Eventbrite, Facebook
          Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
