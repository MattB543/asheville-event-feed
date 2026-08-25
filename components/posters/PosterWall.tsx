'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosterFeedUpload } from '@/lib/db/queries/posters';
import PosterLightbox from '@/components/posters/PosterLightbox';
import PosterTile from '@/components/posters/PosterTile';
import { prefetchPosterImage } from '@/lib/posters/prefetchPoster';

interface PosterWallProps {
  uploads: PosterFeedUpload[];
  /** From `?p=`, the deep link poster event pages point at. */
  initialExtractionId: string | null;
}

/** Marks the history entry the dialog pushed for itself. */
const POSTER_HISTORY_STATE = { posterOpen: true };

/** `history.state` is `any`; this is the only thing we ask of it. */
function isPosterEntry(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'posterOpen' in state;
}

function urlWithPoster(extractionId: string | null): string {
  const url = new URL(window.location.href);

  if (extractionId) {
    url.searchParams.set('p', extractionId);
  } else {
    url.searchParams.delete('p');
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The wall, and the poster currently taken down off it.
 *
 * History is deliberately handled in the open/step/close handlers rather than in
 * an effect that follows state. An effect cannot tell "the user opened a poster"
 * from "the user pressed Back", so it ends up rewriting the entry it just
 * travelled to - which silently strips `?p=` off the entry the reader came from
 * and stops Forward reopening the poster. Instead: the handlers own the history
 * writes, and after any traversal the URL is the source of truth.
 */
export default function PosterWall({ uploads, initialExtractionId }: PosterWallProps) {
  // Only uploads with a published image can be pinned up; the column is
  // nullable, so this is a real filter rather than a cast.
  const wall = uploads.filter((upload) => upload.publicImageUrl);

  const indexForExtraction = useCallback(
    (extractionId: string | null) => {
      if (!extractionId) return null;

      const index = wall.findIndex((upload) =>
        upload.extractions.some((extraction) => extraction.id === extractionId)
      );

      return index === -1 ? null : index;
    },
    [wall]
  );

  const [openIndex, setOpenIndex] = useState<number | null>(() =>
    indexForExtraction(initialExtractionId)
  );

  /**
   * Whether the open poster sits on a history entry the dialog pushed.
   *
   * False when the reader arrived on `?p=` directly: that entry is theirs, and
   * closing has to edit it in place rather than navigate off the site.
   */
  const ownsHistoryEntry = useRef(false);
  /** Guards a held-down Escape from firing several back() calls before the first popstate. */
  const closing = useRef(false);

  const current = openIndex === null ? null : (wall[openIndex] ?? null);

  /** Show a poster and put it in the URL, pushing an entry the first time. */
  const show = useCallback(
    (index: number) => {
      const target = wall[index];
      if (!target) return;

      const url = urlWithPoster(target.extractions[0]?.id ?? null);

      if (ownsHistoryEntry.current) {
        // Stepping between posters edits the dialog's own entry, so browsing
        // the whole wall still costs exactly one Back press to escape.
        window.history.replaceState(POSTER_HISTORY_STATE, '', url);
      } else {
        window.history.pushState(POSTER_HISTORY_STATE, '', url);
        ownsHistoryEntry.current = true;
      }

      setOpenIndex(index);
    },
    [wall]
  );

  const open = useCallback(
    (uploadId: string) => {
      const index = wall.findIndex((upload) => upload.id === uploadId);
      if (index !== -1) show(index);
    },
    [wall, show]
  );

  const close = useCallback(() => {
    if (closing.current) return;

    if (ownsHistoryEntry.current) {
      // popstate does the actual closing, so the button and the Back gesture
      // cannot disagree about where the reader ends up.
      closing.current = true;
      window.history.back();
      return;
    }

    window.history.replaceState(window.history.state, '', urlWithPoster(null));
    setOpenIndex(null);
  }, []);

  /**
   * Speculative fetching stays off until the page has finished loading.
   *
   * Hovering during load would put full-size posters nobody has asked for in
   * competition with the wall's own thumbnails, making the visible thing slower
   * to serve the invisible one. `load` waits for the wall's images; the idle
   * callback then waits for the main thread to be free.
   */
  const [prefetchArmed, setPrefetchArmed] = useState(false);

  useEffect(() => {
    let handle: number | undefined;

    function arm() {
      handle = window.requestIdleCallback
        ? window.requestIdleCallback(() => setPrefetchArmed(true))
        : window.setTimeout(() => setPrefetchArmed(true), 300);
    }

    if (document.readyState === 'complete') {
      arm();
    } else {
      window.addEventListener('load', arm, { once: true });
    }

    return () => {
      window.removeEventListener('load', arm);
      if (handle === undefined) return;
      if (window.cancelIdleCallback) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  const prefetch = useCallback(
    (uploadId: string) => {
      if (!prefetchArmed) return;

      const upload = wall.find((candidate) => candidate.id === uploadId);
      if (upload) prefetchPosterImage(upload);
    },
    [prefetchArmed, wall]
  );

  // With a poster open, the next one is the likeliest thing to be asked for, so
  // it is fetched while the reader is still looking at this one. Nothing warms
  // the open poster itself - it is already on screen.
  useEffect(() => {
    if (!prefetchArmed || openIndex === null) return;

    const next = wall[openIndex + 1];
    if (next) prefetchPosterImage(next);
  }, [prefetchArmed, openIndex, wall]);

  // One permanent listener. After a traversal - Back, Forward, or a gesture -
  // the URL says what should be open, so Forward reopens the poster the reader
  // just backed out of instead of landing on a stale `?p=`.
  useEffect(() => {
    function onPopState() {
      const extractionId = new URLSearchParams(window.location.search).get('p');

      closing.current = false;
      ownsHistoryEntry.current = isPosterEntry(window.history.state);
      setOpenIndex(indexForExtraction(extractionId));
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [indexForExtraction]);

  if (wall.length === 0) return null;

  return (
    <>
      {/* Multi-column masonry: the browser balances the columns itself, so the
          wall packs tightly at every width with no measuring pass and no
          reflow once the images decode. Native `grid-lanes` masonry is still
          Safari-only, and a JS layout would shift the wall on first paint. */}
      <div className="columns-2 min-[420px]:columns-3 lg:columns-4 gap-[3px]">
        {wall.map((upload, index) => (
          <PosterTile
            key={upload.id}
            upload={upload}
            index={index}
            onOpen={open}
            onPrefetch={prefetch}
          />
        ))}
      </div>

      {current && openIndex !== null && (
        <PosterLightbox
          upload={current}
          position={openIndex + 1}
          total={wall.length}
          onClose={close}
          onPrev={openIndex > 0 ? () => show(openIndex - 1) : null}
          onNext={openIndex < wall.length - 1 ? () => show(openIndex + 1) : null}
        />
      )}
    </>
  );
}
