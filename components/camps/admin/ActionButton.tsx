'use client';

import {
  buttonClass,
  buttonTones,
  useCampAdminAction,
  type CampAdminAction,
} from './useCampAdminAction';

/** One button that sends one admin action, with its error underneath. */
export default function ActionButton({
  body,
  label,
  tone = 'plain',
}: {
  body: CampAdminAction;
  label: string;
  tone?: keyof typeof buttonTones;
}) {
  const { run, busy, error } = useCampAdminAction();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(body)}
        className={`${buttonClass} ${buttonTones[tone]}`}
      >
        {busy ? '…' : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
