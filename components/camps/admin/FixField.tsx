'use client';

import { useState } from 'react';
import type { CampCard } from '@/lib/camps/contract';
import { buttonClass, buttonTones, useCampAdminAction } from './useCampAdminAction';

/**
 * Edit one top-level field of the card as JSON. Saving keeps the camp's other fixes; the server
 * checks the value against the shape Sol's extraction schema gives that field.
 */
export default function FixField({
  id,
  card,
  cardKeys,
}: {
  id: string;
  /** The effective card, so the textarea starts from what parents see now. */
  card: CampCard;
  cardKeys: Array<keyof CampCard>;
}) {
  const [key, setKey] = useState<keyof CampCard | ''>('');
  const [text, setText] = useState('');
  const { run, busy, error, setError } = useCampAdminAction();

  const pick = (next: keyof CampCard | '') => {
    setKey(next);
    setText(next ? JSON.stringify(card[next] ?? null, null, 2) : '');
    setError(null);
  };

  const save = async () => {
    if (!key) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (parseError) {
      setError(
        `Not valid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
      return;
    }
    if (await run({ action: 'override', id, key, value })) pick('');
  };

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">
        Fix a field
      </summary>
      <div className="mt-2 space-y-2">
        <select
          value={key}
          onChange={(event) => pick(event.target.value as keyof CampCard | '')}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 sm:w-auto dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          aria-label="Field to fix"
        >
          <option value="">Pick a field…</option>
          {cardKeys.map((cardKey) => (
            <option key={cardKey} value={cardKey}>
              {cardKey}
            </option>
          ))}
        </select>
        {key && (
          <>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={Math.min(24, Math.max(3, text.split('\n').length + 1))}
              spellCheck={false}
              className="block w-full rounded-md border border-gray-300 bg-white p-2 font-mono text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              aria-label={`New value for ${key}, as JSON`}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className={`${buttonClass} ${buttonTones.primary}`}
            >
              {busy ? '…' : `Save ${key}`}
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
