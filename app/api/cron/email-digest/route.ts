import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  curatedEvents,
  curatorProfiles,
  events,
  newsletterSettings,
  userPreferences,
} from "@/lib/db/schema";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notIlike,
  or,
  sql,
} from "drizzle-orm";
import { env, isPostmarkEnabled } from "@/lib/config/env";
import { verifyAuthToken } from "@/lib/utils/auth";
import { sendEmail } from "@/lib/notifications/postmark";
import {
  generateDigestEmailHtml,
  generateDigestEmailText,
} from "@/lib/notifications/email-templates";
import { queryFilteredEvents, type DbEvent } from "@/lib/db/queries/events";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getDayBoundariesEastern,
  getTodayStringEastern,
  parseAsEastern,
} from "@/lib/utils/timezone";
import {
  isBoolean,
  isNumber,
  isNumberArray,
  isRecord,
  isString,
  isStringArray,
} from "@/lib/utils/validation";
import type {
  NewsletterFilters,
  NewsletterDaySelection,
  NewsletterFrequency,
  NewsletterScoreTier,
} from "@/lib/newsletter/types";

export const maxDuration = 300; // 5 minutes

const SCORE_FLOORS: Record<NewsletterScoreTier, number> = {
  all: 0,
  top50: 13,
  top10: 17,
};

const DEFAULT_FILTERS: NewsletterFilters = {
  search: "",
  selectedTimes: [],
  priceFilter: "any",
  customMaxPrice: null,
  tagsInclude: [],
  tagsExclude: [],
  selectedLocations: [],
  selectedZips: [],
  showDailyEvents: true,
  useDefaultFilters: true,
};

function normalizeFilters(filters?: NewsletterFilters): NewsletterFilters {
  return {
    ...DEFAULT_FILTERS,
    ...filters,
    selectedTimes: Array.isArray(filters?.selectedTimes)
      ? filters?.selectedTimes
      : [],
    tagsInclude: Array.isArray(filters?.tagsInclude)
      ? filters?.tagsInclude
      : [],
    tagsExclude: Array.isArray(filters?.tagsExclude)
      ? filters?.tagsExclude
      : [],
    selectedLocations: Array.isArray(filters?.selectedLocations)
      ? filters?.selectedLocations
      : [],
    selectedZips: Array.isArray(filters?.selectedZips)
      ? filters?.selectedZips
      : [],
  };
}

type NewsletterTime = NonNullable<NewsletterFilters["selectedTimes"]>[number];
type NewsletterPriceFilter = NonNullable<NewsletterFilters["priceFilter"]>;

const NEWSLETTER_FREQUENCIES = new Set<NewsletterFrequency>([
  "none",
  "daily",
  "weekly",
]);
const NEWSLETTER_DAY_SELECTIONS = new Set<NewsletterDaySelection>([
  "everyday",
  "weekend",
  "specific",
]);
const NEWSLETTER_SCORE_TIERS = new Set<NewsletterScoreTier>([
  "all",
  "top50",
  "top10",
]);
const NEWSLETTER_TIMES = new Set<NewsletterTime>([
  "morning",
  "afternoon",
  "evening",
]);
const NEWSLETTER_PRICE_FILTERS = new Set<NewsletterPriceFilter>([
  "any",
  "free",
  "under20",
  "under100",
  "custom",
]);

function parseNewsletterFrequency(value: unknown): NewsletterFrequency {
  return isString(value) && NEWSLETTER_FREQUENCIES.has(value as NewsletterFrequency)
    ? (value as NewsletterFrequency)
    : "none";
}

function parseNewsletterDaySelection(value: unknown): NewsletterDaySelection {
  return isString(value) && NEWSLETTER_DAY_SELECTIONS.has(value as NewsletterDaySelection)
    ? (value as NewsletterDaySelection)
    : "everyday";
}

