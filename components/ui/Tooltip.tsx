'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** A dotted underline hints that plain text has more to show */
  underline?: boolean;
}

/**
 * A small box over the trigger on hover, keyboard focus or a tap (phones have no
 * hover). Drawn in a portal at fixed coordinates, so a row that clips its overflow
 * can't cut it off.
 */
export default function Tooltip({
  content,
  children,
  className = '',
  underline = true,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // A tap both focuses and clicks; only the click should count, or it opens and shuts at once
  const pointer = useRef<string | null>(null);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Centered above the trigger, kept on screen; the box is at most 256px wide
    const left = Math.min(Math.max(rect.left + rect.width / 2, 136), window.innerWidth - 136);
    setPosition({ left, top: rect.top - 6 });
  };
  const hide = () => setPosition(null);

  // Scrolling moves the trigger out from under a fixed box, and a tap elsewhere closes it
  useEffect(() => {
    if (!position) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) hide();
    };
    // A real scroll, not the few pixels a phone may nudge the page on a tap
    const startY = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) > 10) hide();
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [position]);

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      aria-describedby={position ? id : undefined}
      // Pointer events with a type check: iOS also fires mouseenter on a tap, which
      // opened the box just before the tap's click closed it again
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') show();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') hide();
      }}
      onPointerDown={(event) => {
        pointer.current = event.pointerType;
      }}
      onFocus={() => {
        if (!pointer.current) show();
      }}
      onBlur={() => {
        pointer.current = null;
        hide();
      }}
      onClick={(event) => {
        // Mouse users already have hover; taps toggle
        if (pointer.current === 'mouse') return;
        event.stopPropagation();
        if (position) hide();
        else show();
      }}
      className={`cursor-default outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-sm ${
        underline ? 'underline decoration-dotted decoration-gray-400 underline-offset-2' : ''
      } ${className}`}
    >
      {children}
      {position &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ left: position.left, top: position.top }}
            className="pointer-events-none fixed z-[60] w-max max-w-64 -translate-x-1/2 -translate-y-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 shadow-lg animate-fade-in dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  );
}
