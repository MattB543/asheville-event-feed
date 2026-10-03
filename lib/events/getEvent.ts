import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { sql, type InferSelectModel } from 'drizzle-orm';
import { findSimilarEvents } from '@/lib/db/similaritySearch';
import { cleanTitle, generateEventSlug, parseEventSlug } from '@/lib/utils/slugify';

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
  // Score fields for admin/verified curator display
  score: number | null;
  scoreRarity: number | null;
  scoreUnique: number | null;
  scoreMagnitude: number | null;
  scoreReason: string | null;
  scoreOverride: Record<string, unknown> | null; // ScoreOverride type from scoreCalculation.ts
}

/**
 * Fetch the event an /events/[slug] URL names.
 *
 * The slug ends in the first 6 hex chars of the UUID, which is not unique: with ~40k
 * rows dozens of prefixes are shared, and taking any one row served the wrong event
 * (in Oct 2026 the Luna show's page rendered a bike class). So every row with the
 * prefix is read and the full slug picks between them: an exact match, then the same
 * title (a rolling event's date moves, and its slug with it), then the oldest row,
 * which is the one any link made before the collision pointed at.
 */
export async function getEventBySlug(slug: string): Promise<DbEvent | null> {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const parsed = parseEventSlug(slug);
  if (!parsed) {
    return null;
  }

  const hex = parsed.shortId.toLowerCase();

  // Range-scan the uuid primary key; `id::text LIKE` would force a full
  // table scan on every event page load
  const lower = `${hex}00-0000-0000-0000-000000000000`;
  const upper = `${hex}ff-ffff-ffff-ffff-ffffffffffff`;

  const candidates = await db
    .select()
    .from(events)
    .where(
      // Hidden events 404 here as they do everywhere else. This is the takedown
      // path for a denied poster, so the page must not keep serving its text.
      sql`${events.id} >= ${lower}::uuid AND ${events.id} <= ${upper}::uuid AND ${events.hidden} IS NOT TRUE`
    )
    .orderBy(events.createdAt);

  if (candidates.length <= 1) {
    return candidates[0] || null;
  }

  const requested = slug.toLowerCase();
  // Everything before "-YYYY-MM-DD-xxxxxx"
  const requestedTitle = requested.slice(0, -18);
  return (
    candidates.find((e) => generateEventSlug(e.title, e.startDate, e.id) === requested) ??
    candidates.find((e) => cleanTitle(e.title) === requestedTitle) ??
    candidates[0]
  );
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
    // Score fields
    score: event.score,
    scoreRarity: event.scoreRarity,
    scoreUnique: event.scoreUnique,
    scoreMagnitude: event.scoreMagnitude,
    scoreReason: event.scoreReason,
    scoreOverride: event.scoreOverride as Record<string, unknown> | null,
  };
}
