/**
 * Event deduplication utility.
 *
 * Duplicates are identified when ANY of:
 * A) Same organizer + Same start time + Share at least 1 significant word in title
 * B) Exact same title + Same start time + Descriptions share 10+ significant words
 *    (catches same event posted by different sources with different organizer names)
 * C) Same start time + Titles share 4+ significant words in the same order
 *    (catches cases like "Freshen Up Comedy Open Mic" vs "Freshen Up Comedy Open Mic at VOWL Bar")
 *
 * When duplicates are found, keep:
 * 1. The one with a known price (not "Unknown")
 * 2. If tie, the one with longer description
 * 3. If still tie, the newer one (by createdAt)
 */

interface EventForDedup {
  id: string;
  title: string;
  organizer: string | null;
  startDate: Date;
  price: string | null;
  description: string | null;
  createdAt: Date | null;
}

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
 * Check if two titles share at least one significant word
 */
function titlesShareWord(title1: string, title2: string): boolean {
  const words1 = extractWords(title1);
  const words2 = extractWords(title2);

  for (const word of words1) {
    if (words2.has(word)) {
      return true;
    }
  }
  return false;
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
 * Check if two titles share at least N consecutive significant words in the same order.
 * Uses longest common subsequence approach to find shared word sequences.
 */
function titlesShareOrderedWords(title1: string, title2: string, minWords: number): boolean {
  const words1 = extractWordsOrdered(title1);
  const words2 = extractWordsOrdered(title2);

  if (words1.length < minWords || words2.length < minWords) {
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

  return maxConsecutive >= minWords;
}

/**
 * Normalize title for exact comparison (case-insensitive, trimmed)
 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}

/**
 * Check if two titles are exactly the same (case-insensitive)
 */
function titlesExactMatch(title1: string, title2: string): boolean {
  return normalizeTitle(title1) === normalizeTitle(title2);
}

/**
 * Count how many significant words two descriptions share
 */
function countSharedDescriptionWords(desc1: string | null, desc2: string | null): number {
  if (!desc1 || !desc2) return 0;

  const words1 = extractWords(desc1);
  const words2 = extractWords(desc2);

  let count = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      count++;
    }
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
 * Check if two dates are the same (ignoring seconds/milliseconds)
 * Uses UTC methods to avoid timezone-related comparison issues
 */
function isSameTime(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate() &&
    date1.getUTCHours() === date2.getUTCHours() &&
    date1.getUTCMinutes() === date2.getUTCMinutes()
  );
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
}

/**
 * Find duplicate events and determine which to keep/remove.
 * Returns groups of duplicates with decisions.
 */
export function findDuplicates(events: EventForDedup[]): DuplicateGroup[] {
  const duplicateGroups: DuplicateGroup[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const event1 = events[i];

    if (processed.has(event1.id)) continue;

    const duplicates: EventForDedup[] = [];

    for (let j = i + 1; j < events.length; j++) {
      const event2 = events[j];

      if (processed.has(event2.id)) continue;

      // Check if they're duplicates using any method:
      // A) Same organizer + Same time + Share word in title
      // B) Exact same title + Same time + 10+ shared words in description
      // C) Same time + 4+ consecutive significant words in same order in title
      const sameOrganizer = normalizeOrganizer(event1.organizer) === normalizeOrganizer(event2.organizer);
      const sameTime = isSameTime(event1.startDate, event2.startDate);
      const shareWord = titlesShareWord(event1.title, event2.title);

      const methodA = sameOrganizer && sameTime && shareWord;

      // Method B: exact title match + same time + similar descriptions
      const exactTitleMatch = titlesExactMatch(event1.title, event2.title);
      const sharedDescWords = countSharedDescriptionWords(event1.description, event2.description);
      const methodB = exactTitleMatch && sameTime && sharedDescWords >= 10;

      // Method C: same time + 4+ consecutive significant words in title (in same order)
      const methodC = sameTime && titlesShareOrderedWords(event1.title, event2.title, 4);

      if (methodA || methodB || methodC) {
        duplicates.push(event2);
        processed.add(event2.id);
      }
    }

    if (duplicates.length > 0) {
      // Find the best event to keep among all duplicates
      let keep = event1;
      const remove: EventForDedup[] = [];

      for (const dup of duplicates) {
        const winner = chooseEventToKeep(keep, dup);
        if (winner.id === dup.id) {
          remove.push(keep);
          keep = dup;
        } else {
          remove.push(dup);
        }
      }

      duplicateGroups.push({ keep, remove });
      processed.add(event1.id);
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
