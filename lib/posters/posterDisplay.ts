/**
 * Shared display helpers for the /posters wall: grouping extraction rows back
 * into the printed posters they came off, and the deterministic "pinned to a
 * wall" jitter each tile is drawn with.
 */

import type { PosterFeedExtraction, PosterFeedUpload } from '@/lib/db/queries/posters';
import { formatDateEastern } from '@/lib/utils/timezone';

/** Extractions sharing an ordinal came off the same printed poster. */
export interface PosterGroup {
  ordinal: number;
  title: string;
  location: string | null;
  organizer: string | null;
  price: string | null;
  dates: PosterFeedExtraction[];
}

export function groupByPoster(extractions: PosterFeedExtraction[]): PosterGroup[] {
  const groups: PosterGroup[] = [];

  for (const extraction of extractions) {
    const current = groups.at(-1);

    // The query orders by ordinal, so same-poster rows always arrive adjacent.
    if (current && current.ordinal === extraction.ordinal) {
      current.dates.push(extraction);
      continue;
    }

    groups.push({
      ordinal: extraction.ordinal,
      title: extraction.title,
      location: extraction.location,
      organizer: extraction.organizer,
      price: extraction.price,
      dates: [extraction],
    });
  }

  return groups;
}

export function formatWhen(startDate: Date, timeUnknown: boolean): string {
  const date = formatDateEastern(startDate, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  if (timeUnknown) return `${date} · Time TBD`;

  const time = formatDateEastern(startDate, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${date} · ${time}`;
}

/** What a tile shows before you open it: the headline poster's title. */
export function posterHeadline(upload: PosterFeedUpload): string | null {
  return upload.extractions[0]?.title ?? null;
}

/**
 * FNV-1a over the upload id.
 *
 * Every bit of the wall's randomness is derived from this rather than
 * Math.random: the server and the client have to draw the same wall or React
 * throws a hydration mismatch, and a poster that re-rolled its tilt on every
 * navigation would look broken rather than hand-pinned.
 */
function hashId(id: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** One deterministic 0..1 draw per (id, slot). */
function draw(id: string, slot: number): number {
  return (hashId(`${id}:${slot}`) % 10_000) / 10_000;
}

/** Where along the poster's top edge a strip of tape is stuck. */
export type TapeAnchor =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'top-quarter'
  | 'top-three-quarters';

export interface TapeStrip {
  anchor: TapeAnchor;
  /** Degrees, so no two strips read as the same sticker. */
  rotation: number;
}

export interface PosterJitter {
  /** Degrees; small enough that neighbouring tiles graze rather than collide. */
  rotation: number;
  /** One strip, or occasionally two spaced across the top edge. Never empty. */
  tape: TapeStrip[];
}

const MAX_ROTATION_DEGREES = 1.4;

/** Degrees a strip sits at, given where it is stuck and one 0..1 draw. */
function stripRotation(anchor: TapeAnchor, spread: number): number {
  // Tape over a corner is torn off and laid diagonally across it. Tape along
  // the top edge is pressed down roughly level, just never quite straight.
  if (anchor === 'top-left') return -(30 + spread * 22);
  if (anchor === 'top-right') return 30 + spread * 22;

  return (spread * 2 - 1) * 11;
}

function stripAt(uploadId: string, anchor: TapeAnchor, slot: number): TapeStrip {
  return { anchor, rotation: stripRotation(anchor, draw(uploadId, slot)) };
}

export function posterJitter(uploadId: string): PosterJitter {
  const style = draw(uploadId, 3);

  // Every poster is taped up - nothing stays on a wall by itself. The two-strip
  // treatment is kept rare so it reads as the occasional wide flyer someone
  // bothered to square up, rather than as the house style.
  const tape: TapeStrip[] =
    style < 0.85
      ? [
          stripAt(
            uploadId,
            style < 0.28 ? 'top-left' : style < 0.56 ? 'top-right' : 'top-center',
            4
          ),
        ]
      : [stripAt(uploadId, 'top-quarter', 5), stripAt(uploadId, 'top-three-quarters', 6)];

  return {
    rotation: (draw(uploadId, 1) * 2 - 1) * MAX_ROTATION_DEGREES,
    tape,
  };
}
