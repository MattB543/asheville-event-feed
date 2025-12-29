import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { events, userPreferences } from "@/lib/db/schema";
import { eq, and, gte, lte, or, isNull, notIlike, sql } from "drizzle-orm";
import {
  getUserCentroids,
  scoreEvent,
  getScoreTier,
  findNearestLikedEvent,
  type PositiveSignal,
  type NegativeSignal,
} from "@/lib/ai/personalization";
import { getStartOfTodayEastern, getDayBoundariesEastern, getTodayStringEastern } from "@/lib/utils/timezone";
import { isBoolean, isRecord, isString } from "@/lib/utils/validation";

// Date range options for filtering
type DateRange = 'today' | 'tomorrow' | 'week' | 'later' | 'all';

// Time bucket for grouping events
type TimeBucket = 'today' | 'tomorrow' | 'week' | 'later';

const DATE_RANGES: DateRange[] = ['today', 'tomorrow', 'week', 'later', 'all'];
const POSITIVE_SIGNAL_TYPES = new Set<PositiveSignal["signalType"]>([
  'favorite',
  'calendar',
  'share',
  'viewSource',
]);

function isPositiveSignal(value: unknown): value is PositiveSignal {
  if (!isRecord(value)) return false;
  if (!isString(value.eventId) || !isString(value.timestamp)) return false;
  if (!isBoolean(value.active)) return false;
  if (!isString(value.signalType)) return false;
  return POSITIVE_SIGNAL_TYPES.has(value.signalType as PositiveSignal["signalType"]);
}

function isNegativeSignal(value: unknown): value is NegativeSignal {
  if (!isRecord(value)) return false;
  if (!isString(value.eventId) || !isString(value.timestamp)) return false;
  return isBoolean(value.active);
}

function parseSignals<T>(
  value: unknown,
  isSignal: (entry: unknown) => entry is T
): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSignal);
}

// Helper to add days to a date string (YYYY-MM-DD format)
function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface ScoredEvent {
  event: {
    id: string;
    sourceId: string;
    source: string;
    title: string;
    description: string | null;
    startDate: Date;
    location: string | null;
    zip: string | null;
    organizer: string | null;
    price: string | null;
    url: string;
    imageUrl: string | null;
    tags: string[] | null;
    createdAt: Date | null;
    hidden: boolean | null;
    interestedCount: number | null;
    goingCount: number | null;
    timeUnknown: boolean | null;
    recurringType: string | null;
    recurringEndDate: Date | null;
    favoriteCount: number | null;
    aiSummary: string | null;
    updatedAt: Date | null;
    lastSeenAt: Date | null;
    score: number | null;
    scoreRarity: number | null;
    scoreUnique: number | null;
    scoreMagnitude: number | null;
    scoreReason: string | null;
  };
  score: number;
  tier: 'great' | 'good' | null;
  explanation: {
    primary: { eventId: string; title: string } | null;
  };
  bucket: TimeBucket;
}

/**
 * Determine which time bucket an event belongs to.
 */
function getTimeBucket(eventDate: Date): TimeBucket {
  const todayStr = getTodayStringEastern();
  const todayBoundaries = getDayBoundariesEastern(todayStr);

  const tomorrowStr = addDaysToDateString(todayStr, 1);
  const tomorrowBoundaries = getDayBoundariesEastern(tomorrowStr);

  const weekEndStr = addDaysToDateString(todayStr, 7);
  const weekEndBoundaries = getDayBoundariesEastern(weekEndStr);

  if (eventDate >= todayBoundaries.start && eventDate <= todayBoundaries.end) {
    return 'today';
  }
  if (eventDate >= tomorrowBoundaries.start && eventDate <= tomorrowBoundaries.end) {
    return 'tomorrow';
  }
  if (eventDate < weekEndBoundaries.start) {
    return 'week';
  }
  return 'later';
}

