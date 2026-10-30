'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';

// Loaded on first open (or when the pointer reaches the button), so the directory's first load
// doesn't carry the chat, its Markdown renderer or its cards
const loadModal = () => import('./CampChatModal');
const CampChatModal = dynamic(loadModal, { ssr: false });
// A failed early load is retried when the modal renders
const preload = () => void loadModal().catch(() => {});

/**
 * "Ask AI" beside the directory's Filters button (06-ai-chat-plan §6). `directory` is the
 * directory's current view as URL parameters (its listKey); the modal reads it once, on open.
 */
export default function CampChatButton({
  directory,
  totalCount,
}: {
  directory: string;
  totalCount: number;
}) {
  // Mounted only while open: each open is a new conversation, and closing ends any request
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Ask AI about camps"
        aria-haspopup="dialog"
        onPointerEnter={preload}
        onFocus={preload}
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-brand-400 dark:hover:border-brand-500 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Sparkles size={15} aria-hidden="true" className="text-brand-600 dark:text-brand-400" />
        <span className="sm:hidden">AI</span>
        <span className="hidden sm:inline">Ask AI</span>
      </button>
      {open && (
        <CampChatModal
          onClose={() => setOpen(false)}
          directory={directory}
          totalCount={totalCount}
        />
      )}
    </>
  );
}
