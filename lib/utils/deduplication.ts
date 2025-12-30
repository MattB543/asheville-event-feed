/**
 * Event deduplication utility.
 *
 * Duplicates are identified when ANY of:
 * A) Same organizer + Same start time + Share at least 2 significant words in title
 * B) Exact same title + Same start time + Descriptions share 10+ significant words
 *    (catches same event posted by different sources with different organizer names)
 * C) Same start time + Titles share N+ consecutive significant words in the same order
 *    (N depends on title length: 2 for short, 3 for medium, 4 for long titles)
 * D) Same venue (from location/organizer) + Same date + Share 2+ significant title words
 *    (catches cross-source duplicates where organizer differs but venue is same)
 * E) Known venue + Same date + Any title word overlap
 *    (catches venue-specific events across sources with different naming)
 *
 * When duplicates are found:
 * 1. Keep the event with a known price (not "Unknown")
 * 2. If tie, keep the one with longer description
 * 3. If still tie, keep the newer one (by createdAt)
 * 4. Merge the longer description from any removed event into the kept event
 *    (so we always preserve the best description regardless of which event wins)
 */

import { getVenueForEvent, isKnownVenue } from './venues';

interface EventForDedup {
  id: string;
  title: string;
  organizer: string | null;
  location?: string | null;
  startDate: Date;
  price: string | null;
  description: string | null;
  createdAt: Date | null;
}

interface PreparedEventForDedup extends EventForDedup {
  index: number;
  dateKey: string;
  timeKey: string;
  normOrganizer: string;
  normTitle: string;
  titleWordsOrdered: string[];
  titleWordSet: Set<string>;
  venueKey: string | null;
  knownVenue: boolean;
  descriptionWordSet?: Set<string>;
}

const EMPTY_WORD_SET = new Set<string>();

// Words to ignore when comparing titles (common words)
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'it', 'its', "it's", 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once',
  '-', '&', '+', '@',
  // Common event-related words that don't distinguish events
  'event', 'events', 'night', 'live', 'show', 'presents', 'featuring',
  'asheville', 'avl', 'wnc',
]);

/**
 * Extract significant words from a title
 */
function extractWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')  // Remove punctuation except hyphens
    .split(/\s+/)
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word));

  return new Set(words);
}

/**
 * Count how many significant words two titles share
 */
function countSharedTitleWordsFromSets(words1: Set<string>, words2: Set<string>): number {
  if (words1.size === 0 || words2.size === 0) return 0;

  const [small, large] = words1.size <= words2.size ? [words1, words2] : [words2, words1];
  let count = 0;
  for (const word of small) {
    if (large.has(word)) count++;
  }
  return count;
}

/**
 * Extract significant words from a title as an ordered array (preserving order)
 */
