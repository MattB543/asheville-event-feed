'use client';

import { useId, useRef, useState } from 'react';
import Image from 'next/image';
import { BellPlus, ChevronDown } from 'lucide-react';
import type { Audience } from '@/lib/camps/contract';
import type { ReminderDate } from '@/lib/camps/display';
import { useDismiss } from '@/lib/hooks/useDismiss';

/** w-56 */
const MENU_WIDTH = 224;

const itemClasses =
  'flex w-full items-start gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer focus-visible:outline-none focus-visible:bg-gray-100 dark:focus-visible:bg-gray-700';

/**
 * "Add reminder" as a calendar picker, like an event's: Google Calendar opens a date as a new
 * event (a link holds one, so several dates get a link each), Apple / Outlook downloads them all
 * as one .ics. Both go through /api/camps/[id]/reminder, which reads the camp's full card.
 */
export default function ReminderMenu({
  campId,
  audience = 'public',
  label,
  dates,
  className,
}: {
  campId: string;
  audience?: Audience;
  label: string;
  dates: ReminderDate[];
  className: string;
}) {
  const [open, setOpen] = useState(false);
  // The menu hangs from the button's left edge, or its right edge when it wouldn't fit on screen
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useDismiss(open, () => setOpen(false), [rootRef], triggerRef);

  const base = `/api/camps/${campId}/reminder`;
  const who = audience === 'public' ? '' : `audience=${audience}&`;
  const ics = audience === 'public' ? base : `${base}?audience=${audience}`;
  // The date exactly: kind, day and time (the audience is `who`)
  const google = (date: ReminderDate) =>
    `${base}?${who}calendar=google&kind=${date.kind}&date=${date.date}${
      date.time ? `&time=${date.time}` : ''
    }`;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={(event) => {
          const { left } = event.currentTarget.getBoundingClientRect();
          setAlignRight(left + MENU_WIDTH > window.innerWidth - 16);
          setOpen((current) => !current);
        }}
        className={`${className} cursor-pointer`}
      >
        <BellPlus size={14} aria-hidden="true" />
        {label}
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id={menuId}
          className={`absolute top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg ${
            alignRight ? 'right-0' : 'left-0'
          }`}
        >
          {dates.map((date) => (
            <a
              key={`${date.kind}-${date.date}-${date.time ?? ''}`}
              href={google(date)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => setOpen(false)}
              className={itemClasses}
            >
              <Image
                src="/google_cal.svg"
                alt=""
                width={14}
                height={14}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span className="min-w-0">
                Google Calendar
                {dates.length > 1 && (
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {date.label}
                  </span>
                )}
              </span>
            </a>
          ))}
          <a href={ics} rel="nofollow" onClick={() => setOpen(false)} className={itemClasses}>
            <svg
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            <span className="min-w-0">
              Apple / Outlook
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {dates.length > 1 ? `All ${dates.length} dates, as an .ics file` : 'An .ics file'}
              </span>
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
