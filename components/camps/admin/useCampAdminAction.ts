'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** A request to POST /api/admin/camps. */
export type CampAdminAction =
  | { action: 'confirm' | 'hide' | 'unhide' | 'clear_override'; id: string }
  | { action: 'override'; id: string; key: string; value: unknown }
  | { action: 'pin'; siteId: string; lat: number; lng: number };

/** Sends one admin action, then refreshes the page so every list shows the change. */
export function useCampAdminAction() {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = async (body: CampAdminAction): Promise<boolean> => {
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/camps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? `Could not save that (${response.status})`);
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError('Could not reach the server');
      return false;
    } finally {
      setSending(false);
    }
  };

  return { run, busy: sending || refreshing, error, setError };
}

export const buttonClass =
  'cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export const buttonTones = {
  primary: 'bg-green-600 text-white hover:bg-green-700',
  danger:
    'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40',
  plain:
    'border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
} as const;