function parseNewsletterScoreTier(value: unknown): NewsletterScoreTier {
  return isString(value) && NEWSLETTER_SCORE_TIERS.has(value as NewsletterScoreTier)
    ? (value as NewsletterScoreTier)
    : "all";
}

function parseNewsletterFilters(value: unknown): NewsletterFilters | undefined {
  if (!isRecord(value)) return undefined;
  const filters: NewsletterFilters = {};

  if (isString(value.search)) filters.search = value.search;

  if (isStringArray(value.selectedTimes)) {
    const times = value.selectedTimes.filter(
      (time): time is NewsletterTime => NEWSLETTER_TIMES.has(time as NewsletterTime)
    );
    if (times.length > 0) filters.selectedTimes = times;
  }

  if (isString(value.priceFilter) && NEWSLETTER_PRICE_FILTERS.has(value.priceFilter as NewsletterPriceFilter)) {
    filters.priceFilter = value.priceFilter as NewsletterPriceFilter;
  }

  const customMaxPrice = value.customMaxPrice;
  if (customMaxPrice === null || isNumber(customMaxPrice)) {
    filters.customMaxPrice = customMaxPrice;
  }

  if (isStringArray(value.tagsInclude)) filters.tagsInclude = value.tagsInclude;
  if (isStringArray(value.tagsExclude)) filters.tagsExclude = value.tagsExclude;
  if (isStringArray(value.selectedLocations)) filters.selectedLocations = value.selectedLocations;
  if (isStringArray(value.selectedZips)) filters.selectedZips = value.selectedZips;
  if (isBoolean(value.showDailyEvents)) filters.showDailyEvents = value.showDailyEvents;
  if (isBoolean(value.useDefaultFilters)) filters.useDefaultFilters = value.useDefaultFilters;

  return filters;
}

function parseHiddenEvents(value: unknown): { title: string; organizer: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !isString(entry.title) || !isString(entry.organizer)) {
      return [];
    }
    return [{ title: entry.title, organizer: entry.organizer }];
  });
}

// Helper to format duration in human-readable form
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getEasternDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeSelectedDays(selectedDays?: number[] | null): number[] {
  if (!Array.isArray(selectedDays)) return [];
  return Array.from(
    new Set(
      selectedDays.filter(
        (day) => Number.isInteger(day) && day >= 0 && day <= 6
      )
    )
  );
}


async function fetchAllEvents(params: Omit<EventFilterParams, "limit">) {
  const allEvents: DbEvent[] = [];
  let cursor: string | undefined = params.cursor;
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (iterations < MAX_ITERATIONS) {
    const batch = await queryFilteredEvents({
      ...params,
      cursor,
      limit: 100,
    });

    allEvents.push(...batch.events);

    if (!batch.hasMore || !batch.nextCursor) {
      break;
    }

    cursor = batch.nextCursor;
    iterations += 1;
  }

  return allEvents;
}

function applyScoreTier(eventsToFilter: DbEvent[], scoreTier: NewsletterScoreTier) {
  const floor = SCORE_FLOORS[scoreTier];
  if (scoreTier === "all") return eventsToFilter;

  return eventsToFilter.filter((event) => (event.score ?? 0) >= floor);
}

function applyDailyCaps(
  eventsToCap: DbEvent[],
  capPerDay: number
): { events: DbEvent[]; trimmed: boolean } {
  const grouped = new Map<string, DbEvent[]>();

  for (const event of eventsToCap) {
    const key = getEasternDateKey(new Date(event.startDate));
    const existing = grouped.get(key) || [];
    existing.push(event);
    grouped.set(key, existing);
  }

  const sortedKeys = Array.from(grouped.keys()).sort();
  const result: DbEvent[] = [];
  let trimmed = false;

  for (const key of sortedKeys) {
    const dayEvents = grouped.get(key) || [];
    const sorted = [...dayEvents].sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

    if (sorted.length > capPerDay) {
      trimmed = true;
    }

    result.push(...sorted.slice(0, capPerDay));
  }

  return { events: result, trimmed };
}

