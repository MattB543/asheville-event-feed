'use client';

import { Share } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

interface ShareButtonProps {
  shortId: string;
  headline: string;
}

/**
 * The native share sheet on touch devices, copy-and-toast everywhere else.
 * Desktop Chrome has navigator.share too, but there the OS sheet is a detour
 * from what people expect a desktop "Share" to do.
 */
export default function ShareButton({ shortId, headline }: ShareButtonProps) {
  const { showToast } = useToast();

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied');
    } catch {
      showToast('Could not copy the link', 'error');
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/news?s=${shortId}`;
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
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 cursor-pointer transition-colors"
      aria-label={`Share: ${headline}`}
    >
      <Share size={14} aria-hidden="true" />
      Share
    </button>
  );
}
