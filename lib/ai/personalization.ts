/**
 * Semantic personalization scoring engine.
 *
 * Computes user interest profiles from positive/negative signals and scores
 * events based on similarity to user preferences.
 */

import { db } from '@/lib/db';
import { events, userPreferences } from '@/lib/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { cosineSimilarity } from './embedding';
import { findSimilarByEmbedding, type SimilarEvent } from '@/lib/db/similaritySearch';

// Signal types from Phase 1
export type PositiveSignalType = 'favorite' | 'calendar' | 'share' | 'viewSource';

export interface PositiveSignal {
  eventId: string;
  signalType: PositiveSignalType;
  timestamp: string;
  active: boolean;
}

export interface NegativeSignal {
  eventId: string;
  timestamp: string;
  active: boolean;
}

// Time window for active signals (12 months)
const SIGNAL_TIME_WINDOW_MS = 12 * 30 * 24 * 60 * 60 * 1000; // 12 months in milliseconds
const CENTROID_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Filter signals to only include those active within the 12-month window.
 */
function filterActiveSignals<T extends { timestamp: string; active: boolean }>(signals: T[]): T[] {
  const cutoffDate = new Date(Date.now() - SIGNAL_TIME_WINDOW_MS);
  return signals.filter((signal) => signal.active && new Date(signal.timestamp) >= cutoffDate);
}

/**
 * Compute the centroid (average) of embeddings from a list of event IDs.
 * Returns null if no events have embeddings.
 */
export async function computeCentroid(eventIds: string[]): Promise<number[] | null> {
  console.log(`[Personalization] computeCentroid called with ${eventIds.length} event IDs`);

  if (eventIds.length === 0) {
    console.log(`[Personalization] No event IDs provided, returning null`);
    return null;
  }

  // Fetch embeddings for all events
  console.log(`[Personalization] Fetching embeddings for ${eventIds.length} events...`);
  const eventsWithEmbeddings = await db
    .select({
      id: events.id,
      embedding: events.embedding,
    })
    .from(events)
    .where(inArray(events.id, eventIds));
  console.log(`[Personalization] Fetched ${eventsWithEmbeddings.length} events with embeddings`);

  // Filter out events without embeddings
  const validEmbeddings = eventsWithEmbeddings
    .filter((e) => e.embedding !== null)
    .map((e) => e.embedding as number[]);

  if (validEmbeddings.length === 0) {
    return null;
  }

  // Compute average of all embeddings
  const dimensions = validEmbeddings[0].length;
  const centroid = Array.from({ length: dimensions }, () => 0);

  for (const embedding of validEmbeddings) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= validEmbeddings.length;
  }

  console.log(
    `[Personalization] Computed centroid from ${validEmbeddings.length}/${eventIds.length} events with embeddings`
  );

  return centroid;
}

/**
 * Get or compute cached centroids for a user.
 * Uses cached values if they exist and are less than 1 hour old.
 * Otherwise, recomputes from active signals.
 */