function buildSchedule(
  frequency: NewsletterFrequency,
  daySelection: NewsletterDaySelection | null | undefined,
  selectedDays: number[] | null | undefined,
  weekendEdition: boolean,
  todayStr: string
): {
  startStr: string;
  endStr: string;
  headerText: string;
  periodText: string;
  capPerDay: number;
} | null {
  const dayOfWeek = parseAsEastern(todayStr, "12:00:00").getDay();
  const normalizedDaySelection = daySelection ?? "everyday";
  const normalizedSelectedDays = normalizeSelectedDays(selectedDays);
  const weekendDays = new Set([0, 5, 6]);

  if (frequency === "weekly") {
    if (dayOfWeek !== 1) {
      return null;
    }
    return {
      startStr: todayStr,
      endStr: addDaysToDateString(todayStr, 6),
      headerText: "Weekly Event Digest",
      periodText: "this week",
      capPerDay: 25,
    };
  }

  if (frequency === "daily") {
    const matchesSelection =
      normalizedDaySelection === "everyday" ||
      (normalizedDaySelection === "weekend" && weekendDays.has(dayOfWeek)) ||
      (normalizedDaySelection === "specific" &&
        normalizedSelectedDays.includes(dayOfWeek));

    if (!matchesSelection) {
      return null;
    }

    const hasFullWeekend =
      normalizedDaySelection === "everyday" ||
      normalizedDaySelection === "weekend" ||
      (normalizedDaySelection === "specific" &&
        [0, 5, 6].every((day) => normalizedSelectedDays.includes(day)));

    if (weekendEdition && hasFullWeekend && weekendDays.has(dayOfWeek)) {
      if (dayOfWeek === 5) {
        return {
          startStr: todayStr,
          endStr: addDaysToDateString(todayStr, 2),
          headerText: "Weekend Event Digest",
          periodText: "this weekend",
          capPerDay: 40,
        };
      }
      return null;
    }

    return {
      startStr: todayStr,
      endStr: todayStr,
      headerText: "Daily Event Digest",
      periodText: "today",
      capPerDay: 50,
    };
  }

  return null;
}

interface DigestUser {
  userId: string;
  email: string;
  name?: string;
  frequency: NewsletterFrequency;
  daySelection: NewsletterDaySelection;
  selectedDays: number[];
  weekendEdition: boolean;
  scoreTier: NewsletterScoreTier;
  filters: NewsletterFilters;
  curatorUserIds: string[];
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: { title: string; organizer: string }[];
  useDefaultFilters: boolean;
}

