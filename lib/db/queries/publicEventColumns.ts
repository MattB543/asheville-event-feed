import { events } from '@/lib/db/schema';

/**
 * Minimal column map for public (unauthenticated) event responses.
 *
 * Deliberately excludes the 1536-dim `embedding` vector and the internal
 * moderation/bookkeeping columns (`hidden`, `lastVerifiedAt`, `dedupedAt`,
 * `dedupSkip`, `scoreOverride`) so public endpoints never serialize them.
 * Routes still need to filter on those columns in SQL — just don't return them.
 */
export const publicEventColumns = {
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
  aiSummary: events.aiSummary,
  interestedCount: events.interestedCount,
  goingCount: events.goingCount,
  favoriteCount: events.favoriteCount,
  timeUnknown: events.timeUnknown,
  recurringType: events.recurringType,
  recurringEndDate: events.recurringEndDate,
  score: events.score,
  scoreRarity: events.scoreRarity,
  scoreUnique: events.scoreUnique,
  scoreMagnitude: events.scoreMagnitude,
  scoreReason: events.scoreReason,
  scoreAshevilleWeird: events.scoreAshevilleWeird,
  scoreSocial: events.scoreSocial,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
  lastSeenAt: events.lastSeenAt,
};
