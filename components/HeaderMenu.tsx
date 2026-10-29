'use client';

import { useId, useRef, useState, type MouseEvent } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import IntentLink from '@/components/IntentLink';
import { useDismiss } from '@/lib/hooks/useDismiss';

export interface HeaderMenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}

/** Desktop hover (or keyboard focus) opens the menu; a trigger with an href still links there. */
const HOVER_QUERY = '(pointer: fine) and (min-width: 1024px)';

const hovers = () => window.matchMedia(HOVER_QUERY).matches;

/**
 * A header tab with a menu of links underneath. At lg+ with a mouse the menu opens on hover (or
 * keyboard focus) and a label with an `href` is a plain link; on touch the label toggles the menu,
 * since there is no hover to reveal it. A label with no `href` only ever opens the menu. Every way
 * of opening goes through `isOpen`, so aria-expanded is always true while the menu shows and
 * Escape or a press outside always closes it.
 */
export default function HeaderMenu({
  label,
  href,
  className,
  items,
  align = 'left',
}: {
  label: string;
  href?: string;
  /** The tab's own look (active or idle) */
  className: string;
  items: HeaderMenuItem[];
  /** 'right' for a tab near the end of the row, so the menu stays on a phone's screen */
  align?: 'left' | 'right';
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useDismiss(isOpen, () => setIsOpen(false), [rootRef]);

  const trigger = {
    'aria-haspopup': 'true' as const,
    'aria-expanded': isOpen,
    'aria-controls': menuId,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (hovers()) return;
      event.preventDefault();
      setIsOpen((open) => !open);
    },
    className: `${className} gap-1`,
  };
  const triggerContent = (
    <>
      {label}
      <ChevronDown
        size={14}
        aria-hidden="true"
        className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
      />
    </>
  );

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => hovers() && setIsOpen(true)}
      onMouseLeave={() => hovers() && setIsOpen(false)}
      onFocus={() => hovers() && setIsOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      {href ? (
        <IntentLink href={href} {...trigger}>
          {triggerContent}
        </IntentLink>
      ) : (
        <button type="button" {...trigger}>
          {triggerContent}
        </button>
      )}
      {/* pt-1 bridges the gap so the pointer can travel from the tab into the menu. Its links
          keep viewport prefetch: they're display:none until the menu is opened */}
      <div
        id={menuId}
        className={`absolute top-full z-50 pt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${
          isOpen ? 'block' : 'hidden'
        }`}
      >
        <ul className="min-w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {items.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                onClick={() => setIsOpen(false)}
                aria-current={item.active ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-2 px-3 text-sm lg:min-h-9 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  item.active
                    ? 'font-semibold text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                <item.icon size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
