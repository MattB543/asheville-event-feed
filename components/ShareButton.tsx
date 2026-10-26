'use client';

import { useEffect, useState } from 'react';
import { Share } from 'lucide-react';
import { TAP_AREA } from './news/display';
import { copyLink, shareLink, type ShareOutcome } from '@/lib/utils/shareLink';
import { SITE_URL } from '@/lib/seo/site';

interface ShareButtonProps {
  /** Site path to share, e.g. "/news?s=abc" */
  path: string;
  title: string;
  /** 'md' matches body text (text-sm, text-base from sm) for use beside a text link */
  size?: 'xs' | 'md';
}

/**
 * Shares or copies a link and says so in a bubble (`ShareNote`) over the button
 * that did it. The button's wrapper needs `relative`.
 */
export function useShareNote() {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 1800);
    return () => clearTimeout(timer);
  }, [note]);

  const report = (outcome: ShareOutcome) => {
    if (outcome === 'copied') setNote('Link copied');
    if (outcome === 'failed') setNote("Couldn't copy the link");
  };

  return {
    note,
    share: async (url: string, title: string) => report(await shareLink(url, title)),
    copy: async (url: string) => report(await copyLink(url)),
  };
}

export function ShareNote({ note }: { note: string | null }) {
  return (
    <span
      role="status"
      className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-md transition-opacity dark:bg-gray-100 dark:text-gray-900 ${
        note ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {note}
    </span>
  );
}

/** A Share button for a page on the site */
export default function ShareButton({ path, title, size = 'xs' }: ShareButtonProps) {
  const { note, share } = useShareNote();

  return (
    <button
      type="button"
      onClick={() => void share(`${SITE_URL}${path}`, title)}
      className={`${TAP_AREA} inline-flex items-center gap-1 rounded-md px-1.5 py-1 ${size === 'md' ? 'text-sm sm:text-base' : 'text-xs'} font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 cursor-pointer transition-colors`}
      aria-label={`Share: ${title}`}
    >
      <Share
        aria-hidden="true"
        className={size === 'md' ? 'h-4 w-4 sm:h-[18px] sm:w-[18px]' : 'h-3.5 w-3.5'}
      />
      Share
      <ShareNote note={note} />
    </button>
  );
}
