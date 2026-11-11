'use client';

import Link from 'next/link';
import { useRef, type MouseEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

const dialogId = (eventId: string) => `holiday-event-${eventId}`;

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

/**
 * The event's popup, closed by Escape, X or a click outside. Each holiday page dresses it:
 * `className` for the card, `frameClass` for its border and `closeClass` for the X.
 */
export function EventDialog({
  eventId,
  title,
  className,
  frameClass,
  closeClass,
  children,
}: {
  eventId: string;
  title: string;
  className: string;
  frameClass: string;
  closeClass: string;
  children: ReactNode;
}) {
  const downOnBackdrop = useRef(false);
  return (
    <dialog
      id={dialogId(eventId)}
      aria-label={title}
      // A click on the backdrop closes it, but not a text selection dragged out of the card
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) e.currentTarget.close();
      }}
      className={`m-auto translate-y-0 opacity-100 transition-[opacity,translate] duration-200 ease-out starting:open:translate-y-3 starting:open:opacity-0 motion-reduce:transition-none max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-sm p-0 shadow-[0_30px_80px_rgba(0,0,0,.6)] ${className}`}
    >
      <div className={`relative m-2 p-5 sm:p-7 ${frameClass}`}>
        <form method="dialog">
          <button
            type="submit"
            aria-label="Close"
            className={`absolute right-2 top-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full ${closeClass}`}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </form>
        {children}
      </div>
    </dialog>
  );
}
