'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosterFeedUpload } from '@/lib/db/queries/posters';
import PosterLightbox from '@/components/posters/PosterLightbox';
import PosterTile from '@/components/posters/PosterTile';
import { prefetchPosterImage } from '@/lib/posters/prefetchPoster';

interface PosterWallProps {
  /** Posters in display order: on the split wall, earliest event first. */
  uploads: PosterFeedUpload[];
  /** From `?p=`, the deep link poster event pages point at. */
  initialExtractionId: string | null;
  /**
   * Index in `uploads` where today begins. The wall is cut in two there with a
   * marker between, and the reader lands on the marker rather than at the top.
   * Null renders one unbroken wall.
   */
  todayIndex?: number | null;
}

/** The masonry itself. Column counts live here so both halves stay identical. */
const WALL_COLUMNS = 'columns-2 min-[420px]:columns-3 lg:columns-4 gap-[3px]';

/**
 * How much of the past wall stays on screen once the reader lands on today.
 * Enough to read as "there is more above" without having to guess.
 */
const PAST_PEEK_FRACTION = 0.2;

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
export default function PosterWall({
  uploads,
  initialExtractionId,
  todayIndex = null,
}: PosterWallProps) {
  // Only uploads with a published image can be pinned up; the column is
  // nullable, so this is a real filter rather than a cast.
  const wall = uploads.filter((upload) => upload.publicImageUrl);

  // Counted against the filtered wall, not carried over from the caller: every
  // upload dropped above the cut would otherwise drag the marker one poster out
  // of place.
  const splitAt =
    todayIndex === null
      ? null
      : uploads.slice(0, todayIndex).filter((upload) => upload.publicImageUrl).length;

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

  const marker = useRef<HTMLDivElement>(null);
  /** Captured on mount: a deep link owns the landing position, the marker does not. */
  const deepLinked = useRef(openIndex !== null);

  // Land on today rather than at the top, so the past is something the reader
  // scrolls up into instead of something they scroll past to reach tonight.
  // Tiles carry their real dimensions, so the wall is already its final height
  // here and the target does not move once the images decode.
  useEffect(() => {
    if (splitAt === null || deepLinked.current) return;

    const element = marker.current;
    // A reload or a Back press restores where the reader was; only a fresh
    // arrival at the top of the page is ours to move.
    if (!element || window.scrollY > 0) return;

    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - window.innerHeight * PAST_PEEK_FRACTION) });
  }, [splitAt]);

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

  /**
   * One block of masonry. `offset` is the tile's position on the whole wall,
   * which is what the lightbox indexes by - the split is a layout detail and
   * must not renumber the posters underneath it.
   */
  function block(posters: PosterFeedUpload[], offset: number) {
    return (
      // Multi-column masonry: the browser balances the columns itself, so the
      // wall packs tightly at every width with no measuring pass and no reflow
      // once the images decode. Native `grid-lanes` masonry is still
      // Safari-only, and a JS layout would shift the wall on first paint.
      <div className={WALL_COLUMNS}>
        {posters.map((upload, index) => (
          <PosterTile
            key={upload.id}
            upload={upload}
            // The one poster worth preloading is the one the reader lands on,
            // which on a split wall is the first that has not happened yet.
            preload={offset + index === (splitAt ?? 0)}
            onOpen={open}
            onPrefetch={prefetch}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {splitAt === null ? (
        block(wall, 0)
      ) : (
        <>
          {splitAt > 0 && block(wall.slice(0, splitAt), 0)}

          <div
            ref={marker}
            id="today"
            className="flex items-center gap-3 sm:gap-4 px-2 sm:px-3 my-8 sm:my-12"
          >
            <span className="h-px flex-1 bg-gray-300 dark:bg-gray-700" />
            <span className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Today
            </span>
            <span className="h-px flex-1 bg-gray-300 dark:bg-gray-700" />
          </div>

          {splitAt < wall.length && block(wall.slice(splitAt), splitAt)}
        </>
      )}

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