function extractWordsOrdered(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Get the minimum consecutive words required based on title lengths.
 * Shorter titles require fewer consecutive words.
 */
function getMinConsecutiveWordsFromLengths(len1: number, len2: number): number {
  const minLength = Math.min(len1, len2);

  if (minLength <= 2) return 2;  // Short titles: require 2 consecutive
  if (minLength <= 4) return 3;  // Medium titles: require 3 consecutive
  return 4;                       // Long titles: require 4 consecutive
}

/**
 * Check if two titles share at least N consecutive significant words in the same order.
 * Uses longest common subsequence approach to find shared word sequences.
 */
function titlesShareOrderedWordsPrepared(
  words1: string[],
  words2: string[],
  minWords?: number
): boolean {
  const required = minWords ?? getMinConsecutiveWordsFromLengths(words1.length, words2.length);

  if (words1.length < required || words2.length < required) {
    return false;
  }

  // Find longest common subsequence of consecutive words
  let maxConsecutive = 0;

  for (let i = 0; i < words1.length; i++) {
    for (let j = 0; j < words2.length; j++) {
      if (words1[i] === words2[j]) {
        // Count consecutive matches starting from this position
        let consecutive = 1;
        let k = 1;
        while (i + k < words1.length && j + k < words2.length && words1[i + k] === words2[j + k]) {
          consecutive++;
          k++;
        }
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      }
    }
  }

  return maxConsecutive >= required;
}

/**
 * Normalize title for exact comparison (case-insensitive, trimmed)
 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}

/**
 * Count how many significant words two descriptions share
 */
function getDescriptionWordSet(event: PreparedEventForDedup): Set<string> {
  if (event.descriptionWordSet) return event.descriptionWordSet;
  if (!event.description) {
    event.descriptionWordSet = EMPTY_WORD_SET;
    return EMPTY_WORD_SET;
  }
  event.descriptionWordSet = extractWords(event.description);
  return event.descriptionWordSet;
}

function countSharedDescriptionWordsPrepared(
  event1: PreparedEventForDedup,
  event2: PreparedEventForDedup
): number {
  const words1 = getDescriptionWordSet(event1);
  const words2 = getDescriptionWordSet(event2);
  if (words1.size === 0 || words2.size === 0) return 0;

  const [small, large] = words1.size <= words2.size ? [words1, words2] : [words2, words1];
  let count = 0;
  for (const word of small) {
    if (large.has(word)) count++;
  }
  return count;
}

/**
 * Normalize organizer name for comparison
 */
function normalizeOrganizer(organizer: string | null): string {
  if (!organizer) return '';
  return organizer
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if event has a known price
 */
function hasKnownPrice(price: string | null): boolean {
  return price !== null && price !== 'Unknown';
}

/**
 * Choose which event to keep between two duplicates.
 * Returns the event to KEEP.
 */
function chooseEventToKeep(event1: EventForDedup, event2: EventForDedup): EventForDedup {
  const e1HasPrice = hasKnownPrice(event1.price);
  const e2HasPrice = hasKnownPrice(event2.price);

  // 1. Prefer the one with a price
  if (e1HasPrice && !e2HasPrice) return event1;
  if (e2HasPrice && !e1HasPrice) return event2;

  // 2. Prefer longer description
  const desc1Len = event1.description?.length || 0;
  const desc2Len = event2.description?.length || 0;

  if (desc1Len > desc2Len) return event1;
  if (desc2Len > desc1Len) return event2;

  // 3. Prefer newer (more recent createdAt)
  const date1 = event1.createdAt?.getTime() || 0;
  const date2 = event2.createdAt?.getTime() || 0;
  return date1 >= date2 ? event1 : event2;
}

export interface DuplicateGroup {
  keep: EventForDedup;
  remove: EventForDedup[];
  method: string; // Which method detected this duplicate (for debugging)
  descriptionUpdate?: string; // Longer description from a removed event to merge into keep
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function getDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function getTimeKey(date: Date): string {
  return `${getDateKey(date)}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function prepareEvents(events: EventForDedup[]): PreparedEventForDedup[] {
  return events.map((event, index) => {
    const titleWordsOrdered = extractWordsOrdered(event.title);
    const titleWordSet = new Set(titleWordsOrdered);
    const venueKey = getVenueForEvent(event.organizer, event.location);

    return {
      ...event,
      index,
      dateKey: getDateKey(event.startDate),
      timeKey: getTimeKey(event.startDate),
      normOrganizer: normalizeOrganizer(event.organizer),
      normTitle: normalizeTitle(event.title),
      titleWordsOrdered,
      titleWordSet,
      venueKey,
      knownVenue: venueKey ? isKnownVenue(venueKey) : false,
    };
  });
}

/**
 * Find duplicate events and determine which to keep/remove.
 * Returns groups of duplicates with decisions.
 */
export function findDuplicates(events: EventForDedup[]): DuplicateGroup[] {
  const duplicateGroups: DuplicateGroup[] = [];
  const processed = new Set<string>();
  const preparedEvents = prepareEvents(events);
  const eventById = new Map(preparedEvents.map((event) => [event.id, event]));
  const eventsByDate = new Map<string, PreparedEventForDedup[]>();

  for (const event of preparedEvents) {
    const group = eventsByDate.get(event.dateKey);
    if (group) {
      group.push(event);
    } else {
      eventsByDate.set(event.dateKey, [event]);
    }
  }

  for (const dateEvents of eventsByDate.values()) {
    if (dateEvents.length < 2) continue;

    dateEvents.sort((a, b) => a.index - b.index);

    const timeGroups = new Map<string, PreparedEventForDedup[]>();
    const venueGroups = new Map<string, PreparedEventForDedup[]>();

    for (const event of dateEvents) {
      const timeGroup = timeGroups.get(event.timeKey);
      if (timeGroup) {
        timeGroup.push(event);
      } else {
        timeGroups.set(event.timeKey, [event]);
      }

      if (event.venueKey) {
        const venueGroup = venueGroups.get(event.venueKey);
        if (venueGroup) {
          venueGroup.push(event);
        } else {
          venueGroups.set(event.venueKey, [event]);
        }
      }
    }

    for (let i = 0; i < dateEvents.length; i++) {
      const event1 = dateEvents[i];
      if (processed.has(event1.id)) continue;

      const duplicates: { event: PreparedEventForDedup; method: string }[] = [];

      const candidateIds = new Set<string>();
      const timeGroup = timeGroups.get(event1.timeKey) ?? [];
      for (const candidate of timeGroup) {
        if (candidate.index > event1.index) candidateIds.add(candidate.id);
      }

      if (event1.venueKey) {
        const venueGroup = venueGroups.get(event1.venueKey) ?? [];
        for (const candidate of venueGroup) {
          if (candidate.index > event1.index) candidateIds.add(candidate.id);
        }
      }

      if (candidateIds.size === 0) continue;

      const candidates = Array.from(candidateIds)
        .map((id) => eventById.get(id))
        .filter((event): event is PreparedEventForDedup => Boolean(event))
        .sort((a, b) => a.index - b.index);

      for (const event2 of candidates) {
        if (processed.has(event2.id)) continue;

        // Pre-compute common values
        const sameOrganizer = event1.normOrganizer === event2.normOrganizer;
        const sameTime = event1.timeKey === event2.timeKey;
        const sameDate = event1.dateKey === event2.dateKey;
        const sameVenue =
          Boolean(event1.venueKey) &&
          Boolean(event2.venueKey) &&
          event1.venueKey === event2.venueKey;
        const bothKnownVenue = sameVenue && event1.knownVenue && event2.knownVenue;

        let matchedMethod: string | null = null;
        let sharedTitleWords: number | null = null;
        const getSharedTitleWords = () => {
          if (sharedTitleWords === null) {
            sharedTitleWords = countSharedTitleWordsFromSets(event1.titleWordSet, event2.titleWordSet);
          }
          return sharedTitleWords;
        };

        // Method A: Same organizer + Same time + Share 2+ significant words in title
        // (Strengthened from 1 word to 2 words)
        // Only apply if both events have organizers (not empty strings)
        const org1 = event1.normOrganizer;
        const org2 = event2.normOrganizer;
        if (!matchedMethod && org1 && org2 && sameOrganizer && sameTime) {
          const sharedWords = getSharedTitleWords();
          if (sharedWords >= 2) {
            matchedMethod = 'A';
          }
        }

        // Method B: Exact same title + Same time + Similar descriptions (10+ shared words)
        if (!matchedMethod && sameTime) {
          if (event1.normTitle === event2.normTitle) {
            const sharedDescWords = countSharedDescriptionWordsPrepared(event1, event2);
            if (sharedDescWords >= 10) {
              matchedMethod = 'B';
            }
          }
        }

        // Method C: Same time + N+ consecutive significant words in title (N based on length)
        // (Relaxed for short titles)
        if (!matchedMethod && sameTime) {
          if (titlesShareOrderedWordsPrepared(event1.titleWordsOrdered, event2.titleWordsOrdered)) {
            matchedMethod = 'C';
          }
        }

        // Method D: Same venue + Same date + 2+ shared title words
        // (New - catches cross-source duplicates)
        if (!matchedMethod && sameVenue && sameDate) {
          const sharedWords = getSharedTitleWords();
          if (sharedWords >= 2) {
            matchedMethod = 'D';
          }
        }

        // Method E: Known venue + Same date + Any title word overlap
        // (New - aggressive matching for known venues on same day)
        if (!matchedMethod && bothKnownVenue && sameDate) {
          const sharedWords = getSharedTitleWords();
          if (sharedWords >= 1) {
            matchedMethod = 'E';
          }
        }

        if (matchedMethod) {
          duplicates.push({ event: event2, method: matchedMethod });
          processed.add(event2.id);
        }
      }

      if (duplicates.length > 0) {
        // Find the best event to keep among all duplicates
        let keep: EventForDedup = event1;
        const remove: EventForDedup[] = [];
        const methods: string[] = [];

        for (const { event: dup, method } of duplicates) {
          methods.push(method);
          const winner = chooseEventToKeep(keep, dup);
          if (winner.id === dup.id) {
            remove.push(keep);
            keep = dup;
          } else {
            remove.push(dup);
          }
        }

        // Check if any removed event has a longer description than the keep event
        // If so, we should merge that description into the keep event
        const keepDescLen = keep.description?.length || 0;
        let longestDesc: string | undefined;
        let longestDescLen = keepDescLen;

        for (const removed of remove) {
          const removedDescLen = removed.description?.length || 0;
          if (removedDescLen > longestDescLen) {
            longestDescLen = removedDescLen;
            longestDesc = removed.description!;
          }
        }

        duplicateGroups.push({
          keep,
          remove,
          method: methods.join(','),
          descriptionUpdate: longestDesc,
        });
        processed.add(event1.id);
      }
    }
  }

  return duplicateGroups;
}

/**
 * Get IDs of events to remove (the losers in duplicate groups)
 */
export function getIdsToRemove(duplicateGroups: DuplicateGroup[]): string[] {
  const ids: string[] = [];
  for (const group of duplicateGroups) {
    for (const event of group.remove) {
      ids.push(event.id);
    }
  }
  return ids;
}

/**
 * Get description updates to apply (merging longer descriptions from removed events)
 */
export function getDescriptionUpdates(duplicateGroups: DuplicateGroup[]): { id: string; description: string }[] {
  const updates: { id: string; description: string }[] = [];
  for (const group of duplicateGroups) {
    if (group.descriptionUpdate) {
      updates.push({
        id: group.keep.id,
        description: group.descriptionUpdate,
      });
    }
  }
  return updates;
}

/**
 * Analyze duplicates without removing (for testing/debugging)
 */
export function analyzeDuplicates(events: EventForDedup[]): {
  groups: DuplicateGroup[];
  summary: {
    totalEvents: number;
    duplicateGroups: number;
    eventsToRemove: number;
    byMethod: Record<string, number>;
  };
} {
  const groups = findDuplicates(events);
  const idsToRemove = getIdsToRemove(groups);

  // Count by method
  const byMethod: Record<string, number> = {};
  for (const group of groups) {
    const methods = group.method.split(',');
    for (const method of methods) {
      byMethod[method] = (byMethod[method] || 0) + 1;
    }
  }

  return {
    groups,
    summary: {
      totalEvents: events.length,
      duplicateGroups: groups.length,
      eventsToRemove: idsToRemove.length,
      byMethod,
    },
  };
}
