'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ImageUp, Pencil, Undo2 } from 'lucide-react';
import { TEXT_EDIT_FIELDS, type LockedField, type TextEditField } from '@/lib/events/edits';
import { shrinkForUpload } from '@/lib/utils/shrinkForUpload';

interface AdminEventPanelProps {
  eventId: string;
  values: Record<TextEditField, string | null>;
  hidden: boolean;
  /** Fields an admin has edited, which the scrape now leaves alone */
  edited: LockedField[];
}

const LABELS: Record<LockedField, string> = {
  title: 'Title',
  location: 'Venue',
  price: 'Price',
  imageUrl: 'Poster',
};

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:border-brand-400 cursor-pointer disabled:opacity-50';
const INPUT =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/** Admins only: fix an event's details, hide it, or give it a poster, kept through later scrapes */
export default function AdminEventPanel({ eventId, values, hidden, edited }: AdminEventPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values);
  const fileInput = useRef<HTMLInputElement>(null);

  // Any saved change closes the form, so it never shows values from before it
  const send = (init: RequestInit) =>
    startTransition(async () => {
      setError(null);
      const response = await fetch('/api/admin/events', { method: 'POST', ...init });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not save that');
        return;
      }
      setEditing(false);
      router.refresh();
    });

  const sendJson = (body: object) =>
    send({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, ...body }),
    });

  const save = () => {
    const edit = Object.fromEntries(
      TEXT_EDIT_FIELDS.filter((field) => (draft[field] ?? '') !== (values[field] ?? '')).map(
        (field) => [field, draft[field] ?? '']
      )
    );
    if (Object.keys(edit).length === 0) return setEditing(false);
    sendJson({ edit });
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 mb-6 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Admin
          {hidden && (
            <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-200">
              Hidden from the site
            </span>
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            onClick={() => {
              setDraft(values);
              setEditing(!editing);
            }}
          >
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            onClick={() => sendJson({ hidden: !hidden })}
          >
            {hidden ? (
              <Eye size={14} aria-hidden="true" />
            ) : (
              <EyeOff size={14} aria-hidden="true" />
            )}
            {hidden ? 'Show' : 'Hide'}
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            onClick={() => fileInput.current?.click()}
          >
            <ImageUp size={14} aria-hidden="true" /> Poster
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void shrinkForUpload(file).then((image) => {
                const form = new FormData();
                form.set('eventId', eventId);
                form.set('poster', image, 'poster.jpg');
                send({ body: form });
              });
            }}
          />
          {edited.length > 0 && (
            <button
              type="button"
              className={BUTTON}
              disabled={pending}
              onClick={() => sendJson({ undo: true })}
            >
              <Undo2 size={14} aria-hidden="true" /> Undo edits
            </button>
          )}
        </div>
      </div>

      {edited.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Edited: {edited.map((field) => LABELS[field]).join(', ')}. Scrapes keep these as you left
          them.
        </p>
      )}

      {editing && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {TEXT_EDIT_FIELDS.map((field) => (
            <label key={field} className="block">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {LABELS[field]}
              </span>
              <input
                className={INPUT}
                value={draft[field] ?? ''}
                required={field === 'title'}
                maxLength={300}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-600 hover:bg-brand-700 px-3 py-1.5 text-sm font-medium text-white cursor-pointer disabled:opacity-50"
            >
              Save
            </button>
            <button type="button" className={BUTTON} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
