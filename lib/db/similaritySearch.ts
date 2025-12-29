/**
 * Vector similarity search functions using pgvector.
 *
 * Provides semantic search and "similar events" functionality
 * using cosine similarity on event embeddings.
 */

import { cosineDistance, desc, asc, gt, sql, ne, and, isNotNull, gte, lte } from 'drizzle-orm';
import { db } from './index';
import { events } from './schema';
import { generateQueryEmbedding } from '../ai/embedding';

export interface SimilarEvent {
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
  similarity: number;
}

export interface SimilaritySearchOptions {
  limit?: number;
  minSimilarity?: number;
  excludeIds?: string[];
  futureOnly?: boolean;
  orderBy?: 'similarity' | 'date';
}

/**
 * Find events similar to a given event by its ID.
 * Uses vector cosine similarity on embeddings.
 */
export async function findSimilarEvents(
  eventId: string,
  options: SimilaritySearchOptions = {}
): Promise<SimilarEvent[]> {
  const { limit = 5, minSimilarity = 0.5, excludeIds = [], futureOnly = true, orderBy = 'similarity' } = options;

  // Get the source event's embedding
  const sourceEvent = await db
    .select({ embedding: events.embedding })
    .from(events)
    .where(sql`${events.id} = ${eventId}`)
    .limit(1);

  if (!sourceEvent.length || !sourceEvent[0].embedding) {
    console.warn(`[SimilaritySearch] Event ${eventId} has no embedding`);
    return [];
  }

  const embedding = sourceEvent[0].embedding;

  // Calculate similarity score (1 - cosine distance)
  const similarity = sql<number>`1 - (${cosineDistance(events.embedding, embedding)})`;

  // Build conditions
  const conditions = [
    ne(events.id, eventId), // Exclude source event
    isNotNull(events.embedding), // Only events with embeddings
    gt(similarity, minSimilarity), // Minimum similarity threshold
  ];

  // Exclude specific IDs
  if (excludeIds.length > 0) {
    for (const id of excludeIds) {
      conditions.push(ne(events.id, id));
    }
  }

  // Only future events
  if (futureOnly) {
    conditions.push(gte(events.startDate, new Date()));
  }

  const results = await db
    .select({
      id: events.id,
      sourceId: events.sourceId,
      source: events.source,
      title: events.title,
      description: events.description,
      startDate: events.startDate,
      location: events.location,
      organizer: events.organizer,
      price: events.price,
      url: events.url,
      imageUrl: events.imageUrl,
      tags: events.tags,
      timeUnknown: events.timeUnknown,
      recurringType: events.recurringType,
      favoriteCount: events.favoriteCount,
      aiSummary: events.aiSummary,
      similarity,
    })
    .from(events)
    .where(and(...conditions))
    .orderBy(orderBy === 'date' ? asc(events.startDate) : desc(similarity))
    .limit(limit);

  return results as SimilarEvent[];
}

/**
 * Search events by semantic meaning using a text query.
 * Converts the query to an embedding and finds similar events.
 */
export async function semanticSearchEvents(
  query: string,
  options: SimilaritySearchOptions = {}
): Promise<SimilarEvent[]> {
  const { limit = 10, minSimilarity = 0.4, excludeIds = [], futureOnly = true } = options;

  // Generate embedding for the search query
  const queryEmbedding = await generateQueryEmbedding(query);
  if (!queryEmbedding) {
    console.warn('[SimilaritySearch] Failed to generate query embedding');
    return [];
  }

  // Calculate similarity score
  const similarity = sql<number>`1 - (${cosineDistance(events.embedding, queryEmbedding)})`;

  // Build conditions
  const conditions = [
    isNotNull(events.embedding),
    gt(similarity, minSimilarity),
  ];

  // Exclude specific IDs
  if (excludeIds.length > 0) {
    for (const id of excludeIds) {
      conditions.push(ne(events.id, id));
    }
  }

  // Only future events
  if (futureOnly) {
    conditions.push(gte(events.startDate, new Date()));
  }

  const results = await db
    .select({
      id: events.id,
      sourceId: events.sourceId,
      source: events.source,
      title: events.title,
      description: events.description,
      startDate: events.startDate,
      location: events.location,
      organizer: events.organizer,
      price: events.price,
      url: events.url,
      imageUrl: events.imageUrl,
      tags: events.tags,
      timeUnknown: events.timeUnknown,
      recurringType: events.recurringType,
      favoriteCount: events.favoriteCount,
      aiSummary: events.aiSummary,
      similarity,
    })
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(limit);

  return results as SimilarEvent[];
}

/**
 * Find events similar to a given embedding vector.
 * Used for personalization when we already have the embedding.
 */
export async function findSimilarByEmbedding(
  embedding: number[],
  options: SimilaritySearchOptions & {
    startDate?: Date;
    endDate?: Date;
  } = {}
): Promise<SimilarEvent[]> {
  const {
    limit = 10,
    minSimilarity = 0.4,
    excludeIds = [],
    startDate,
    endDate,
  } = options;

  // Calculate similarity score (1 - cosine distance)
  const similarity = sql<number>`1 - (${cosineDistance(events.embedding, embedding)})`;

  // Build conditions
  const conditions = [
    isNotNull(events.embedding),
    gt(similarity, minSimilarity),
  ];

  // Exclude specific IDs
  for (const id of excludeIds) {
    conditions.push(ne(events.id, id));
  }

  // Date range filtering
  if (startDate) {
    conditions.push(gte(events.startDate, startDate));
  }
  if (endDate) {
    conditions.push(lte(events.startDate, endDate));
  }

  const results = await db
    .select({
      id: events.id,
      sourceId: events.sourceId,
      source: events.source,
      title: events.title,
      description: events.description,
      startDate: events.startDate,
      location: events.location,
      organizer: events.organizer,
      price: events.price,
      url: events.url,
      imageUrl: events.imageUrl,
      tags: events.tags,
      timeUnknown: events.timeUnknown,
      recurringType: events.recurringType,
      favoriteCount: events.favoriteCount,
      aiSummary: events.aiSummary,
      similarity,
    })
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(limit);

  return results as SimilarEvent[];
}

/**
 * Get events with embeddings count for stats.
 */
export async function getEmbeddingStats(): Promise<{
  total: number;
  withEmbedding: number;
  withSummary: number;
}> {
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events);

  const [withEmbeddingResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(isNotNull(events.embedding));

  const [withSummaryResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(isNotNull(events.aiSummary));

  return {
    total: Number(totalResult.count),
    withEmbedding: Number(withEmbeddingResult.count),
    withSummary: Number(withSummaryResult.count),
  };
}
