'use client';

import { useEffect, useState } from 'react';
import { Share } from 'lucide-react';
import { TAP_AREA } from './display';

// Share links always point at the live site, even from a preview or local build
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://avlgo.com';

interface ShareButtonProps {
  shortId: string;
  headline: string;
}

/**
 * The native share sheet on touch devices, copy-the-link everywhere else, with
 * a tooltip on the button saying it worked.
 * Desktop Chrome has navigator.share too, but there the OS sheet is a detour
 * from what people expect a desktop "Share" to do.
 */
export default function ShareButton({ shortId, headline }: ShareButtonProps) {
  const [tooltip, setTooltip] = useState<string | null>(null);

  useEffect(() => {
    if (!tooltip) return;
    const timer = setTimeout(() => setTooltip(null), 1800);
    return () => clearTimeout(timer);
  }, [tooltip]);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setTooltip('Link copied');
    } catch {
      setTooltip("Couldn't copy the link");
    }
  };

  const handleShare = async () => {
    const url = `${SITE_URL}/news?s=${shortId}`;
    const touch = window.matchMedia('(pointer: coarse)').matches;

    if (touch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: headline, url });
      } catch (error) {
        // Dismissing the sheet is not a failure
        if (error instanceof DOMException && error.name === 'AbortError') return;
        await copyLink(url);
      }
      return;
    }

    await copyLink(url);
  };

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      className={`${TAP_AREA} inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 cursor-pointer transition-colors`}
      aria-label={`Share: ${headline}`}
    >
      <Share size={14} aria-hidden="true" />
      Share
      <span
        role="status"
        className={`pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-md transition-opacity dark:bg-gray-100 dark:text-gray-900 ${
          tooltip ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {tooltip}
      </span>
    </button>
  );
}
