'use client';

import { useId, useRef, useState } from 'react';
import { useDismiss } from '@/lib/hooks/useDismiss';

/**
 * "+2" after a card's chips, for the categories that don't fit: hovering shows them (where there's
 * a mouse), and so does a tap or click.
 */
export default function MoreTagsChip({
  labels,
  chipClasses,
}: {
  labels: string[];
  chipClasses: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  useDismiss(open, () => setOpen(false), [rootRef], triggerRef);

  return (
    <span ref={rootRef} className="group relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${labels.length} more: ${labels.join(', ')}`}
        onClick={() => setOpen((current) => !current)}
        className={`${chipClasses} block cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
      >
        +{labels.length}
      </button>
      <span
        id={listId}
        className={`absolute right-0 top-full z-20 mt-1 w-max max-w-56 flex-col gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1.5 shadow-lg ${
          open ? 'flex' : 'hidden [@media(hover:hover)]:group-hover:flex'
        }`}
      >
        {labels.map((label) => (
          <span key={label} className={chipClasses}>
            {label}
          </span>
        ))}
      </span>
    </span>
  );
}
