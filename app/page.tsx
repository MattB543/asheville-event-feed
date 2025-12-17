import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { gte, asc, and, notIlike, or, isNull, InferSelectModel } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import EventFeed from "@/components/EventFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getStartOfTodayEastern } from "@/lib/utils/timezone";
import InfoBanner from "@/components/InfoBanner";
import ThemeToggle from "@/components/ThemeToggle";
import SubmitEventButton from "@/components/SubmitEventButton";
import UserMenu from "@/components/UserMenu";
import { matchesDefaultFilter } from "@/lib/config/defaultFilters";
import { extractCity } from "@/lib/utils/extractCity";

// Omit embedding from the type since we exclude it from queries (server-side only)
type DbEvent = Omit<InferSelectModel<typeof events>, 'embedding'>;

// Pre-computed metadata for filter dropdowns (computed server-side to avoid client O(n) operations)
export interface EventMetadata {
  availableTags: string[];
  availableLocations: string[];
  availableZips: { zip: string; count: number }[];
}

const LOCATION_MIN_EVENTS = 6;
const ZIP_MIN_EVENTS = 6;

// Compute filter metadata server-side (avoids 3 expensive O(n) useMemo operations on client)
function computeEventMetadata(events: DbEvent[]): EventMetadata {
  const tagCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const zipCounts = new Map<string, number>();
  let onlineCount = 0;

  // Single pass through events to compute all metadata
  events.forEach((event) => {
    // Tags
    event.tags?.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });

    // Locations
    const city = extractCity(event.location);
    if (city === "Online") {
      onlineCount++;
    } else if (city) {
      locationCounts.set(city, (locationCounts.get(city) || 0) + 1);
    }

    // Zips
    if (event.zip) {
      zipCounts.set(event.zip, (zipCounts.get(event.zip) || 0) + 1);
    }
  });

  // Process tags - sorted by frequency
  const availableTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  // Process locations - filtered and sorted with Asheville first
  const availableLocations = Array.from(locationCounts.entries())
    .filter(([city, count]) => city === "Asheville" || count >= LOCATION_MIN_EVENTS)
    .map(([city]) => city)
    .sort((a, b) => {
      if (a === "Asheville") return -1;
      if (b === "Asheville") return 1;
      return a.localeCompare(b);
    });

  // Add Online if it meets threshold
  if (onlineCount >= LOCATION_MIN_EVENTS) {
    availableLocations.push("Online");
  }

  // Process zips - filtered and sorted by count
  const availableZips = Array.from(zipCounts.entries())
    .filter(([, count]) => count >= ZIP_MIN_EVENTS)
    .sort((a, b) => b[1] - a[1])
    .map(([zip, count]) => ({ zip, count }));

  return { availableTags, availableLocations, availableZips };
}

export const revalidate = 3600; // Fallback revalidation every hour

// Cached query function - invalidated via revalidateTag('events') in cron routes
const getHomeEvents = unstable_cache(
  async (): Promise<DbEvent[]> => {
    if (!process.env.DATABASE_URL) {
      console.warn("[Home] DATABASE_URL is not defined. Showing empty feed.");
      return [];
    }

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
        updatedAt: events.updatedAt,
        lastSeenAt: events.lastSeenAt,
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
    const filteredEvents = allEvents.filter((event) => {
      const textToCheck = `${event.title} ${event.description || ""} ${event.organizer || ""}`;
      return !matchesDefaultFilter(textToCheck);
    });
    console.log(`[Home] Fetched ${allEvents.length} events, ${filteredEvents.length} after spam filter.`);
    return filteredEvents;
  },
  ['home-events'],
  { tags: ['events'], revalidate: 3600 }
);

export default async function Home() {
  let initialEvents: DbEvent[] = [];
  let metadata: EventMetadata = { availableTags: [], availableLocations: [], availableZips: [] };

  try {
    initialEvents = await getHomeEvents();
    // Compute metadata server-side (single pass through events)
    metadata = computeEventMetadata(initialEvents);
  } catch (error) {
    console.error("[Home] Failed to fetch events:", error);
    // Fallback to empty arrays
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
        <EventFeed initialEvents={initialEvents} initialMetadata={metadata} />
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
