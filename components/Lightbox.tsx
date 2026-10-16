'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useModal } from '@/lib/hooks/useModal';

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

  useModal(true, onClose, dialogRef);

  // Latest handlers, so the arrow-key listener is bound once for the dialog's lifetime
  const handlers = useRef({ onPrev, onNext });
  useEffect(() => {
    handlers.current = { onPrev, onNext };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') handlers.current.onPrev?.();
      if (event.key === 'ArrowRight') handlers.current.onNext?.();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Moving to another item leaves the previous one's scroll position behind,
  // which lands the reader halfway down something they have not seen yet.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
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
