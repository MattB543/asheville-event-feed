'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const MAX_LENGTH = 2000;

/**
 * "Missing a camp, or something wrong?" (01 §4.6) in a native modal <dialog>, opened from the AI
 * banner: one box, sent to Slack, nothing stored. On a camp's page it carries that camp's id. The
 * browser contains focus, makes the page inert, closes on Escape and returns focus to the banner's
 * link (the WaterAlertModal pattern).
 */
export default function CampFeedback({
  campId,
  campName,
  onClose,
}: {
  campId?: string;
  campName?: string;
  onClose: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    messageRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  // Every way out goes through dialog.close(), so the browser restores focus
  const close = () => dialogRef.current?.close();

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

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-heading`}
      // The close event is queued; ignore one that lands after a re-open (Strict Mode)
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself is a click on its backdrop
        if (event.target === event.currentTarget) close();
      }}
      className="mt-auto mb-0 w-full max-w-none max-h-[90dvh] flex-col overflow-hidden border-0 bg-white p-0 text-gray-900 shadow-xl rounded-t-xl open:flex backdrop:bg-black/50 dark:bg-gray-900 dark:text-gray-100 sm:m-auto sm:max-w-lg sm:rounded-xl"
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-700 py-3 pl-5 pr-3">
        <h2 id={`${id}-heading`} className="min-w-0 pt-1.5 text-lg font-bold leading-snug">
          {campName ? `Something wrong about ${campName}?` : 'Missing a camp, or something wrong?'}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <X size={22} />
        </button>
      </div>

      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-2 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <label htmlFor={`${id}-message`} className="block text-sm text-gray-600 dark:text-gray-400">
          {campName
            ? 'Tell us what’s missing or wrong, or what the camp’s site says. A link helps.'
            : 'Paste a link to a camp we’re missing, or tell us what’s wrong.'}
        </label>
        <textarea
          ref={messageRef}
          id={`${id}-message`}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            if (status !== 'sending') setStatus('idle');
          }}
          maxLength={MAX_LENGTH}
          rows={4}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={message.trim().length < 3 || status === 'sending'}
            className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
          >
            {status === 'sending' ? 'Sending…' : 'Send'}
          </button>
          <p aria-live="polite" className="text-sm text-gray-600 dark:text-gray-400">
            {status === 'sent' && 'Thanks! We read every one.'}
            {status === 'error' && 'That didn’t send. Please try again in a minute.'}
          </p>
        </div>
      </form>
    </dialog>,
    document.body
  );
}
