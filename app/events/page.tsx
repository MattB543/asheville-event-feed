import { unstable_cache } from "next/cache";
import EventFeed from "@/components/EventFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import InfoBanner from "@/components/InfoBanner";
import ThemeToggle from "@/components/ThemeToggle";
import SubmitEventButton from "@/components/SubmitEventButton";
import UserMenu from "@/components/UserMenu";
import EventTabSwitcher from "@/components/EventTabSwitcher";
import { Metadata } from "next";
import Link from "next/link";
import {
  queryFilteredEvents,
  getEventMetadata,
  queryTop30Events,
  DbEvent,
  EventMetadata,
} from "@/lib/db/queries/events";

export const metadata: Metadata = {
  title: "All Events | AVL GO",
  description:
    "Browse all Asheville events aggregated from 10+ sources. Filter by date, price, tags, and location.",
};

export const revalidate = 3600; // Fallback revalidation every hour

// Cached first page query - loads 250 events for SSR to ensure enough content
// for users who have many events hidden/collapsed
const getFirstPageEvents = unstable_cache(
  async () => {
    console.log("[Events] Fetching first page (250 events) for SSR...");
    return queryFilteredEvents({ limit: 250 });
  },
  ["events-first-page"],
  { tags: ["events"], revalidate: 3600 }
);

// Cached metadata - computed from ALL events for filter dropdowns
const getCachedMetadata = unstable_cache(
  async () => {
    console.log("[Events] Fetching filter metadata...");
    return getEventMetadata();
  },
  ["events-metadata"],
  { tags: ["events"], revalidate: 3600 }
);

// Cached top 30 events query
const getTop30Events = unstable_cache(
  async () => {
    console.log("[Events] Fetching top 30 events...");
    return queryTop30Events();
  },
  ["events-top30"],
  { tags: ["events"], revalidate: 3600 }
);

interface EventsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const params = await searchParams;
  const activeTab = params.tab === "forYou" ? "forYou" : params.tab === "top30" ? "top30" : "all";

  let initialEvents: DbEvent[] = [];
  let initialTotalCount = 0;
  let top30Events: DbEvent[] = [];
  let metadata: EventMetadata = {
    availableTags: [],
    availableLocations: [],
    availableZips: [],
  };

  try {
    // Fetch first page, metadata, and top 30 in parallel
    const [firstPageResult, metadataResult, top30Result] = await Promise.all([
      getFirstPageEvents(),
      getCachedMetadata(),
      activeTab === "top30" ? getTop30Events() : Promise.resolve([]),
    ]);
    initialEvents = firstPageResult.events;
    initialTotalCount = firstPageResult.totalCount;
    metadata = metadataResult;
    top30Events = top30Result;
    console.log(
      `[Events] SSR loaded ${initialEvents.length} events (of ${initialTotalCount} total)${activeTab === "top30" ? `, ${top30Events.length} top 30 events` : ""}`
    );
  } catch (error) {
    console.error("[Events] Failed to fetch events:", error);
    // Fallback to empty arrays
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          {/* Mobile/Tablet: tabs always in header */}
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
            {/* Row 2: Tabs + attribution */}
            <div className="flex items-center justify-between">
              <EventTabSwitcher activeTab={activeTab} />
              <div className="text-xs text-gray-500/50 dark:text-gray-400/50">
                <a
                  href="https://github.com/MattB543/asheville-event-feed"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Open-sourced
                </a>{" "}
                by{" "}
                <a
                  href="https://mattbrooks.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-600 dark:hover:text-gray-300"
                >
                  matt
                </a>
              </div>
            </div>
          </div>
          {/* Desktop: horizontal layout with tabs in header */}
          <div className="hidden lg:flex items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <Link href="/">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/avlgo_banner_logo_v2.svg"
                  alt="AVL GO"
                  className="h-[36px] w-auto dark:brightness-0 dark:invert"
                />
              </Link>
              <EventTabSwitcher activeTab={activeTab} />
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
                </a>{" "}
                by{" "}
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