/**
 * GET /api/for-you
 *
 * Returns personalized event feed based on user's positive/negative signals.
 *
 * Query params:
 * - dateRange: 'today' | 'tomorrow' | 'week' | 'later' | 'all' (default: 'all')
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const dateRangeParam = searchParams.get('dateRange') || 'all';
    const dateRange = DATE_RANGES.includes(dateRangeParam as DateRange)
      ? (dateRangeParam as DateRange)
      : 'all';

    // Fetch user preferences
    const prefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    if (prefs.length === 0) {
      return NextResponse.json({
        events: [],
        meta: {
          signalCount: 0,
          minimumMet: false,
        },
      });
    }

    const userPref = prefs[0];
    const positiveSignals = parseSignals(userPref.positiveSignals, isPositiveSignal);
    const negativeSignals = parseSignals(userPref.negativeSignals, isNegativeSignal);

    // Count active signals (within 12 months)
    const now = Date.now();
    const twelveMonthsAgo = now - (12 * 30 * 24 * 60 * 60 * 1000);
    const activePositiveSignals = positiveSignals.filter(
      s => s.active && new Date(s.timestamp).getTime() >= twelveMonthsAgo
    );
    const activeNegativeSignals = negativeSignals.filter(
      s => s.active && new Date(s.timestamp).getTime() >= twelveMonthsAgo
    );
    const signalCount = activePositiveSignals.length + activeNegativeSignals.length;

    // Get or compute centroids
    const { positive: positiveCentroid, negative: negativeCentroid } =
      await getUserCentroids(user.id);

    if (!positiveCentroid) {
      // No positive signals = no personalization
      return NextResponse.json({
        events: [],
        meta: {
          signalCount,
          minimumMet: signalCount >= 5,
        },
      });
    }

    // Build date filter based on dateRange param
    const todayStr = getTodayStringEastern();
    const startOfToday = getStartOfTodayEastern();
    const fourteenDaysFromNowStr = addDaysToDateString(todayStr, 14);
    const fourteenDaysFromNow = getDayBoundariesEastern(fourteenDaysFromNowStr).end;

    const dateConditions = [
      gte(events.startDate, startOfToday),
      lte(events.startDate, fourteenDaysFromNow),
    ];

    // Apply specific date range if not 'all'
    if (dateRange !== 'all') {
      const todayBoundaries = getDayBoundariesEastern(todayStr);
      const tomorrowStr = addDaysToDateString(todayStr, 1);
      const tomorrowBoundaries = getDayBoundariesEastern(tomorrowStr);
      const weekEndStr = addDaysToDateString(todayStr, 7);
      const weekEndBoundaries = getDayBoundariesEastern(weekEndStr);

      switch (dateRange) {
        case 'today':
          dateConditions.push(lte(events.startDate, todayBoundaries.end));
          break;
        case 'tomorrow':
          dateConditions.push(gte(events.startDate, tomorrowBoundaries.start));
          dateConditions.push(lte(events.startDate, tomorrowBoundaries.end));
          break;
        case 'week':
          dateConditions.push(lte(events.startDate, weekEndBoundaries.start));
          break;
        case 'later':
          dateConditions.push(gte(events.startDate, weekEndBoundaries.start));
          break;
      }
    }

    // Fetch events for the next 14 days (or filtered range)
    const fetchedEvents = await db
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
        score: events.score,
        scoreRarity: events.scoreRarity,
        scoreUnique: events.scoreUnique,
        scoreMagnitude: events.scoreMagnitude,
        scoreReason: events.scoreReason,
        embedding: events.embedding,
      })
      .from(events)
      .where(
        and(
          ...dateConditions,
          // Exclude hidden events
          or(isNull(events.hidden), sql`${events.hidden} = false`),
          // Exclude online/virtual events
          or(
            isNull(events.location),
            and(
              notIlike(events.location, "%online%"),
              notIlike(events.location, "%virtual%")
            )
          )
        )
      );

    console.log(`[ForYou] Fetched ${fetchedEvents.length} events for scoring`);

    // Score each event
    const scoredEvents: ScoredEvent[] = [];

    for (const event of fetchedEvents) {
      // Skip events without embeddings
      if (!event.embedding) {
        continue;
      }

      const embedding =
        Array.isArray(event.embedding) &&
        event.embedding.every((value) => typeof value === "number")
          ? event.embedding
          : null;
      if (!embedding) {
        continue;
      }
      const eventScore = scoreEvent(embedding, positiveCentroid, negativeCentroid);

      // Filter out Hidden tier (score ≤ 0.3)
      if (eventScore <= 0.3) {
        continue;
      }

      const tier = getScoreTier(eventScore);
      const bucket = getTimeBucket(event.startDate);

      // Find explanation for Great and Good tier events
      const explanation: { primary: { eventId: string; title: string } | null } = {
        primary: null,
      };

      if (tier === 'great' || tier === 'good') {
        const nearestEvent = await findNearestLikedEvent(embedding, activePositiveSignals);
        explanation.primary = nearestEvent;
      }

      // Remove embedding from response (not needed on client)
      const { embedding: eventEmbedding, ...eventWithoutEmbedding } = event;
      void eventEmbedding;

      scoredEvents.push({
        event: eventWithoutEmbedding,
        score: eventScore,
        tier,
        explanation,
        bucket,
      });
    }

    // Sort events by score within each bucket
    scoredEvents.sort((a, b) => {
      // First sort by bucket priority
      const bucketOrder: Record<TimeBucket, number> = {
        today: 0,
        tomorrow: 1,
        week: 2,
        later: 3,
      };

      const bucketDiff = bucketOrder[a.bucket] - bucketOrder[b.bucket];
      if (bucketDiff !== 0) return bucketDiff;

      // Then sort by score within bucket (descending)
      return b.score - a.score;
    });

    console.log(
      `[ForYou] Returning ${scoredEvents.length} personalized events (signalCount=${signalCount})`
    );

    return NextResponse.json({
      events: scoredEvents,
      meta: {
        signalCount,
        minimumMet: signalCount >= 5,
      },
    });
  } catch (error) {
    console.error("[ForYou] Error generating personalized feed:", error);
    return NextResponse.json(
      { error: "Failed to generate personalized feed" },
      { status: 500 }
    );
  }
}
