'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { formatDateEastern } from '@/lib/utils/timezone';
import type { ReviewQueue, ReviewRow, SignatureStatus } from '@/lib/letter/outagePlan';

type Decision = Exclude<SignatureStatus, 'pending'>;

const actionButton =
  'shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const buttonStyles: Record<Decision, string> = {
  approved: 'bg-green-600 text-white hover:bg-green-700',
  rejected:
    'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40',
};
const buttonLabels: Record<Decision, string> = { approved: 'Approve', rejected: 'Reject' };

function formatSigned(createdAt: string) {
  return formatDateEastern(new Date(createdAt), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Super-admin only: approve or take down the public signatures on /plan. `adminId` is the
 * account the page checked; the panel hides as soon as this tab is signed into another.
 */
export default function SignatureReview({
  queue,
  adminId,
}: {
  queue: ReviewQueue;
  adminId: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  // Every write refreshes the whole queue, so one at a time
  const locked = busyId !== null || refreshing;

  const decide = async ({ id, revision }: ReviewRow, status: Decision) => {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch('/api/admin/plan-signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, revision }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError({ id, message: body?.error ?? 'Could not save that' });
        // Changed since this list loaded: show it as it is now
        if (response.status === 409) startTransition(() => router.refresh());
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError({ id, message: 'Could not reach the server' });
    } finally {
      setBusyId(null);
    }
  };

  const rows = (list: ReviewRow[], actions: Decision[]) => (
    <ul className="divide-y divide-amber-200 dark:divide-amber-900/50">
      {list.map((row) => (
        <li key={row.id} className="py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-sm break-words">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{row.name}</span>
              {row.neighborhood && (
                <span className="text-gray-700 dark:text-gray-300"> — {row.neighborhood}</span>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {row.role && ` · ${row.role}`} · {formatSigned(row.createdAt)}
              </span>
            </p>
            <div className="flex shrink-0 gap-1.5">
              {actions.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={locked}
                  onClick={() => void decide(row, status)}
                  className={`${actionButton} ${buttonStyles[status]}`}
                  aria-label={`${buttonLabels[status]} ${row.name}`}
                >
                  {busyId === row.id ? '…' : buttonLabels[status]}
                </button>
              ))}
            </div>
          </div>
          {error?.id === row.id && (
            <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {error.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );

  if (user?.id !== adminId) return null;

  const summaryClass =
    'cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white';

  return (
    <div className="rounded-xl border border-dashed border-amber-400 bg-amber-50/60 p-4 dark:border-amber-700/70 dark:bg-amber-950/20">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
          Review public signatures
        </h2>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Admin · {queue.pending.length} waiting · {queue.approved.length} approved ·{' '}
          {queue.rejected.length} rejected
        </p>
      </div>

      {queue.pending.length === 0 ? (
        <p className="py-2 text-sm text-gray-600 dark:text-gray-400">Nothing waiting for review.</p>
      ) : (
        rows(
          // Oldest first, whatever order the query used
          [...queue.pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          ['approved', 'rejected']
        )
      )}

      {queue.approved.length > 0 && (
        <details className="mt-3">
          <summary className={summaryClass}>Approved ({queue.approved.length})</summary>
          {rows(queue.approved, ['rejected'])}
        </details>
      )}
      {queue.rejected.length > 0 && (
        <details className="mt-2">
          <summary className={summaryClass}>Rejected ({queue.rejected.length})</summary>
          {rows(queue.rejected, ['approved'])}
        </details>
      )}
    </div>
  );
}
