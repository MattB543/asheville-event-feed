'use client';

import { useId, useState, type FormEvent } from 'react';

const MAX_LENGTH = 2000;

/**
 * "Missing a camp, or something wrong?" (01 §4.6): one box, sent to Slack, nothing stored. On a
 * camp's page it carries that camp's id.
 */
export default function CampFeedback({ campId, campName }: { campId?: string; campName?: string }) {
  const id = useId();
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (message.trim().length < 3 || status === 'sending') return;
    setStatus('sending');
    try {
      const response = await fetch('/api/camps/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), campId }),
      });
      if (!response.ok) throw new Error(`Feedback failed (${response.status})`);
      setMessage('');
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
    >
      <h2 id={`${id}-heading`} className="font-semibold text-gray-900 dark:text-gray-100">
        {campName ? `Something wrong about ${campName}?` : 'Missing a camp, or something wrong?'}
      </h2>
      <form onSubmit={(event) => void submit(event)} className="mt-2 space-y-2">
        <label htmlFor={`${id}-message`} className="block text-sm text-gray-600 dark:text-gray-400">
          {campName
            ? 'Tell us what the camp’s site says, or paste a link.'
            : 'Paste a link or tell us.'}
        </label>
        <textarea
          id={`${id}-message`}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            if (status !== 'sending') setStatus('idle');
          }}
          maxLength={MAX_LENGTH}
          rows={3}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={message.trim().length < 3 || status === 'sending'}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
          >
            {status === 'sending' ? 'Sending…' : 'Send'}
          </button>
          <p aria-live="polite" className="text-sm text-gray-600 dark:text-gray-400">
            {status === 'sent' && 'Thanks! We read every one.'}
            {status === 'error' && 'That didn’t send. Please try again in a minute.'}
          </p>
        </div>
      </form>
    </section>
  );
}