export async function getUserCentroids(userId: string): Promise<{
  positive: number[] | null;
  negative: number[] | null;
}> {
  console.log(`[Personalization] getUserCentroids called for user ${userId}`);

  // Fetch user preferences
  console.log(`[Personalization] Fetching user preferences...`);
  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  console.log(`[Personalization] User preferences fetched:`, prefs.length > 0);

  if (prefs.length === 0) {
    console.log(`[Personalization] No preferences found for user ${userId}`);
    return { positive: null, negative: null };
  }

  const userPref = prefs[0];

  // Check if cached centroids are fresh (< 1 hour old)
  const cacheIsFresh =
    userPref.centroidUpdatedAt &&
    Date.now() - userPref.centroidUpdatedAt.getTime() < CENTROID_CACHE_TTL_MS;

  console.log(`[Personalization] Cache check:`, {
    hasCentroidUpdatedAt: !!userPref.centroidUpdatedAt,
    cacheIsFresh,
    hasPositiveCentroid: userPref.positiveCentroid !== null,
    hasNegativeCentroid: userPref.negativeCentroid !== null,
  });

  if (cacheIsFresh && (userPref.positiveCentroid !== null || userPref.negativeCentroid !== null)) {
    console.log(`[Personalization] Using cached centroids for user ${userId}`);
    return {
      positive: userPref.positiveCentroid,
      negative: userPref.negativeCentroid,
    };
  }

  // Recompute centroids from active signals
  console.log(`[Personalization] Recomputing centroids for user ${userId}`);

  const positiveSignals = (userPref.positiveSignals as PositiveSignal[]) ?? [];
  const negativeSignals = (userPref.negativeSignals as NegativeSignal[]) ?? [];

  const activePositiveSignals = filterActiveSignals(positiveSignals);
  const activeNegativeSignals = filterActiveSignals(negativeSignals);

  const positiveEventIds = activePositiveSignals.map((s) => s.eventId);
  const negativeEventIds = activeNegativeSignals.map((s) => s.eventId);

  const [positiveCentroid, negativeCentroid] = await Promise.all([
    computeCentroid(positiveEventIds),
    computeCentroid(negativeEventIds),
  ]);

  // Update cache in database
  await db
    .update(userPreferences)
    .set({
      positiveCentroid: positiveCentroid ? sql`${JSON.stringify(positiveCentroid)}::vector` : null,
      negativeCentroid: negativeCentroid ? sql`${JSON.stringify(negativeCentroid)}::vector` : null,
      centroidUpdatedAt: new Date(),
    })
    .where(eq(userPreferences.userId, userId));

  console.log(
    `[Personalization] Cached centroids for user ${userId}: positive=${positiveCentroid ? 'yes' : 'no'}, negative=${negativeCentroid ? 'yes' : 'no'}`
  );

  return {
    positive: positiveCentroid,
    negative: negativeCentroid,
  };
}

/**
 * Score an event against user centroids.
 *
 * Algorithm:
 * - If no negative centroid: score = similarity to positive centroid
 * - If negative centroid exists: score = positive_sim - negative_sim
 *
 * Returns a score between -1 and 1.
 */
export function scoreEvent(
  eventEmbedding: number[],
  positiveCentroid: number[] | null,
  negativeCentroid: number[] | null
): number {
  if (!positiveCentroid) {
    return 0; // No positive signals = no personalization
  }

  const positiveSim = cosineSimilarity(eventEmbedding, positiveCentroid);

  if (!negativeCentroid) {
    return positiveSim;
  }

  const negativeSim = cosineSimilarity(eventEmbedding, negativeCentroid);
  return positiveSim - negativeSim;
}

/**
 * Get tier based on score.
 *
 * Thresholds:
 * - Great Match: > 0.90
 * - Good Match: > 0.85
 * - Hidden: ≤ 0.85 (not returned in feed)
 */
export function getScoreTier(score: number): 'great' | 'good' | null {
  if (score > 0.9) return 'great';
  if (score > 0.85) return 'good';
  return null;
}

/**
 * Find the nearest liked event for explainability.
 * Compares the target event's embedding to all positive signal embeddings
 * and returns the most similar one.
 */
export async function findNearestLikedEvent(
  eventEmbedding: number[],
  positiveSignals: PositiveSignal[]
): Promise<{ eventId: string; title: string } | null> {
  const activeSignals = filterActiveSignals(positiveSignals);

  if (activeSignals.length === 0) {
    return null;
  }

  const signalEventIds = activeSignals.map((s) => s.eventId);

  // Fetch signal events with embeddings
  const signalEvents = await db
    .select({
      id: events.id,
      title: events.title,
      embedding: events.embedding,
    })
    .from(events)
    .where(inArray(events.id, signalEventIds));

  // Filter out events without embeddings and compute similarities
  const similarities = signalEvents
    .filter((e) => e.embedding !== null)
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      similarity: cosineSimilarity(eventEmbedding, e.embedding as number[]),
    }));

  if (similarities.length === 0) {
    return null;
  }

  // Sort by similarity descending and return the most similar
  similarities.sort((a, b) => b.similarity - a.similarity);

  return {
    eventId: similarities[0].eventId,
    title: similarities[0].title,
  };
}

