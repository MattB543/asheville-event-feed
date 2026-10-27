'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CandidateResponse } from '@/lib/plan/candidates';

/** Widest the box gets; narrower on phones */
const MAX_WIDTH = 384;
const GAP = 6;

interface Placement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * The yes/no badge on a candidate card, opening their full reply on hover,
 * keyboard focus or a tap (phones have no hover). Like components/ui/Tooltip,
 * but the reply is long: the box sits on whichever side of the badge has more
 * room, scrolls, and stays open while the pointer is over it.
 */
export default function ResponseBadge({
  name,
  response,
}: {
  name: string;
  response: CandidateResponse;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // A tap both focuses and clicks; only the click should count, or it opens and shuts at once
  const pointer = useRef<string | null>(null);
  // Crossing the gap from badge to box must not close it
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const yes = response.answers.filter(Boolean).length;
  const total = response.answers.length;
  const allYes = yes === total;

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => {
    cancelClose();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(MAX_WIDTH, window.innerWidth - 16);
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
    const above = rect.top - GAP - 8;
    const below = window.innerHeight - rect.bottom - GAP - 8;
    setPlacement(
      below >= above
        ? { left, width, top: rect.bottom + GAP, maxHeight: below }
        : { left, width, bottom: window.innerHeight - rect.top + GAP, maxHeight: above }
    );
  };
  const hide = () => {
    cancelClose();
    setPlacement(null);
  };
  const hideSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(hide, 150);
  };

  useEffect(() => cancelClose, []);

  // Scrolling the page moves the badge out from under a fixed box; a tap elsewhere or Escape closes it
  useEffect(() => {
    if (!placement) return undefined;
    const inside = (target: EventTarget | null) =>
      !!target &&
      (triggerRef.current?.contains(target as Node) || boxRef.current?.contains(target as Node));
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    // A real page scroll, not the box's own scrolling or the few pixels a phone nudges on a tap
    const startY = window.scrollY;
    const onScroll = (event: Event) => {
      if (inside(event.target)) return;
      if (Math.abs(window.scrollY - startY) > 10) hide();
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [placement]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={!!placement}
        aria-controls={placement ? id : undefined}
        // Pointer events with a type check: iOS also fires mouseenter on a tap
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') show();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') hideSoon();
        }}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        onFocus={() => {
          if (!pointer.current) show();
        }}
        onBlur={(event) => {
          pointer.current = null;
          // Tabbing into the box keeps it open
          if (!boxRef.current?.contains(event.relatedTarget as Node | null)) hideSoon();
        }}
        onClick={() => {
          // Mouse users already have hover; taps toggle
          if (pointer.current === 'mouse') return;
          if (placement) hide();
          else show();
        }}
        className={`mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] whitespace-nowrap sm:px-2 sm:text-xs font-medium underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
          allYes
            ? 'bg-green-50 text-green-700 decoration-green-700/50 dark:bg-green-950/40 dark:text-green-400 dark:decoration-green-400/50'
            : 'bg-amber-50 text-amber-700 decoration-amber-700/50 dark:bg-amber-950/40 dark:text-amber-400 dark:decoration-amber-400/50'
        }`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        {allYes ? `Yes to all ${total}` : `Yes to ${yes} of ${total}`}
      </button>
      {placement &&
        createPortal(
          <div
            ref={boxRef}
            id={id}
            role="dialog"
            aria-label={`${name}'s response`}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') cancelClose();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') hideSoon();
            }}
            style={{
              left: placement.left,
              width: placement.width,
              top: placement.top,
              bottom: placement.bottom,
              maxHeight: placement.maxHeight,
            }}
            className="fixed z-[60] overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-3 text-left text-xs leading-relaxed text-gray-700 shadow-lg animate-fade-in sm:text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {name}&apos;s response, unedited
            </p>
            {/* Every line break gets the same gap as a paragraph break; single breaks alone looked cramped */}
            <div className="space-y-2.5">
              {response.statement
                .split('\n')
                .filter((line) => line.trim())
                .map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
