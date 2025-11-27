import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { gte, asc, InferSelectModel } from 'drizzle-orm';
import EventFeed from '@/components/EventFeed';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import Image from 'next/image';

type DbEvent = InferSelectModel<typeof events>;

export const revalidate = 3600; // Revalidate every hour

export default async function Home() {
  let initialEvents: DbEvent[] = [];

  try {
    // Only fetch if DATABASE_URL is defined
    if (process.env.DATABASE_URL) {
      console.log('[Home] Fetching events from database...');
      initialEvents = await db.select()
        .from(events)
        .where(gte(events.startDate, new Date()))
        .orderBy(asc(events.startDate));
      console.log(`[Home] Fetched ${initialEvents.length} events.`);
    } else {
      console.warn('[Home] DATABASE_URL is not defined. Showing empty feed.');
    }
  } catch (error) {
    console.error('[Home] Failed to fetch events:', error);
    // Fallback to empty array or maybe a static list if available
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Image
            src="/avlgo_banner_logo.svg"
            alt="AVL GO"
            width={180}
            height={49}
            priority
          />
          <div className="text-sm text-gray-500 hidden sm:block">
            Aggregating AVL Today & Eventbrite
          </div>
        </div>
      </header>

      <ErrorBoundary>
        <EventFeed initialEvents={initialEvents} />
      </ErrorBoundary>
      
      <footer className="bg-white border-t border-gray-200 mt-12 py-8 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} Asheville Event Feed. Not affiliated with AVL Today or Eventbrite.</p>
      </footer>
    </main>
  );
}
