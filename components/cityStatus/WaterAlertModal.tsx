'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Droplet, ExternalLink, X } from 'lucide-react';
import {
  CITY_WATER_ADVISORIES_URL,
  type WaterNotice,
  type WaterStatus,
} from '@/lib/cityStatus/types';

interface WaterAlertModalProps {
  status: WaterStatus;
  onClose: () => void;
}

const postedFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});

function formatPosted(iso: string): string {
  // "Thu, Oct 1, 8:07 AM" -> "Thu, Oct 1 at 8:07 AM"
  return postedFormat.format(new Date(iso)).replace(/, (\d{1,2}:\d{2})/, ' at $1');
}

/** "Thu, Oct 1, 7:00 PM – Fri, Oct 2, 6:00 AM", "Thu, Oct 1, 8:00 AM – 8:00 PM", "Thu, Oct 1" */
function formatScheduled({ start, end, allDay }: NonNullable<WaterNotice['scheduled']>): string {
  const startDay = dayFormat.format(new Date(start));
  if (allDay) return startDay;
  const endDay = dayFormat.format(new Date(end));
  const startTime = timeFormat.format(new Date(start));
  const endTime = timeFormat.format(new Date(end));
  return endDay === startDay
    ? `${startDay}, ${startTime} – ${endTime}`
    : `${startDay}, ${startTime} – ${endDay}, ${endTime}`;
}

/** Boil-water is orange throughout; outages stay neutral (amber only on the droplet). */
const KIND: Record<
  WaterNotice['kind'],
  { label: string; todo: string; tag: string; callout: string }
> = {
  boil: {
    label: 'Boil water advisory',
    todo: 'Bring water to a rolling boil for 1 minute before drinking, cooking, making ice or brushing teeth, until the city lifts this advisory.',
    tag: 'text-orange-700 dark:text-orange-300',
    callout:
      'border border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100',
  },
  outage: {
    label: 'Water outage',
    todo: 'Expect low pressure or no water while crews work. Afterwards the water may be discolored: wait 1–2 hours, then run the cold tap until it runs clear.',
    tag: 'text-gray-600 dark:text-gray-300',
    callout:
      'border border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200',
  },
};

/** 828-251-1122, or a local 259-5975 (area code 828) */
const PHONE_SPLIT_RE = /(\(?\b\d{3}\)?[-.\s]\d{3}[-.]\d{4}\b|\b\d{3}-\d{4}\b)/g;

/** The message with its phone numbers as tap-to-call links. */
function withPhoneLinks(text: string) {
  return text.split(PHONE_SPLIT_RE).map((part, i) => {
    // split() with a capture group puts the matches at the odd indexes
    if (i % 2 === 0) return part;
    const digits = part.replace(/\D/g, '');
    return (
      <a
        key={i}
        href={`tel:+1${digits.length === 7 ? `828${digits}` : digits}`}
        className="whitespace-nowrap font-medium text-brand-600 underline dark:text-brand-400"
      >
        {part}
      </a>
    );
  });
}

/**
 * Every active water notice, in full, in a native modal <dialog>: the browser
 * contains focus, makes the page inert, closes on Escape and returns focus to the
 * badge. Portaled to <body> because the mobile badge row lives in a container
 * that goes display:none at lg, which would hide an open dialog on rotation.
 */
export default function WaterAlertModal({ status, onClose }: WaterAlertModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isBoil = status.level === 'boil';
  const isMixed = isBoil && status.notices.some((n) => n.kind === 'outage');
  const heading = isBoil
    ? 'Boil water advisory'
    : status.notices.length === 1
      ? 'Water outage'
      : 'Water outages';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  // Every way out goes through dialog.close(), so the browser restores focus
  const close = () => dialogRef.current?.close();

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="water-alert-title"
      // The close event is queued; ignore one that lands after a re-open (Strict Mode)
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself is a click on its backdrop
        if (event.target === event.currentTarget) close();
      }}
      className="mt-auto mb-0 w-full max-w-none max-h-[90dvh] flex-col overflow-hidden border-0 bg-white p-0 text-gray-900 shadow-xl rounded-t-xl open:flex backdrop:bg-black/50 dark:bg-gray-900 dark:text-gray-100 sm:m-auto sm:max-w-lg sm:rounded-xl"
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-700 py-3 pl-5 pr-3">
        <div className="flex items-start gap-3 pt-1">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              isBoil
                ? 'bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400'
                : 'bg-gray-100 text-amber-500 dark:bg-gray-800 dark:text-amber-400'
            }`}
            aria-hidden="true"
          >
            <Droplet size={16} className={isBoil ? 'fill-current' : 'fill-amber-400'} />
          </span>
          <div>
            <h2 id="water-alert-title" className="text-lg font-bold">
              {heading}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {status.notices.length} active notice{status.notices.length === 1 ? '' : 's'} from the
              City of Asheville
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <X size={22} />
        </button>
      </div>

      <div className="min-h-0 flex-1 divide-y divide-gray-200 overflow-y-auto px-5 dark:divide-gray-700">
        {status.notices.map((notice) => {
          const kind = KIND[notice.kind];
          return (
            <article key={notice.id} className="py-4">
              {/* The kind is already the modal's title unless the list is mixed */}
              {isMixed && (
                <p className={`text-xs font-semibold uppercase tracking-wide ${kind.tag}`}>
                  {kind.label}
                </p>
              )}
              <h3 className="font-semibold leading-snug">
                {notice.area ?? notice.place ?? 'Asheville'}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {notice.scheduled && <>Scheduled {formatScheduled(notice.scheduled)} · </>}
                Posted {formatPosted(notice.postedAt)}
              </p>
              <div className={`mt-3 rounded-md px-3 py-2 text-sm ${kind.callout}`}>
                <span className="font-semibold">What to do: </span>
                {kind.todo}
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                The city&rsquo;s notice
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {withPhoneLinks(notice.message)}
              </p>
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <a
          href={CITY_WATER_ADVISORIES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand-600 hover:underline dark:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          All city water advisories
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={close}
          className="h-10 rounded-lg border border-gray-200 dark:border-gray-700 px-4 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Close
        </button>
      </div>
    </dialog>,
    document.body
  );
}