// Email digest cron job
//
// This route sends email digests to users who have opted in.
// Daily digests are sent every day at 7 AM ET.
// Weekly digests are sent on Mondays at 7 AM ET.
//
// Schedule: Daily at 7 AM ET (cron: "0 12 * * *" = 12:00 UTC)
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!isPostmarkEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Email features not enabled (POSTMARK_API_KEY or POSTMARK_FROM_EMAIL not set)",
      },
      { status: 400 }
    );
  }

  const jobStartTime = Date.now();
  const todayStr = getTodayStringEastern();

  const stats = {
    usersQueried: 0,
    emailsSent: 0,
    emailsFailed: 0,
    usersSkipped: 0,
  };

  try {
    console.log("[Newsletter] Starting email digest job...");

    const supabase = createServiceClient();

    const usersToProcess = await db
      .select({
        userId: newsletterSettings.userId,
        frequency: newsletterSettings.frequency,
        daySelection: newsletterSettings.daySelection,
        selectedDays: newsletterSettings.selectedDays,
        weekendEdition: newsletterSettings.weekendEdition,
        scoreTier: newsletterSettings.scoreTier,
        filters: newsletterSettings.filters,
        curatorUserIds: newsletterSettings.curatorUserIds,
        blockedHosts: userPreferences.blockedHosts,
        blockedKeywords: userPreferences.blockedKeywords,
        hiddenEvents: userPreferences.hiddenEvents,
        useDefaultFilters: userPreferences.useDefaultFilters,
      })
      .from(newsletterSettings)
      .leftJoin(
        userPreferences,
        eq(newsletterSettings.userId, userPreferences.userId)
      );

    const legacyUsers = await db
      .select({
        userId: userPreferences.userId,
        frequency: userPreferences.emailDigestFrequency,
        tags: userPreferences.emailDigestTags,
        blockedHosts: userPreferences.blockedHosts,
        blockedKeywords: userPreferences.blockedKeywords,
        hiddenEvents: userPreferences.hiddenEvents,
        useDefaultFilters: userPreferences.useDefaultFilters,
      })
      .from(userPreferences)
      .leftJoin(
        newsletterSettings,
        eq(userPreferences.userId, newsletterSettings.userId)
      )
      .where(
        and(
          isNull(newsletterSettings.userId),
          sql`${userPreferences.emailDigestFrequency} IS NOT NULL`,
          sql`${userPreferences.emailDigestFrequency} != 'none'`
        )
      );

    for (const legacy of legacyUsers) {
      const legacyFrequency = parseNewsletterFrequency(legacy.frequency);
      const legacyFilters = normalizeFilters({
        ...DEFAULT_FILTERS,
        tagsInclude: legacy.tags ?? [],
      });

      await db
        .insert(newsletterSettings)
        .values({
          userId: legacy.userId,
          frequency: legacyFrequency,
          daySelection: "everyday",
          selectedDays: [],
          weekendEdition: false,
          scoreTier: "all",
          filters: legacyFilters,
          curatorUserIds: [],
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      usersToProcess.push({
        userId: legacy.userId,
        frequency: legacyFrequency,
        daySelection: "everyday",
        selectedDays: [],
        weekendEdition: false,
        scoreTier: "all",
        filters: legacyFilters,
        curatorUserIds: [],
        blockedHosts: legacy.blockedHosts,
        blockedKeywords: legacy.blockedKeywords,
        hiddenEvents: legacy.hiddenEvents,
        useDefaultFilters: legacy.useDefaultFilters,
      });
    }

    const activeUsers = usersToProcess.filter(
      (user) => user.frequency && user.frequency !== "none"
    );

    stats.usersQueried = activeUsers.length;

    if (activeUsers.length === 0) {
      const totalDuration = Date.now() - jobStartTime;
      return NextResponse.json({
        success: true,
        duration: totalDuration,
        stats,
      });
    }

    const userIds = activeUsers.map((user) => user.userId);
    const { data: authUsers, error: authError } =
      await supabase.auth.admin.listUsers({
        perPage: 1000,
      });

    if (authError) {
      console.error("[Newsletter] Failed to fetch auth users:", authError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch user emails" },
        { status: 500 }
      );
    }

    const userEmailMap = new Map<string, { email: string; name?: string }>();
    authUsers.users.forEach((user) => {
      const metadataName = isRecord(user.user_metadata)
        ? isString(user.user_metadata.full_name)
          ? user.user_metadata.full_name
          : isString(user.user_metadata.name)
            ? user.user_metadata.name
            : undefined
        : undefined;
      if (user.email && userIds.includes(user.id)) {
        userEmailMap.set(user.id, {
          email: user.email,
          name: metadataName,
        });
      }
    });

    for (const userPref of activeUsers) {
      const userAuth = userEmailMap.get(userPref.userId);
      if (!userAuth?.email) {
        stats.usersSkipped++;
        continue;
      }

      const frequency = parseNewsletterFrequency(userPref.frequency);
      const daySelection = parseNewsletterDaySelection(userPref.daySelection);
      const selectedDays = normalizeSelectedDays(
        isNumberArray(userPref.selectedDays) ? userPref.selectedDays : undefined
      );
      const weekendEdition = isBoolean(userPref.weekendEdition)
        ? userPref.weekendEdition
        : false;
      const scoreTier = parseNewsletterScoreTier(userPref.scoreTier);
      const filters = normalizeFilters(parseNewsletterFilters(userPref.filters));
      const curatorUserIds = isStringArray(userPref.curatorUserIds)
        ? userPref.curatorUserIds
        : [];
      const blockedHosts = isStringArray(userPref.blockedHosts)
        ? userPref.blockedHosts
        : [];
      const blockedKeywords = isStringArray(userPref.blockedKeywords)
        ? userPref.blockedKeywords
        : [];
      const hiddenEvents = parseHiddenEvents(userPref.hiddenEvents);
      const useDefaultFilters = isBoolean(userPref.useDefaultFilters)
        ? userPref.useDefaultFilters
        : true;

      const schedule = buildSchedule(
        frequency,
        daySelection,
        selectedDays,
        weekendEdition,
        todayStr
      );

      if (!schedule) {
        stats.usersSkipped++;
        continue;
      }

      const digestUser: DigestUser = {
        userId: userPref.userId,
        email: userAuth.email,
        name: userAuth.name,
        frequency,
        daySelection,
        selectedDays,
        weekendEdition,
        scoreTier,
        filters,
        curatorUserIds,
        blockedHosts,
        blockedKeywords,
        hiddenEvents,
        useDefaultFilters,
      };

      const { startStr, endStr, headerText, periodText, capPerDay } = schedule;
      const { start: rangeStart } = getDayBoundariesEastern(startStr);
      const { end: rangeEnd } = getDayBoundariesEastern(endStr);

      const params: Omit<EventFilterParams, "limit"> = {
        search: digestUser.filters.search || undefined,
        dateFilter: "custom",
        dateStart: startStr,
        dateEnd: endStr,
        times:
          digestUser.filters.selectedTimes &&
          digestUser.filters.selectedTimes.length > 0
            ? digestUser.filters.selectedTimes
            : undefined,
        priceFilter: digestUser.filters.priceFilter,
        maxPrice: digestUser.filters.customMaxPrice ?? undefined,
        tagsInclude: digestUser.filters.tagsInclude,
        tagsExclude: digestUser.filters.tagsExclude,
        locations: digestUser.filters.selectedLocations,
        zips: digestUser.filters.selectedZips,
        blockedHosts: digestUser.blockedHosts,
        blockedKeywords: digestUser.blockedKeywords,
        hiddenFingerprints: digestUser.hiddenEvents,
        showDailyEvents: digestUser.filters.showDailyEvents,
        useDefaultFilters: digestUser.useDefaultFilters,
      };

      let filteredEvents = await fetchAllEvents(params);
      filteredEvents = applyScoreTier(filteredEvents, digestUser.scoreTier);

      let curatedEventList: DigestEvent[] = [];
      if (digestUser.curatorUserIds.length > 0) {
        const curatedRows = await db
          .select({
            event: {
              id: events.id,
              title: events.title,
              startDate: events.startDate,
              location: events.location,
              organizer: events.organizer,
              price: events.price,
              imageUrl: events.imageUrl,
              tags: events.tags,
              url: events.url,
            },
            curatorName: curatorProfiles.displayName,
            curatorId: curatorProfiles.userId,
            note: curatedEvents.note,
          })
          .from(curatedEvents)
          .innerJoin(events, eq(curatedEvents.eventId, events.id))
          .innerJoin(curatorProfiles, eq(curatedEvents.userId, curatorProfiles.userId))
          .where(
            and(
              inArray(curatedEvents.userId, digestUser.curatorUserIds),
              eq(curatorProfiles.isPublic, true),
              gte(events.startDate, rangeStart),
              lte(events.startDate, rangeEnd),
              or(isNull(events.hidden), sql`${events.hidden} = false`),
              or(
                isNull(events.location),
                and(
                  notIlike(events.location, "%online%"),
                  notIlike(events.location, "%virtual%")
                )
              )
            )
          );

        const curatedMap = new Map<string, DigestEvent>();
        for (const row of curatedRows) {
          const existing = curatedMap.get(row.event.id);
          const curatorEntry = {
            name: row.curatorName,
            note: row.note,
          };

          if (existing) {
            existing.curators = [...(existing.curators || []), curatorEntry];
          } else {
            curatedMap.set(row.event.id, {
              ...row.event,
              curators: [curatorEntry],
            });
          }
        }

        curatedEventList = Array.from(curatedMap.values()).sort((a, b) => {
          return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        });
      }

      const curatedIds = new Set(curatedEventList.map((event) => event.id));
      filteredEvents = filteredEvents.filter((event) => !curatedIds.has(event.id));

      const capped = applyDailyCaps(filteredEvents, capPerDay);
      const cappedEvents = capped.events;

      const capNotice = capped.trimmed
        ? `Showing top ${capPerDay} events per day. Update your filters to see more.`
        : null;

      const eventsToSend: DigestEvent[] = cappedEvents.map((event) => ({
        id: event.id,
        title: event.title,
        startDate: event.startDate,
        location: event.location,
        organizer: event.organizer,
        price: event.price,
        imageUrl: event.imageUrl,
        tags: event.tags,
        url: event.url,
      }));

      const totalCount = eventsToSend.length + curatedEventList.length;
      if (totalCount === 0) {
        stats.usersSkipped++;
        continue;
      }

      const appUrl = env.NEXT_PUBLIC_APP_URL;
      const unsubscribeUrl = `${appUrl}/profile?unsubscribe=true`;

      const htmlBody = generateDigestEmailHtml({
        recipientName: digestUser.name,
        frequency: digestUser.frequency === "weekly" ? "weekly" : "daily",
        headerText,
        periodText,
        events: eventsToSend,
        curatedEvents: curatedEventList,
        unsubscribeUrl,
        capNotice,
      });

      const textBody = generateDigestEmailText({
        recipientName: digestUser.name,
        frequency: digestUser.frequency === "weekly" ? "weekly" : "daily",
        headerText,
        periodText,
        events: eventsToSend,
        curatedEvents: curatedEventList,
        unsubscribeUrl,
        capNotice,
      });

      const subjectPrefix =
        headerText === "Weekend Event Digest" ? "Weekend" : headerText.split(" ")[0];
      const subject = `${subjectPrefix} Asheville events (${totalCount} events)`;

      try {
        const sent = await sendEmail({
          to: digestUser.email,
          subject,
          htmlBody,
          textBody,
        });

        if (sent) {
          stats.emailsSent++;
          await db
            .update(newsletterSettings)
            .set({ lastSentAt: new Date() })
            .where(eq(newsletterSettings.userId, digestUser.userId));
        } else {
          stats.emailsFailed++;
        }
      } catch (error) {
        stats.emailsFailed++;
        console.error(`[Newsletter] Error sending to ${digestUser.email}:`, error);
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    const totalDuration = Date.now() - jobStartTime;
    console.log(
      `[Newsletter] Job complete in ${formatDuration(totalDuration)}`
    );

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats,
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error(
      `[Newsletter] Job failed after ${formatDuration(totalDuration)}`
    );
    console.error("[Newsletter] Error:", error);
    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}

type EventFilterParams = Parameters<typeof queryFilteredEvents>[0];

interface DigestEvent {
  id: string;
  title: string;
  startDate: Date;
  location?: string | null;
  organizer?: string | null;
  price?: string | null;
  imageUrl?: string | null;
  tags?: string[] | null;
  url: string;
  curators?: Array<{ name: string; note?: string | null }>;
}
