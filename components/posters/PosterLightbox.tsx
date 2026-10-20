'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CalendarX, ChevronLeft, ChevronRight, Clock, MapPin, Tag } from 'lucide-react';
import Lightbox, { LIGHTBOX_BUTTON_CLASSES } from '@/components/Lightbox';
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
  const groups = groupByPoster(upload.extractions);

  return (
    <Lightbox
      label="Poster detail"
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      scrollKey={upload.id}
      headerStart={
        <>
          <button
            type="button"
            onClick={onPrev ?? undefined}
            disabled={!onPrev}
            aria-label="Previous poster"
            className={LIGHTBOX_BUTTON_CLASSES}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={onNext ?? undefined}
            disabled={!onNext}
            aria-label="Next poster"
            className={LIGHTBOX_BUTTON_CLASSES}
          >
            <ChevronRight size={22} />
          </button>
          <span className="ml-1 text-xs tabular-nums">
            {position} / {total}
          </span>
        </>
      }
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
            <p className="text-sm text-white/50">No event details were read from this poster.</p>
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
    </Lightbox>
  );
}
