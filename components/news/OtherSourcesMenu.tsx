'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { outboundUrl, TAP_AREA } from './display';

interface OtherSourcesMenuProps {
  /** The outlets besides the lead, earliest first. */
  sources: { url: string; outletName: string }[];
  /** A Reddit thread about the story, listed below the outlets. */
  discussion?: { url: string; label: string } | null;
  /** Classes for the caret button, which carries the vertical bar as its left border. */
  triggerClassName: string;
}

/**
 * A caret after a story's link that drops down its other outlets and its
 * Reddit thread, so a multi-source story shows one link instead of a row of
 * badges.
 */
export default function OtherSourcesMenu({
  sources,
  discussion,
  triggerClassName,
}: OtherSourcesMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const count = sources.length + (discussion ? 1 : 0);

  // The menu's right edge lines up with the button's. When that would run it
  // off the left of the screen, anchor its left edge instead. The menu mounts
  // fresh on every open, so this starts from right-aligned each time.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu || menu.getBoundingClientRect().left >= 8) return;
    menu.style.right = 'auto';
    menu.style.left = '0';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex self-stretch">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${count} more ${count === 1 ? 'source' : 'sources'}`}
        className={`${TAP_AREA} inline-flex items-center cursor-pointer transition-colors ${triggerClassName}`}
      >
        <ChevronDown
          size={13}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className={`absolute right-0 top-full z-30 mt-1.5 w-max min-w-52 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1 shadow-lg`}
        >
          {sources.length > 0 && (
            <>
              <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                Also covered by
              </p>
              <ul>
                {sources.map((source) => (
                  <li key={source.url}>
                    <MenuLink
                      url={source.url}
                      label={source.outletName}
                      onClick={() => setOpen(false)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
          {discussion && (
            <div
              className={
                sources.length > 0
                  ? 'mt-1 border-t border-gray-200 dark:border-gray-700 pt-1'
                  : undefined
              }
            >
              <MenuLink
                url={discussion.url}
                label={discussion.label}
                onClick={() => setOpen(false)}
              />
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function MenuLink({ url, label, onClick }: { url: string; label: string; onClick: () => void }) {
  return (
    <a
      href={outboundUrl(url)}
      target="_blank"
      rel="noopener"
      onClick={onClick}
      className="flex items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-brand-700 dark:hover:text-brand-300"
    >
      <span className="truncate">{label}</span>
      <ArrowUpRight size={14} className="shrink-0 text-gray-400" aria-hidden="true" />
    </a>
  );
}
