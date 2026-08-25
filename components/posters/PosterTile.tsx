'use client';

import type { CSSProperties } from 'react';
import Image from 'next/image';
import type { PosterFeedUpload } from '@/lib/db/queries/posters';
import { posterHeadline, posterJitter, type TapeAnchor } from '@/lib/posters/posterDisplay';

interface PosterTileProps {
  upload: PosterFeedUpload;
  /** Position on the wall; only the very first tile is worth preloading. */
  index: number;
  onOpen: (uploadId: string) => void;
  /** Warm the full-size image before it is asked for. Safe to call repeatedly. */
  onPrefetch: (uploadId: string) => void;
}

/** Fallback shape for uploads that predate the stored dimensions. */
const FALLBACK_WIDTH = 3;
const FALLBACK_HEIGHT = 4;

/** Half of .poster-tape's 3.4rem width, to centre a strip on its anchor point. */
const TAPE_HALF_WIDTH = '-1.7rem';

const TAPE_POSITION: Record<TapeAnchor, CSSProperties> = {
  'top-left': { left: '-0.7rem', top: '-0.45rem' },
  'top-right': { right: '-0.7rem', top: '-0.45rem' },
  'top-center': { left: '50%', top: '-0.55rem', marginLeft: TAPE_HALF_WIDTH },
  'top-quarter': { left: '25%', top: '-0.55rem', marginLeft: TAPE_HALF_WIDTH },
  'top-three-quarters': { left: '75%', top: '-0.55rem', marginLeft: TAPE_HALF_WIDTH },
};

/**
 * A single poster pinned to the wall.
 *
 * The tile is nothing but the image - no title, no chrome. Everything the
 * poster says is already printed on it, and a caption under each one would turn
 * a wall back into a list.
 */
export default function PosterTile({ upload, index, onOpen, onPrefetch }: PosterTileProps) {
  if (!upload.publicImageUrl) return null;

  const { rotation, tape } = posterJitter(upload.id);
  const headline = posterHeadline(upload);

  // Real dimensions where we have them, so the tile reserves its exact height
  // before the image decodes and the wall never reflows under the reader.
  const width = upload.imageWidth ?? FALLBACK_WIDTH;
  const height = upload.imageHeight ?? FALLBACK_HEIGHT;

  return (
    <button
      type="button"
      onClick={() => onOpen(upload.id)}
      // Touch has no hover, so the touch start is the only warning the tile
      // gets - it still buys the length of the tap.
      onMouseEnter={() => onPrefetch(upload.id)}
      onFocus={() => onPrefetch(upload.id)}
      onTouchStart={() => onPrefetch(upload.id)}
      className="poster-tile block w-full mb-[3px] break-inside-avoid cursor-pointer"
      aria-label={headline ? `Open poster: ${headline}` : 'Open poster'}
    >
      {/* The tilt lives on the paper, not on the button. A transform creates a
          stacking context, and with it on the button the tape below could never
          paint outside its own tile - so the next column covered it. */}
      <div className="poster-paper" style={{ transform: `rotate(${rotation}deg)` }}>
        <Image
          src={upload.publicImageUrl}
          alt={headline ? `Poster for ${headline}` : 'Event poster photographed in Asheville'}
          width={width}
          height={height}
          sizes="(min-width: 1024px) 25vw, (min-width: 420px) 33vw, 50vw"
          // Columns fill top-to-bottom, so tiles 1-5 are the rest of the FIRST
          // column, not the first row - preloading them buys nothing and starves
          // the genuinely visible tiles in the other columns of bandwidth.
          preload={index === 0}
          className="block w-full h-auto"
        />
        <span className="poster-grain" aria-hidden="true" />
      </div>

      {tape.map((strip) => (
        <span
          key={strip.anchor}
          className="poster-tape"
          aria-hidden="true"
          style={{
            ...TAPE_POSITION[strip.anchor],
            transform: `rotate(${strip.rotation}deg)`,
          }}
        />
      ))}
    </button>
  );
}
