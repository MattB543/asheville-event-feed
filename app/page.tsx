import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { gte, asc, and, notIlike, or, isNull, InferSelectModel } from "drizzle-orm";
import EventFeed from "@/components/EventFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getStartOfTodayEastern } from "@/lib/utils/timezone";
import InfoBanner from "@/components/InfoBanner";
import ThemeToggle from "@/components/ThemeToggle";
import SubmitEventButton from "@/components/SubmitEventButton";
import UserMenu from "@/components/UserMenu";
import { matchesDefaultFilter } from "@/lib/config/defaultFilters";

// Omit embedding from the type since we exclude it from queries (server-side only)
type DbEvent = Omit<InferSelectModel<typeof events>, 'embedding'>;

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

      // Select all fields EXCEPT embedding to reduce payload size
      // embedding is 1536-dim vector used only for server-side similarity search
      const allEvents = await db
        .select({
          id: events.id,
          sourceId: events.sourceId,
          source: events.source,
          title: events.title,
          description: events.description,
          startDate: events.startDate,
          location: events.location,
          zip: events.zip,
          organizer: events.organizer,
          price: events.price,
          url: events.url,
          imageUrl: events.imageUrl,
          tags: events.tags,
          createdAt: events.createdAt,
          hidden: events.hidden,
          interestedCount: events.interestedCount,
          goingCount: events.goingCount,
          timeUnknown: events.timeUnknown,
          recurringType: events.recurringType,
          recurringEndDate: events.recurringEndDate,
          favoriteCount: events.favoriteCount,
          aiSummary: events.aiSummary,
          // Excluded: embedding (1536 floats, server-side only)
        })
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

      // Apply default spam filters server-side
      initialEvents = allEvents.filter((event) => {
        const textToCheck = `${event.title} ${event.description || ""} ${event.organizer || ""}`;
        return !matchesDefaultFilter(textToCheck);
      });
      console.log(`[Home] Fetched ${allEvents.length} events, ${initialEvents.length} after spam filter.`);
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
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          {/* Mobile: two-row layout */}
          <div className="flex flex-col gap-2 sm:hidden">
            <div className="flex items-center justify-between">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[24px] w-auto dark:brightness-0 dark:invert"
              />
              <div className="flex items-center gap-2">
                <SubmitEventButton />
                <ThemeToggle />
                <UserMenu />
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
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
          </div>
          {/* Desktop: horizontal layout */}
          <div className="hidden sm:flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/avlgo_banner_logo_v2.svg"
                alt="AVL GO"
                className="h-[36px] w-auto dark:brightness-0 dark:invert"
              />
              <div className="text-sm text-gray-500 dark:text-gray-400">
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
            </div>
            <div className="flex items-center gap-2">
              <SubmitEventButton />
              <ThemeToggle />
              <UserMenu />
            </div>
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
