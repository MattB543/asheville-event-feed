import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { sql, type InferSelectModel } from 'drizzle-orm';
import { findSimilarEvents } from '@/lib/db/similaritySearch';

export type DbEvent = InferSelectModel<typeof events>;

export interface SimilarEvent {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description: string | null;
  aiSummary: string | null;
  startDate: string;
  location: string | null;
  organizer: string | null;
  price: string | null;
  url: string;
  imageUrl: string | null;
  tags: string[] | null;
  timeUnknown: boolean;
  recurringType: string | null;
  favoriteCount: number;
  similarity: number;
}

export interface SerializedEvent {
  id: string;
  sourceId: string;
  title: string;
  description: string | null;
  aiSummary: string | null;
  startDate: string;
  location: string | null;
  organizer: string | null;
  price: string | null;
  imageUrl: string | null;
  url: string;
  tags: string[] | null;
  source: string;
  timeUnknown: boolean;
  favoriteCount: number;
}

/**
 * Fetch event by short ID (first 6 chars of UUID)
 */
export async function getEventByShortId(shortId: string): Promise<DbEvent | null> {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const result = await db
    .select()
    .from(events)
    .where(sql`${events.id}::text LIKE ${shortId + '%'}`)
    .limit(1);

  return result[0] || null;
}

/**
 * Fetch similar events for a given event ID
 */
export async function getSimilarEvents(eventId: string): Promise<SimilarEvent[]> {
  try {
    // Fetch extra events to allow for recurring event deduplication on client
    const similar = await findSimilarEvents(eventId, {
      limit: 50,
      futureOnly: true,
      orderBy: 'similarity',
    });
    return similar.map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      source: e.source,
      title: e.title,
      description: e.description,
      aiSummary: e.aiSummary,
      startDate: e.startDate.toISOString(),
      location: e.location,
      organizer: e.organizer,
      price: e.price,
      url: e.url,
      imageUrl: e.imageUrl,
      tags: e.tags,
      timeUnknown: e.timeUnknown || false,
      recurringType: e.recurringType,
      favoriteCount: e.favoriteCount || 0,
      similarity: e.similarity,
    }));
  } catch {
    // Silently fail if similarity search fails (e.g., no embedding)
    return [];
  }
}

/**
 * Serialize a database event for client component props
 */
export function serializeEvent(event: DbEvent): SerializedEvent {
  return {
    id: event.id,
    sourceId: event.sourceId,
    title: event.title,
    description: event.description,
    aiSummary: event.aiSummary,
    startDate: event.startDate.toISOString(),
    location: event.location,
    organizer: event.organizer,
    price: event.price,
    imageUrl: event.imageUrl,
    url: event.url,
    tags: event.tags,
    source: event.source,
    timeUnknown: event.timeUnknown || false,
    favoriteCount: event.favoriteCount || 0,
  };
}
