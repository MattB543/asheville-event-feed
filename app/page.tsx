import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { gte, asc, InferSelectModel } from "drizzle-orm";
import EventFeed from "@/components/EventFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Image from "next/image";
import { getStartOfTodayEastern } from "@/lib/utils/timezone";

type DbEvent = InferSelectModel<typeof events>;

export const revalidate = 3600; // Revalidate every hour

export default async function Home() {
  let initialEvents: DbEvent[] = [];

  try {
    // Only fetch if DATABASE_URL is defined
    if (process.env.DATABASE_URL) {
      console.log("[Home] Fetching events from database...");
      // Get start of today in Eastern timezone (Asheville, NC)
      // Events that started earlier today may still be ongoing
      const startOfToday = getStartOfTodayEastern();

      initialEvents = await db
        .select()
        .from(events)
        .where(gte(events.startDate, startOfToday))
        .orderBy(asc(events.startDate));
      console.log(`[Home] Fetched ${initialEvents.length} events.`);
    } else {
      console.warn("[Home] DATABASE_URL is not defined. Showing empty feed.");
    }
  } catch (error) {
    console.error("[Home] Failed to fetch events:", error);
    // Fallback to empty array or maybe a static list if available
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Image
            src="/avlgo_banner_logo_v2.svg"
            alt="AVL GO"
            width={140}
            height={38}
            priority
          />
          <div className="text-sm text-gray-500 hidden sm:block">
            Aggregating all AVL events
          </div>
        </div>
      </header>

      <ErrorBoundary>
        <EventFeed initialEvents={initialEvents} />
      </ErrorBoundary>

      <footer className="bg-white border-t border-gray-200 mt-8 py-8 text-center text-sm text-gray-500">
        <p className="mb-2">
          Built by Matt Brooks at Brooks Solutions, LLC. Learn more at{" "}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
          >
            mattbrooks.xyz
          </a>
        </p>
        <p>
          © {new Date().getFullYear()} Asheville Event Feed. Not affiliated with
          AVL Today, Eventbrite, Facebook Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