// ============================================================
// NEW MULTI-ANCHOR PERSONALIZATION ALGORITHM
// ============================================================

/**
 * Source information for why an event was recommended.
 */
export interface MatchSource {
  signalEventId: string;
  signalEventTitle: string;
  similarity: number;
}

/**
 * A candidate event with scoring information.
 */
export interface PersonalizedEvent {
  event: SimilarEvent;
  finalScore: number;
  maxSimilarity: number;
  sources: MatchSource[];
  centroidSimilarity: number | null;
  matchCount: number;
  tier: 'great' | 'good' | null;
  bucket: 'today' | 'tomorrow' | 'week' | 'later';
}

/**
 * Result from the personalized feed algorithm.
 */
export interface PersonalizedFeedResult {
  events: PersonalizedEvent[];
  meta: {
    signalCount: number;
    minimumMet: boolean;
    signalEventsUsed: number;
    candidatesFound: number;
  };
}

// Configuration for the algorithm
const MATCHES_PER_SIGNAL = 15; // Top N matches per liked event
const CENTROID_MATCHES = 10; // Top N matches for centroid
const MIN_SIMILARITY = 0.85; // Minimum similarity threshold
const MULTI_MATCH_BOOST_PER = 0.04; // Boost per additional source
const MULTI_MATCH_BOOST_CAP = 0.12; // Maximum multi-match boost
const CENTROID_BONUS = 0.02; // Bonus if also matched centroid

// Tier thresholds
const TIER_GREAT = 0.9;
const TIER_GOOD = 0.85;
const TIER_HIDDEN = 0.85;

/**
 * Get the time bucket for an event based on its date.
 */
function getEventBucket(eventDate: Date): 'today' | 'tomorrow' | 'week' | 'later' {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

  if (eventDay.getTime() === today.getTime()) return 'today';
  if (eventDay.getTime() === tomorrow.getTime()) return 'tomorrow';
  if (eventDay < nextWeek) return 'week';
  return 'later';
}

/**
 * NEW: Multi-anchor personalized feed algorithm.
 *
 * Instead of just using a centroid (which can get "watered down"),
 * this finds top matches for EACH liked event individually, then
 * aggregates with boosts for events that match multiple interests.
 *
 * Algorithm:
 * 1. Get all positive signal events and their embeddings
 * 2. For each signal event, find top N similar upcoming events
 * 3. Also compute centroid and find its top N matches
 * 4. Aggregate all candidates:
 *    - Base score = max similarity across all sources
 *    - Multi-match boost = bonus for appearing in multiple lists
 *    - Centroid bonus = small bonus if also matched centroid
 * 5. Apply negative signal penalty (if hidden events exist)
 * 6. Sort by final score, return with explanations
 */
