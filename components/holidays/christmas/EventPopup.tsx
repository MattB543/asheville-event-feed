'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { X } from 'lucide-react';

const dialogId = (eventId: string) => `xmas-event-${eventId}`;

/**
 * A link to the event's page that opens its popup instead. A new-tab click (or no script)
 * still goes to the page, and crawlers still follow the link.
 */
export function PopupLink({
  eventId,
  href,
  className,
  hidden,
  children,
}: {
  eventId: string;
  href: string;
  className?: string;
  /** For a second link to the same event (its poster): skipped by keyboards and readers */
  hidden?: boolean;
  children: ReactNode;
}) {
  const open = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const dialog = document.getElementById(dialogId(eventId)) as HTMLDialogElement | null;
    if (!dialog) return;
    e.preventDefault();
    dialog.showModal();
  };
  return (
    <Link
      href={href}
      onClick={open}
      className={className}
      {...(hidden ? { tabIndex: -1, 'aria-hidden': true } : {})}
    >
      {children}
    </Link>
  );
}

/** The event's popup: a card with its poster and details, closed by Escape, X or a click outside */
export function EventDialog({
  eventId,
  title,
  children,
}: {
  eventId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <dialog
      id={dialogId(eventId)}
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="xmas-pop m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-sm bg-[#f6efe2] p-0 text-[#10291f] shadow-[0_30px_80px_rgba(0,0,0,.6)] backdrop:bg-[#0b1f17]/80"
    >
      {/* The double gold border of a Christmas card */}
      <div className="relative m-2 border-[3px] border-double border-[#c9a24a] p-5 sm:p-7">
        <form method="dialog">
          <button
            type="submit"
            aria-label="Close"
            className="absolute right-2 top-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[#9f1239] hover:bg-[#9f1239]/10"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </form>
        {children}
      </div>
    </dialog>
  );
}
