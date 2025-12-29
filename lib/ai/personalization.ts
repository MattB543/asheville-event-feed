/**
 * Semantic personalization scoring engine.
 *
 * Computes user interest profiles from positive/negative signals and scores
 * events based on similarity to user preferences.
 */

import { db } from "@/lib/db";
import { events, userPreferences } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { cosineSimilarity } from "./embedding";

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
function filterActiveSignals<T extends { timestamp: string; active: boolean }>(
  signals: T[]
): T[] {
  const cutoffDate = new Date(Date.now() - SIGNAL_TIME_WINDOW_MS);
  return signals.filter(
    signal => signal.active && new Date(signal.timestamp) >= cutoffDate
  );
}

/**
 * Compute the centroid (average) of embeddings from a list of event IDs.
 * Returns null if no events have embeddings.
 */
export async function computeCentroid(eventIds: string[]): Promise<number[] | null> {
  if (eventIds.length === 0) {
    return null;
  }

  // Fetch embeddings for all events
  const eventsWithEmbeddings = await db
    .select({
      id: events.id,
      embedding: events.embedding,
    })
    .from(events)
    .where(inArray(events.id, eventIds));

  // Filter out events without embeddings
  const validEmbeddings = eventsWithEmbeddings
    .filter(e => e.embedding !== null)
    .map(e => e.embedding as number[]);

  if (validEmbeddings.length === 0) {
    return null;
  }

  // Compute average of all embeddings
  const dimensions = validEmbeddings[0].length;
  const centroid = new Array(dimensions).fill(0);

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
  // Fetch user preferences
  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (prefs.length === 0) {
    console.log(`[Personalization] No preferences found for user ${userId}`);
    return { positive: null, negative: null };
  }

  const userPref = prefs[0];

  // Check if cached centroids are fresh (< 1 hour old)
  const cacheIsFresh =
    userPref.centroidUpdatedAt &&
    Date.now() - userPref.centroidUpdatedAt.getTime() < CENTROID_CACHE_TTL_MS;

  if (
    cacheIsFresh &&
    (userPref.positiveCentroid !== null || userPref.negativeCentroid !== null)
  ) {
    console.log(`[Personalization] Using cached centroids for user ${userId}`);
    return {
      positive: userPref.positiveCentroid as number[] | null,
      negative: userPref.negativeCentroid as number[] | null,
    };
  }

  // Recompute centroids from active signals
  console.log(`[Personalization] Recomputing centroids for user ${userId}`);

  const positiveSignals = (userPref.positiveSignals as PositiveSignal[]) ?? [];
  const negativeSignals = (userPref.negativeSignals as NegativeSignal[]) ?? [];

  const activePositiveSignals = filterActiveSignals(positiveSignals);
  const activeNegativeSignals = filterActiveSignals(negativeSignals);

  const positiveEventIds = activePositiveSignals.map(s => s.eventId);
  const negativeEventIds = activeNegativeSignals.map(s => s.eventId);

  const [positiveCentroid, negativeCentroid] = await Promise.all([
    computeCentroid(positiveEventIds),
    computeCentroid(negativeEventIds),
  ]);

  // Update cache in database
  await db
    .update(userPreferences)
    .set({
      positiveCentroid: positiveCentroid
        ? sql`${JSON.stringify(positiveCentroid)}::vector`
        : null,
      negativeCentroid: negativeCentroid
        ? sql`${JSON.stringify(negativeCentroid)}::vector`
        : null,
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
 * Thresholds from spec:
 * - Great Match: > 0.7
 * - Good Match: > 0.5
 * - Okay: > 0.3
 * - Hidden: ≤ 0.3 (not returned in feed)
 */
export function getScoreTier(score: number): 'great' | 'good' | null {
  if (score > 0.7) return 'great';
  if (score > 0.5) return 'good';
  return null; // 'okay' tier gets no visual treatment
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

  const signalEventIds = activeSignals.map(s => s.eventId);

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
    .filter(e => e.embedding !== null)
    .map(e => ({
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
