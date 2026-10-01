'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';
import type { NewsSourceGroups, NewsSourceLink } from '@/lib/news/queries';

const GROUPS: { key: keyof NewsSourceGroups; title: string }[] = [
  { key: 'newsrooms', title: 'Newsrooms' },
  { key: 'official', title: 'Government & institutions' },
  { key: 'community', title: 'Community' },
];

/** The name with its ↗ glued to the last word, so a wrapped name never strands the arrow. */
function SourceName({ name }: { name: string }) {
  const cut = name.lastIndexOf(' ') + 1;
  return (
    <>
      {name.slice(0, cut)}
      <span className="whitespace-nowrap">
        {name.slice(cut)}
        <ArrowUpRight
          size={12}
          className="ml-1 inline-block -translate-y-px text-gray-400 dark:text-gray-500"
          aria-hidden="true"
        />
      </span>
    </>
  );
}

function SourceList({ title, sources }: { title: string; sources: NewsSourceLink[] }) {
  if (sources.length === 0) return null;

  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {sources.map((source) => (
          <li key={source.domain}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener"
              className="text-sm text-gray-800 dark:text-gray-200 hover:text-brand-700 dark:hover:text-brand-300 hover:underline"
            >
              <SourceName name={source.name} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "these sources": an inline link that opens the list of every source we read.
 * The dialog is portalled to <body>, since the link sits inside a sentence.
 */
export default function NewsSourcesModal({ groups }: { groups: NewsSourceGroups }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Locking the scroll takes the scrollbar away; padding in its place keeps
    // the page behind from shifting sideways.
    const { body } = document;
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    const trigger = triggerRef.current;

    return () => {
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  // Tab and Shift+Tab cycle inside the dialog, as in the other modals
  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    // Focus sits on the dialog itself after a click on its text
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="font-semibold text-brand-700 dark:text-brand-300 underline decoration-brand-200 dark:decoration-brand-700 underline-offset-2 hover:decoration-current cursor-pointer"
      >
        these sources
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="news-sources-title"
              onKeyDown={trapFocus}
              tabIndex={-1}
              className="relative focus:outline-none w-full sm:max-w-xl max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-5 sm:p-6 animate-fade-in"
            >
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>

              <h2
                id="news-sources-title"
                className="pr-8 text-lg font-bold text-gray-900 dark:text-gray-100"
              >
                Where the news comes from
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                AVL GO reads these newsrooms, public agencies and community forums. The headlines
                and summaries are ours, and every story links to the original.
              </p>

              <div className="mt-5 flex flex-col gap-5">
                {GROUPS.map(({ key, title }) => (
                  <SourceList key={key} title={title} sources={groups[key]} />
                ))}
                {GROUPS.every(({ key }) => groups[key].length === 0) && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Sources are listed here once their first stories are up.
                  </p>
                )}
              </div>

              <p className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-400">
                Want your outlet removed? Email{' '}
                <a
                  href="mailto:hello@avlgo.com"
                  className="font-medium text-brand-700 dark:text-brand-300 underline underline-offset-2"
                >
                  hello@avlgo.com
                </a>
                .
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
