import { getVenueForEvent } from '@/lib/utils/venues';

export interface Top30ComparableEvent {
  id?: string;
  title: string;
  startDate: Date;
  location?: string | null;
  organizer?: string | null;
}

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'is',
  'its',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'live',
  'show',
  'presents',
  'featuring',
  'asheville',
]);

function getEasternDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function normalizeLooseText(value: string | null | undefined): string {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleWords(title: string): Set<string> {
  return new Set(
    normalizeLooseText(title)
      .split(/\s+/)
      .flatMap((word) => word.split(/-+/))
      .filter((word) => word.length >= 3 && !TITLE_STOP_WORDS.has(word))
  );
}

function countSharedWords(words1: Set<string>, words2: Set<string>): number {
  if (words1.size === 0 || words2.size === 0) return 0;

  const [small, large] = words1.size <= words2.size ? [words1, words2] : [words2, words1];
  let shared = 0;

  for (const word of small) {
    if (large.has(word)) {
      shared++;
    }
  }

  return shared;
}

export function areEquivalentTop30Events(
  event: Top30ComparableEvent,
  previousEvent: Top30ComparableEvent
): boolean {
  if (getEasternDateKey(event.startDate) !== getEasternDateKey(previousEvent.startDate)) {
    return false;
  }

  const eventVenue = getVenueForEvent(event.organizer, event.location, event.title);
  const previousVenue = getVenueForEvent(
    previousEvent.organizer,
    previousEvent.location,
    previousEvent.title
  );

  if (eventVenue && previousVenue && eventVenue !== previousVenue) {
    return false;
  }

  if (!eventVenue && !previousVenue) {
    const eventOrganizer = normalizeLooseText(event.organizer);
    const previousOrganizer = normalizeLooseText(previousEvent.organizer);
    if (eventOrganizer && previousOrganizer && eventOrganizer !== previousOrganizer) {
      return false;
    }
  }

  const normalizedTitle = normalizeLooseText(event.title);
  const normalizedPreviousTitle = normalizeLooseText(previousEvent.title);

  if (normalizedTitle === normalizedPreviousTitle) {
    return true;
  }

  if (
    normalizedTitle.length >= 12 &&
    normalizedPreviousTitle.length >= 12 &&
    (normalizedTitle.includes(normalizedPreviousTitle) ||
      normalizedPreviousTitle.includes(normalizedTitle))
  ) {
    return true;
  }

  const titleWords = extractTitleWords(event.title);
  const previousTitleWords = extractTitleWords(previousEvent.title);
  const sharedWords = countSharedWords(titleWords, previousTitleWords);
  const minWordCount = Math.min(titleWords.size, previousTitleWords.size);

  return (
    sharedWords >= 3 ||
    (sharedWords >= 2 && minWordCount <= 4 && sharedWords / Math.max(minWordCount, 1) >= 0.66)
  );
}
