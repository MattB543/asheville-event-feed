import { getVenueForEvent } from '@/lib/utils/venues';
import type { Top30ComparableEvent } from '@/lib/notifications/top30-notification-equivalence';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_KEY_PREFIX = 'top30:key:';

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'concert',
  'event',
  'featuring',
  'for',
  'from',
  'in',
  'is',
  'its',
  'live',
  'of',
  'on',
  'or',
  'presents',
  'show',
  'the',
  'ticket',
  'tickets',
  'to',
  'tour',
  'with',
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

function toSignificantWords(value: string): string[] {
  return normalizeLooseText(value)
    .split(/\s+/)
    .flatMap((word) => word.split(/-+/))
    .filter((word) => word.length >= 2 && !TITLE_STOP_WORDS.has(word));
}

function getNotificationVenueKey(event: Top30ComparableEvent): string {
  const venue = getVenueForEvent(event.organizer, event.location, event.title);
  if (venue) {
    return venue;
  }

  const normalizedLocation = normalizeLooseText(event.location);
  if (normalizedLocation) {
    return normalizedLocation;
  }

  const normalizedOrganizer = normalizeLooseText(event.organizer);
  if (normalizedOrganizer) {
    return normalizedOrganizer;
  }

  return 'unknown';
}

function getNormalizedTitleKey(event: Top30ComparableEvent): string {
  const venueWords = new Set(toSignificantWords(getNotificationVenueKey(event)));
  const titleWords = toSignificantWords(event.title).filter((word) => !venueWords.has(word));

  if (titleWords.length > 0) {
    return titleWords.join('+');
  }

  const normalizedTitle = normalizeLooseText(event.title);
  return normalizedTitle || 'untitled';
}

export function buildTop30NotificationTrackingKey(event: Top30ComparableEvent): string {
  const dateKey = getEasternDateKey(event.startDate);
  const venueKey = getNotificationVenueKey(event);
  const titleKey = getNormalizedTitleKey(event);
  return `${TRACKING_KEY_PREFIX}${dateKey}:${venueKey}:${titleKey}`;
}

export function isStoredTop30NotificationTrackingKey(value: string): boolean {
  return value.startsWith(TRACKING_KEY_PREFIX);
}

export function extractStoredTop30NotificationTrackingKeys(values: string[]): string[] {
  return values.filter(isStoredTop30NotificationTrackingKey);
}

export function extractStoredTop30TrackedEventIds(values: string[]): string[] {
  return values.filter((value) => UUID_REGEX.test(value));
}
