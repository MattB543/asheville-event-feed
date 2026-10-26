'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDismiss } from '@/lib/hooks/useDismiss';
import { LETTER_SOURCES, sourceDomain } from '@/lib/plan/letterSources';

/** Gap kept between the card and the viewport's edges */
const EDGE = 12;

const noSubscribe = () => () => {};

/**
 * A citation in the letter. The server HTML (and a visitor without JS) gets a plain
 * link to the numbered source at the foot of the page; once hydrated it becomes a
 * button that shows the source in a small card right there (on hover with a mouse, on
 * tap otherwise), so reading the letter never jumps to the bottom. A press outside,
 * Escape or tabbing away closes it.
 */
export default function SourceRef({ n }: { n: number }) {
  const source = LETTER_SOURCES[n - 1];
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLAnchorElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const cardId = useId();
  // Set while the card is open only because the mouse is over it
  const hoverOpened = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useDismiss(
    open,
    () => {
      hoverOpened.current = false;
      setOpen(false);
    },
    [rootRef],
    buttonRef
  );
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Centered under the number, but kept inside the viewport (a 360px phone included),
  // and flipped above the line when there's no room below. Measured before paint
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const root = rootRef.current;
      const card = cardRef.current;
      if (!root || !card) return;
      const anchor = root.getBoundingClientRect();
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const viewport = document.documentElement.clientWidth;
      const centered = anchor.left + anchor.width / 2 - width / 2;
      const left = Math.max(EDGE, Math.min(centered, viewport - EDGE - width));
      card.style.left = `${left - anchor.left}px`;
      const above =
        anchor.bottom + height + EDGE > window.innerHeight && anchor.top - height - EDGE > 0;
      card.style.top = above ? '' : 'calc(100% + 6px)';
      card.style.bottom = above ? 'calc(100% + 6px)' : '';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  if (!source) return null;
  const label = `Source ${n}: ${source.title}`;
  // The after: box widens the tap target past the tiny superscript without moving the text
  const numberClass =
    'relative after:absolute after:-inset-x-1.5 after:-inset-y-2 rounded px-0.5 font-semibold text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-brand-400';

  if (!hydrated) {
    return (
      <sup>
        <a href={`#src-${n}`} aria-label={label} className={numberClass}>
          {n}
        </a>
      </sup>
    );
  }

  return (
    <span
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      // A mouse opens it on hover; touch has no hover and keeps tap-to-open. The card is
      // inside this span, so moving onto it keeps it open, and the short delay covers the
      // gap between the number and the card
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(closeTimer.current);
        if (!open) {
          hoverOpened.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse' || !hoverOpened.current) return;
        closeTimer.current = setTimeout(() => {
          hoverOpened.current = false;
          setOpen(false);
        }, 200);
      }}
    >
      {/* A link acting as a button, not a <button>: a button lays out as an inline block,
          which the line can wrap in front of, leaving the number alone at a line's start */}
      <sup>
        <a
          ref={buttonRef}
          href={`#src-${n}`}
          role="button"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? cardId : undefined}
          onClick={(event) => {
            event.preventDefault();
            // A click on a card that hover opened pins it open instead of closing it
            if (hoverOpened.current) {
              hoverOpened.current = false;
              clearTimeout(closeTimer.current);
              return;
            }
            setOpen((wasOpen) => !wasOpen);
          }}
          onKeyDown={(event) => {
            // Links answer Enter on their own; a button also answers Space
            if (event.key !== ' ') return;
            event.preventDefault();
            setOpen((wasOpen) => !wasOpen);
          }}
          className={`${numberClass} cursor-pointer ${
            open ? 'bg-brand-50 dark:bg-brand-950/40' : ''
          }`}
        >
          {n}
        </a>
      </sup>
      {open && (
        <span
          ref={cardRef}
          id={cardId}
          className="absolute z-40 block w-[min(20rem,calc(100vw-24px))] rounded-lg border border-gray-200 bg-white p-3 text-left text-sm leading-snug font-normal not-italic shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">
            Source {n}
          </span>
          <span className="mt-1 block font-medium text-gray-900 dark:text-gray-100">
            {source.title}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
            {sourceDomain(source.url)}
          </span>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-8 items-center font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Open source ↗
          </a>
        </span>
      )}
    </span>
  );
}
