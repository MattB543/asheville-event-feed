import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { gte, asc, and, notIlike, or, isNull, InferSelectModel } from "drizzle-orm";
import EventFeed from "@/components/EventFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getStartOfTodayEastern } from "@/lib/utils/timezone";
import InfoBanner from "@/components/InfoBanner";
import ThemeToggle from "@/components/ThemeToggle";
import SubmitEventButton from "@/components/SubmitEventButton";

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
        .where(
          and(
            gte(events.startDate, startOfToday),
            // Exclude online/virtual events (but keep events with null location)
            or(
              isNull(events.location),
              and(
                notIlike(events.location, '%online%'),
                notIlike(events.location, '%virtual%')
              )
            )
          )
        )
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
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avlgo_banner_logo_v2.svg"
            alt="AVL GO"
            className="h-[24px] sm:h-[36px] w-auto dark:brightness-0 dark:invert"
          />
          <div className="flex items-center gap-2">
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 text-right block">
              All AVL events aggregated, by{" "}
              <a
                href="https://mattbrooks.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-gray-300"
              >
                mattbrooks.xyz
              </a>
            </div>

            <SubmitEventButton />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <InfoBanner />

      <ErrorBoundary>
        <EventFeed initialEvents={initialEvents} />
      </ErrorBoundary>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="mb-2">
          Built by Matt Brooks at Brooks Solutions, LLC. Learn more at{" "}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
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
