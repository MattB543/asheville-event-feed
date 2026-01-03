import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMultiAnchorPersonalizedFeed, type PersonalizedEvent } from '@/lib/ai/personalization';
import {
  getStartOfTodayEastern,
  getDayBoundariesEastern,
  getTodayStringEastern,
} from '@/lib/utils/timezone';

// Helper to add days to a date string (YYYY-MM-DD format)
function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Response format (compatible with frontend)
interface ScoredEventResponse {
  event: {
    id: string;
    sourceId: string;
    source: string;
    title: string;
    description: string | null;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    price: string | null;
    url: string;
    imageUrl: string | null;
    tags: string[] | null;
    timeUnknown: boolean | null;
    recurringType: string | null;
    favoriteCount: number | null;
    aiSummary: string | null;
  };
  score: number;
  tier: 'great' | 'good' | null;
  explanation: {
    primary: { eventId: string; title: string } | null;
  };
  bucket: 'today' | 'tomorrow' | 'week' | 'later';
  // New fields from multi-anchor algorithm
  matchCount?: number;
  sources?: Array<{ signalEventId: string; signalEventTitle: string; similarity: number }>;
}

/**
 * Convert PersonalizedEvent to frontend-compatible format.
 */
function toResponseFormat(pe: PersonalizedEvent): ScoredEventResponse {
  // Get the best explanation from sources (highest similarity)
  const bestSource =
    pe.sources.length > 0
      ? pe.sources.reduce((best, curr) => (curr.similarity > best.similarity ? curr : best))
      : null;

  return {
    event: {
      id: pe.event.id,
      sourceId: pe.event.sourceId,
      source: pe.event.source,
      title: pe.event.title,
      description: pe.event.description,
      startDate: pe.event.startDate,
      location: pe.event.location,
      organizer: pe.event.organizer,
      price: pe.event.price,
      url: pe.event.url,
      imageUrl: pe.event.imageUrl,
      tags: pe.event.tags,
      timeUnknown: pe.event.timeUnknown,
      recurringType: pe.event.recurringType,
      favoriteCount: pe.event.favoriteCount,
      aiSummary: pe.event.aiSummary,
    },
    score: pe.finalScore,
    tier: pe.tier,
    explanation: {
      primary: bestSource
        ? { eventId: bestSource.signalEventId, title: bestSource.signalEventTitle }
        : null,
    },
    bucket: pe.bucket,
    matchCount: pe.matchCount,
    sources: pe.sources,
  };
}

/**
 * GET /api/for-you
 *
 * Returns personalized event feed using multi-anchor algorithm.
 * Instead of just using a centroid (which can get "watered down"),
 * this finds top matches for EACH liked event individually, then
 * aggregates with boosts for events that match multiple interests.
 */
export async function GET() {
  try {
    console.log('[ForYou API] Request received (V2 multi-anchor algorithm)');

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log('[ForYou API] User:', user?.id ?? 'none');

    if (!user) {
      console.log('[ForYou API] Unauthorized - no user');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Calculate date range (next 14 days)
    const todayStr = getTodayStringEastern();
    const startOfToday = getStartOfTodayEastern();
    const fourteenDaysFromNowStr = addDaysToDateString(todayStr, 14);
    const fourteenDaysFromNow = getDayBoundariesEastern(fourteenDaysFromNowStr).end;

    console.log('[ForYou API] Date range:', {
      start: startOfToday.toISOString(),
      end: fourteenDaysFromNow.toISOString(),
    });

    // Call the new multi-anchor personalization algorithm
    const result = await getMultiAnchorPersonalizedFeed(user.id, {
      startDate: startOfToday,
      endDate: fourteenDaysFromNow,
    });

    console.log('[ForYou API] Algorithm result:', {
      eventCount: result.events.length,
      signalCount: result.meta.signalCount,
      signalEventsUsed: result.meta.signalEventsUsed,
      candidatesFound: result.meta.candidatesFound,
    });

    // Convert to response format
    const scoredEvents = result.events.map(toResponseFormat);

    // Sort by bucket priority, then by score within bucket
    const bucketOrder: Record<string, number> = {
      today: 0,
      tomorrow: 1,
      week: 2,
      later: 3,
    };

    scoredEvents.sort((a, b) => {
      const bucketDiff = bucketOrder[a.bucket] - bucketOrder[b.bucket];
      if (bucketDiff !== 0) return bucketDiff;
      return b.score - a.score;
    });

    console.log(`[ForYou API] Returning ${scoredEvents.length} personalized events`);

    // Log tier breakdown for debugging
    const tierCounts = {
      great: scoredEvents.filter((e) => e.tier === 'great').length,
      good: scoredEvents.filter((e) => e.tier === 'good').length,
      okay: scoredEvents.filter((e) => e.tier === null).length,
    };
    console.log('[ForYou API] Tier breakdown:', tierCounts);

    // Log multi-match events (events that matched multiple liked events)
    const multiMatchEvents = scoredEvents.filter((e) => (e.matchCount ?? 0) > 1);
    if (multiMatchEvents.length > 0) {
      console.log(`[ForYou API] ${multiMatchEvents.length} events matched multiple interests:`);
      for (const e of multiMatchEvents.slice(0, 5)) {
        console.log(`  - "${e.event.title.substring(0, 40)}..." matched ${e.matchCount} interests`);
      }
    }

    return NextResponse.json({
      events: scoredEvents,
      meta: {
        signalCount: result.meta.signalCount,
        minimumMet: result.meta.minimumMet,
        // New metadata from V2 algorithm
        signalEventsUsed: result.meta.signalEventsUsed,
        candidatesFound: result.meta.candidatesFound,
      },
    });
  } catch (error) {
    console.error('[ForYou API] Error generating personalized feed:', error);
    return NextResponse.json({ error: 'Failed to generate personalized feed' }, { status: 500 });
  }
}