export async function getMultiAnchorPersonalizedFeed(
  userId: string,
  options: {
    startDate: Date;
    endDate: Date;
  }
): Promise<PersonalizedFeedResult> {
  console.log(`[PersonalizationV2] Starting multi-anchor feed for user ${userId}`);

  // 1. Fetch user preferences and signals
  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (prefs.length === 0) {
    console.log(`[PersonalizationV2] No preferences found`);
    return {
      events: [],
      meta: { signalCount: 0, minimumMet: false, signalEventsUsed: 0, candidatesFound: 0 },
    };
  }

  const userPref = prefs[0];
  const positiveSignals = filterActiveSignals((userPref.positiveSignals as PositiveSignal[]) ?? []);
  const negativeSignals = filterActiveSignals((userPref.negativeSignals as NegativeSignal[]) ?? []);
  const signalCount = positiveSignals.length + negativeSignals.length;

  console.log(
    `[PersonalizationV2] Found ${positiveSignals.length} positive, ${negativeSignals.length} negative signals`
  );

  if (positiveSignals.length === 0) {
    console.log(`[PersonalizationV2] No positive signals, returning empty`);
    return {
      events: [],
      meta: { signalCount, minimumMet: signalCount >= 5, signalEventsUsed: 0, candidatesFound: 0 },
    };
  }

  // 2. Get embeddings for all signal events
  const signalEventIds = positiveSignals.map((s) => s.eventId);
  const signalEvents = await db
    .select({
      id: events.id,
      title: events.title,
      embedding: events.embedding,
    })
    .from(events)
    .where(inArray(events.id, signalEventIds));

  const signalEventsWithEmbeddings = signalEvents.filter((e) => e.embedding !== null);
  console.log(
    `[PersonalizationV2] ${signalEventsWithEmbeddings.length}/${signalEvents.length} signal events have embeddings`
  );

  if (signalEventsWithEmbeddings.length === 0) {
    console.log(`[PersonalizationV2] No signal events with embeddings`);
    return {
      events: [],
      meta: { signalCount, minimumMet: signalCount >= 5, signalEventsUsed: 0, candidatesFound: 0 },
    };
  }

  // 3. Build candidate map: eventId -> candidate info
  const candidateMap = new Map<
    string,
    {
      event: SimilarEvent;
      sources: MatchSource[];
      maxSimilarity: number;
      centroidSimilarity: number | null;
    }
  >();

  // 4. For each signal event, find top N similar upcoming events
  console.log(
    `[PersonalizationV2] Finding matches for ${signalEventsWithEmbeddings.length} signal events...`
  );

  for (const signalEvent of signalEventsWithEmbeddings) {
    const embedding = signalEvent.embedding as number[];

    const matches = await findSimilarByEmbedding(embedding, {
      limit: MATCHES_PER_SIGNAL,
      minSimilarity: MIN_SIMILARITY,
      excludeIds: signalEventIds, // Don't recommend events user already interacted with
      startDate: options.startDate,
      endDate: options.endDate,
    });

    console.log(
      `[PersonalizationV2] Signal "${signalEvent.title.substring(0, 30)}..." -> ${matches.length} matches`
    );

    for (const match of matches) {
      if (!candidateMap.has(match.id)) {
        candidateMap.set(match.id, {
          event: match,
          sources: [],
          maxSimilarity: 0,
          centroidSimilarity: null,
        });
      }

      const candidate = candidateMap.get(match.id)!;
      candidate.sources.push({
        signalEventId: signalEvent.id,
        signalEventTitle: signalEvent.title,
        similarity: match.similarity,
      });
      candidate.maxSimilarity = Math.max(candidate.maxSimilarity, match.similarity);
    }
  }

  console.log(
    `[PersonalizationV2] Found ${candidateMap.size} unique candidates from individual signals`
  );

  // 5. Compute centroid and find its matches
  const embeddings = signalEventsWithEmbeddings.map((e) => e.embedding as number[]);
  const centroid = computeCentroidFromEmbeddings(embeddings);

  if (centroid) {
    console.log(`[PersonalizationV2] Finding centroid matches...`);
    const centroidMatches = await findSimilarByEmbedding(centroid, {
      limit: CENTROID_MATCHES,
      minSimilarity: MIN_SIMILARITY,
      excludeIds: signalEventIds,
      startDate: options.startDate,
      endDate: options.endDate,
    });

    console.log(`[PersonalizationV2] Centroid -> ${centroidMatches.length} matches`);

    for (const match of centroidMatches) {
      if (!candidateMap.has(match.id)) {
        // Event only matched centroid, not any individual signal
        candidateMap.set(match.id, {
          event: match,
          sources: [],
          maxSimilarity: match.similarity,
          centroidSimilarity: match.similarity,
        });
      } else {
        // Event matched both individual signals AND centroid
        candidateMap.get(match.id)!.centroidSimilarity = match.similarity;
      }
    }
  }

  console.log(`[PersonalizationV2] Total unique candidates: ${candidateMap.size}`);

  // 6. Get negative centroid for penalty (if user has hidden events)
  let negativeCentroid: number[] | null = null;
  if (negativeSignals.length > 0) {
    const negativeEventIds = negativeSignals.map((s) => s.eventId);
    const negativeEvents = await db
      .select({ embedding: events.embedding })
      .from(events)
      .where(inArray(events.id, negativeEventIds));

    const negativeEmbeddings = negativeEvents
      .filter((e) => e.embedding !== null)
      .map((e) => e.embedding as number[]);

    if (negativeEmbeddings.length > 0) {
      negativeCentroid = computeCentroidFromEmbeddings(negativeEmbeddings);
      console.log(
        `[PersonalizationV2] Computed negative centroid from ${negativeEmbeddings.length} hidden events`
      );
    }
  }

  // 7. Calculate final scores with boosts and penalties
  const results: PersonalizedEvent[] = [];

  for (const [, candidate] of candidateMap) {
    const numSources = candidate.sources.length;
    const hasCentroidMatch = candidate.centroidSimilarity !== null;
    const hasIndividualMatch = numSources > 0;

    // Base score: max similarity from any source
    let baseScore = candidate.maxSimilarity;

    // If only centroid matched (no individual signals), use centroid similarity
    if (!hasIndividualMatch && hasCentroidMatch) {
      baseScore = candidate.centroidSimilarity!;
    }

    // Multi-match boost: reward events that match multiple interests
    const multiMatchBoost = hasIndividualMatch
      ? Math.min(MULTI_MATCH_BOOST_CAP, (numSources - 1) * MULTI_MATCH_BOOST_PER)
      : 0;

    // Centroid bonus: small reward if matched both individual AND centroid
    const centroidBonus = hasIndividualMatch && hasCentroidMatch ? CENTROID_BONUS : 0;

    // Negative penalty: penalize if similar to hidden events
    const negativePenalty = 0;
    if (negativeCentroid && candidate.event.similarity) {
      // We need the event's embedding to compute similarity to negative centroid
      // For now, we'll skip this and just use the candidates as-is
      // A future enhancement could fetch embeddings for final scoring
    }

    const finalScore = baseScore + multiMatchBoost + centroidBonus - negativePenalty;

    // Determine tier
    let tier: 'great' | 'good' | null = null;
    if (finalScore >= TIER_GREAT) tier = 'great';
    else if (finalScore >= TIER_GOOD) tier = 'good';

    // Skip if below hidden threshold
    if (finalScore < TIER_HIDDEN) continue;

    // Determine time bucket
    const bucket = getEventBucket(candidate.event.startDate);

    results.push({
      event: candidate.event,
      finalScore,
      maxSimilarity: candidate.maxSimilarity,
      sources: candidate.sources,
      centroidSimilarity: candidate.centroidSimilarity,
      matchCount: numSources + (hasCentroidMatch ? 1 : 0),
      tier,
      bucket,
    });
  }

  // 8. Sort by final score (descending)
  results.sort((a, b) => b.finalScore - a.finalScore);

  console.log(`[PersonalizationV2] Returning ${results.length} personalized events`);
  console.log(
    `[PersonalizationV2] Tier breakdown: ${results.filter((e) => e.tier === 'great').length} great, ${results.filter((e) => e.tier === 'good').length} good, ${results.filter((e) => e.tier === null).length} okay`
  );

  return {
    events: results,
    meta: {
      signalCount,
      minimumMet: signalCount >= 5,
      signalEventsUsed: signalEventsWithEmbeddings.length,
      candidatesFound: candidateMap.size,
    },
  };
}

/**
 * Compute centroid from a list of embeddings directly.
 * (Helper that doesn't need to fetch from DB)
 */
function computeCentroidFromEmbeddings(embeddings: number[][]): number[] | null {
  if (embeddings.length === 0) return null;

  const dimensions = embeddings[0].length;
  const centroid = Array.from({ length: dimensions }, () => 0);

  for (const embedding of embeddings) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= embeddings.length;
  }

  return centroid;
}
