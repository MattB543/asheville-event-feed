/**
 * The Top 30 list's multi-day collapse, shared by the Top 30 tab
 * (components/EventFeed.tsx) and the /news end cap. A rank is a position in the
 * merged list, so both read the same numbers off the same candidates.
 */

export interface Top30Occurrence {
  id: string;
  startDate: Date | string;
  timeUnknown?: boolean | null;
}

export type DatedTop30Occurrence = Omit<Top30Occurrence, 'startDate'> & { startDate: Date };

/** The fields the collapse reads and fills in. Callers' rows carry more, which pass through. */
export interface Top30Candidate {
  id: string;
  title: string;
  startDate: Date | string; // May be a string after SSR or unstable_cache serialization
  timeUnknown?: boolean | null;
  location?: string | null;
  organizer?: string | null;
  imageUrl?: string | null;
  aiSummary?: string | null;
  description?: string | null;
  tags?: string[] | null;
  top30Occurrences?: Top30Occurrence[] | null;
}

export type DatedTop30Candidate<T extends Top30Candidate> = Omit<
  T,
  'startDate' | 'top30Occurrences'
> & {
  startDate: Date;
  top30Occurrences?: DatedTop30Occurrence[] | null;
};

type DatedCandidate = DatedTop30Candidate<Top30Candidate>;

const TOP30_DUPLICATE_GAP_MS = 48 * 60 * 60 * 1000;

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeTop30KeyPart(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeTop30Venue(location: string | null | undefined): string {
  return normalizeTop30KeyPart(location?.split(',')[0]);
}

export function getEventOccurrences(
  event: Pick<Top30Candidate, 'id' | 'startDate' | 'timeUnknown' | 'top30Occurrences'>
): DatedTop30Occurrence[] {
  if (event.top30Occurrences && event.top30Occurrences.length > 0) {
    return event.top30Occurrences.map((occurrence) => ({
      ...occurrence,
      startDate: toDate(occurrence.startDate),
    }));
  }

  return [
    {
      id: event.id,
      startDate: toDate(event.startDate),
      timeUnknown: event.timeUnknown ?? false,
    },
  ];
}

function toDatedCandidate(event: Top30Candidate): DatedCandidate {
  return {
    ...event,
    startDate: toDate(event.startDate),
    top30Occurrences: event.top30Occurrences?.map((occurrence) => ({
      ...occurrence,
      startDate: toDate(occurrence.startDate),
    })),
  };
}

function shouldMergeTop30Events(previous: DatedCandidate, next: DatedCandidate): boolean {
  if (normalizeTop30KeyPart(previous.title) !== normalizeTop30KeyPart(next.title)) return false;
  if (normalizeTop30KeyPart(previous.organizer) !== normalizeTop30KeyPart(next.organizer)) {
    return false;
  }

  const previousVenue = normalizeTop30Venue(previous.location);
  const nextVenue = normalizeTop30Venue(next.location);
  if (previousVenue && nextVenue && previousVenue !== nextVenue) return false;

  const previousOccurrences = getEventOccurrences(previous);
  const previousLastOccurrence = previousOccurrences[previousOccurrences.length - 1];
  const diffMs = next.startDate.getTime() - previousLastOccurrence.startDate.getTime();

  return diffMs > 0 && diffMs <= TOP30_DUPLICATE_GAP_MS;
}

// Collapse duplicate multi-day listings into one entry with several occurrences.
// Returns the whole ranked list (not just 30): the Top 30 tab filters it and then
// takes the first 30 survivors. A forward pass, so growing the candidate pool
// never changes the ranks of entries that were already in it.
export function mergeTop30CategoryEvents<T extends Top30Candidate>(
  categoryEvents: T[]
): DatedTop30Candidate<T>[] {
  const merged: DatedCandidate[] = [];

  for (const rawEvent of categoryEvents) {
    const event = toDatedCandidate(rawEvent);
    const mergeTarget = [...merged]
      .reverse()
      .find((existingEvent) => shouldMergeTop30Events(existingEvent, event));

    if (!mergeTarget) {
      merged.push(event);
      continue;
    }

    const mergedOccurrences = [
      ...getEventOccurrences(mergeTarget),
      ...getEventOccurrences(event),
    ].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    mergeTarget.top30Occurrences = mergedOccurrences;

    if ((event.location?.length || 0) > (mergeTarget.location?.length || 0)) {
      mergeTarget.location = event.location;
    }
    if (!mergeTarget.organizer && event.organizer) {
      mergeTarget.organizer = event.organizer;
    }
    if (!mergeTarget.imageUrl && event.imageUrl) {
      mergeTarget.imageUrl = event.imageUrl;
    }
    if (!mergeTarget.aiSummary && event.aiSummary) {
      mergeTarget.aiSummary = event.aiSummary;
    }
    if ((!mergeTarget.description || mergeTarget.description.length === 0) && event.description) {
      mergeTarget.description = event.description;
    }
    if (event.tags && event.tags.length > 0) {
      mergeTarget.tags = Array.from(new Set([...(mergeTarget.tags || []), ...event.tags]));
    }
  }

  // Each entry is the caller's own row spread with its dates converted, so every
  // field of T is still there; only the static type was narrowed along the way.
  return merged as unknown as DatedTop30Candidate<T>[];
}
