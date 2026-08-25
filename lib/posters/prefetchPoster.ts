'use client';

import { getImageProps } from 'next/image';
import type { PosterFeedUpload } from '@/lib/db/queries/posters';

/**
 * The lightbox image's `sizes`.
 *
 * Shared with the dialog rather than duplicated: the prefetch is only useful if
 * it warms the exact srcset candidate the dialog will go on to pick, and a
 * silent drift between the two strings would warm the wrong derivative and look
 * like the prefetch simply was not working.
 */
export const LIGHTBOX_IMAGE_SIZES = '(min-width: 768px) 42rem, 100vw';

/** Uploads warmed this session, so a hovered tile is only fetched once. */
const warmed = new Set<string>();

/**
 * Pull the full-size version of a poster into the browser cache.
 *
 * The wall renders each poster at ~25vw while the lightbox renders it at up to
 * 42rem, so opening one always fetched a derivative that had never been
 * requested - which is the flash. Warming it on hover means the dialog's <img>
 * usually resolves straight out of cache.
 */
export function prefetchPosterImage(upload: PosterFeedUpload): void {
  if (!upload.publicImageUrl || warmed.has(upload.id)) return;
  warmed.add(upload.id);

  try {
    const { props } = getImageProps({
      src: upload.publicImageUrl,
      alt: '',
      width: upload.imageWidth ?? 3,
      height: upload.imageHeight ?? 4,
      sizes: LIGHTBOX_IMAGE_SIZES,
    });

    const image = new window.Image();

    // `sizes` has to be set before `srcset`: the candidate is chosen the moment
    // srcset lands, and against a default of 100vw that picks a wider file than
    // the dialog will ask for - warming the wrong one.
    if (props.sizes) image.sizes = props.sizes;

    // Nothing has been clicked yet, so this must never compete with the wall's
    // own images or with a navigation the reader actually asked for.
    image.decoding = 'async';
    image.setAttribute('fetchpriority', 'low');

    if (props.srcSet) image.srcset = props.srcSet;
    image.src = props.src;
  } catch (error) {
    // A speculative fetch is never worth breaking a hover over.
    console.warn('[Posters] Could not prefetch poster image:', error);
  }
}
