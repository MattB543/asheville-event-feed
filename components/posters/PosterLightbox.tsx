'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CalendarX, ChevronLeft, ChevronRight, Clock, MapPin, Tag, X } from 'lucide-react';
import type { PosterFeedExtraction, PosterFeedUpload } from '@/lib/db/queries/posters';
import { formatWhen, groupByPoster } from '@/lib/posters/posterDisplay';
import { LIGHTBOX_IMAGE_SIZES } from '@/lib/posters/prefetchPoster';
import { formatDateEastern } from '@/lib/utils/timezone';

interface PosterLightboxProps {
  upload: PosterFeedUpload;
  /** Position in the wall, for the "3 of 30" counter. */
  position: number;
  total: number;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}

const MUTED_OUTCOME_LABELS: Record<string, string> = {
  skipped_no_date: 'No date found',
  skipped_past: 'Date passed',
  skipped_non_nc: 'Outside NC',
  failed: 'Not added yet',
};

function OutcomeChip({ extraction }: { extraction: PosterFeedExtraction }) {
  const linkClasses =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-warm-500 bg-warm-500/10 hover:bg-warm-500/20 transition-colors';
  const mutedClasses =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-white/50 bg-white/5';

  if (extraction.outcome === 'created' && extraction.eventSlug) {
    return (
      <Link href={`/events/${extraction.eventSlug}`} className={linkClasses}>
        View event →
      </Link>
    );
  }

  if (extraction.outcome === 'matched_existing') {
    // The matched event can be gone (the FK nulls out on delete), so the chip
    // still says its piece without a link.
    return extraction.eventSlug ? (
      <Link href={`/events/${extraction.eventSlug}`} className={linkClasses}>
        Already listed →
      </Link>
    ) : (
      <span className={mutedClasses}>Already listed</span>
    );
  }

  const label = extraction.outcome ? MUTED_OUTCOME_LABELS[extraction.outcome] : null;
  if (!label) return null;

  return (
    <span className={mutedClasses}>
      {extraction.outcome === 'skipped_no_date' || extraction.outcome === 'skipped_past' ? (
        <CalendarX size={12} className="flex-shrink-0" />
      ) : null}
      {label}
    </span>
  );
}

/**
 * The poster, full bleed, with everything read off it underneath.
 *
 * Deliberately its own dark room rather than a themed panel: taking a flyer off
 * the wall to read it should feel like a different place from the wall.
 */
export default function PosterLightbox({
  upload,
  position,
  total,
  onClose,
  onPrev,
  onNext,
}: PosterLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const groups = groupByPoster(upload.extractions);

  // Latest handlers, so the key listener can be bound once for the lifetime of
  // the dialog instead of rebinding on every poster change.
  const handlers = useRef({ onClose, onPrev, onNext });
  useEffect(() => {
    handlers.current = { onClose, onPrev, onNext };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        handlers.current.onClose();
        return;
      }

      if (event.key === 'ArrowLeft') handlers.current.onPrev?.();
      if (event.key === 'ArrowRight') handlers.current.onNext?.();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Scroll lock plus focus handoff, matching the upload dialog: focus moves in
  // on open and back to whatever opened it on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  // Moving to another poster leaves the previous one's scroll position behind,
  // which lands the reader halfway down an image they have not seen yet.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [upload.id]);

  function trapFocus(event: React.KeyboardEvent) {
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null);

    if (focusable.length === 0) {
      dialogRef.current.focus();
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    // On open, focus sits on the dialog itself, which is not in this list.
    // Without this branch the first Shift+Tab walks straight out to the page
    // behind the modal.
    if (!active || !focusable.includes(active)) {
      (event.shiftKey ? last : first).focus();
      event.preventDefault();
      return;
    }

    if (event.shiftKey && active === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && active === last) {
      first.focus();
      event.preventDefault();
    }
  }

  const navButtonClasses =
    'p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-default transition-colors cursor-pointer';

  return (
    <div className="fixed inset-0 z-50 bg-black/90" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Poster detail"
        tabIndex={-1}
        onKeyDown={trapFocus}
        onClick={(event) => event.stopPropagation()}
        className="absolute inset-0 flex flex-col outline-none"
      >
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 sm:px-5 py-3 text-white/60">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev ?? undefined}
              disabled={!onPrev}
              aria-label="Previous poster"
              className={navButtonClasses}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={onNext ?? undefined}
              disabled={!onNext}
              aria-label="Next poster"
              className={navButtonClasses}
            >
              <ChevronRight size={22} />
            </button>
            <span className="ml-1 text-xs tabular-nums">
              {position} / {total}
            </span>
          </div>

          <button type="button" onClick={onClose} aria-label="Close" className={navButtonClasses}>
            <X size={22} />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 pb-12"
        >
          <div className="mx-auto w-full max-w-2xl">
            {upload.publicImageUrl && (
              <Image
                src={upload.publicImageUrl}
                alt={groups[0] ? `Poster for ${groups[0].title}` : 'Uploaded event poster'}
                width={upload.imageWidth ?? 3}
                height={upload.imageHeight ?? 4}
                sizes={LIGHTBOX_IMAGE_SIZES}
                preload
                className="w-full h-auto max-h-[76vh] object-contain mx-auto rounded-sm shadow-2xl"
              />
            )}

            <div className="mt-7 space-y-6">
              {groups.length === 0 ? (
                <p className="text-sm text-white/50">
                  No event details were read from this poster.
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.ordinal} className="space-y-2">
                    <h2 className="font-display text-xl sm:text-2xl font-semibold text-white break-words">
                      {group.title}
                    </h2>

                    {(group.location || group.price || group.organizer) && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/60">
                        {group.location && (
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <MapPin size={14} className="flex-shrink-0" />
                            <span className="truncate">{group.location}</span>
                          </span>
                        )}
                        {group.price && (
                          <span className="inline-flex items-center gap-1">
                            <Tag size={14} className="flex-shrink-0" />
                            {group.price}
                          </span>
                        )}
                        {group.organizer && (
                          <span className="truncate text-white/45">{group.organizer}</span>
                        )}
                      </div>
                    )}

                    <ul className="space-y-1.5 pt-1">
                      {group.dates.map((extraction) => (
                        <li
                          key={extraction.id}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/80"
                        >
                          {/* A missing date is said once, by the chip. */}
                          {extraction.startDate && (
                            <span className="inline-flex items-center gap-1">
                              <Clock size={14} className="flex-shrink-0 text-white/40" />
                              {formatWhen(extraction.startDate, extraction.timeUnknown)}
                            </span>
                          )}
                          <OutcomeChip extraction={extraction} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}

              <p className="pt-2 text-xs text-white/35">
                Spotted{' '}
                {formatDateEastern(upload.createdAt, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
