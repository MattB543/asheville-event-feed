'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const LIGHTBOX_BUTTON_CLASSES =
  'p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-default transition-colors cursor-pointer';

interface LightboxProps {
  /** Read out by screen readers as the dialog's name */
  label: string;
  onClose: () => void;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  /** Left side of the top bar, e.g. prev/next buttons */
  headerStart?: ReactNode;
  /** Changing it scrolls back to the top, for a lightbox that steps through items */
  scrollKey?: string;
  children: ReactNode;
}

/**
 * A full-screen dark dialog: Escape and a click outside close it, arrow keys step
 * when prev/next are given, the page behind doesn't scroll, and focus stays inside.
 */
export default function Lightbox({
  label,
  onClose,
  onPrev,
  onNext,
  headerStart,
  scrollKey,
  children,
}: LightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Latest handlers, so the key listener can be bound once for the lifetime of
  // the dialog instead of rebinding on every change.
  const handlers = useRef({ onClose, onPrev, onNext });
  useEffect(() => {
    handlers.current = { onClose, onPrev, onNext };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Caught first (capture phase) so an event modal underneath doesn't close too
        event.stopImmediatePropagation();
        handlers.current.onClose();
        return;
      }

      if (event.key === 'ArrowLeft') handlers.current.onPrev?.();
      if (event.key === 'ArrowRight') handlers.current.onNext?.();
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Scroll lock plus focus handoff: focus moves in on open and back to whatever
  // opened it on close.
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

  // Moving to another item leaves the previous one's scroll position behind,
  // which lands the reader halfway down something they have not seen yet.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

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

  return (
    <div className="fixed inset-0 z-50 bg-black/90" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={trapFocus}
        onClick={(event) => event.stopPropagation()}
        className="absolute inset-0 flex flex-col outline-none"
      >
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 sm:px-5 py-3 text-white/60">
          <div className="flex items-center gap-1">{headerStart}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={LIGHTBOX_BUTTON_CLASSES}
          >
            <X size={22} />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 pb-12"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
