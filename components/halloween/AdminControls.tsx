'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ImageUp, Sparkles, type LucideIcon } from 'lucide-react';

interface AdminControlsProps {
  season: string;
  eventId: string;
  hidden: boolean;
  /** Added to the wall by hand; its button takes it back off */
  added?: boolean;
  /** `overlay` floats over a poster and shows on hover (always on touch screens) */
  variant?: 'inline' | 'overlay';
}

// The host refuses request bodies over about 4.5 MB, which many phone photos are; the
// server re-encodes anyway, so a 2000px JPEG loses nothing it would keep
const UPLOAD_MAX_SIDE = 2000;

async function shrinkForUpload(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88)
    );
    return blob ?? file;
  } catch {
    // A format the browser can't draw goes up as is, and the server says if it's too big
    return file;
  }
}

/** Super-admin only: hide an event from a holiday page, take a hand-added one off, or give it a poster */
export default function AdminControls({
  season,
  eventId,
  hidden,
  added = false,
  variant = 'inline',
}: AdminControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const send = (init: RequestInit) =>
    startTransition(async () => {
      setError(null);
      const response = await fetch('/api/admin/season-picks', { method: 'POST', ...init });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not save that');
        return;
      }
      router.refresh();
    });

  const toggle = (change: { hidden?: boolean; added?: boolean }) =>
    send({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, eventId, ...change }),
    });

  const iconClass =
    'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[#7a5426]/60 bg-black/75 text-[#ffd7a8] hover:bg-black/90 disabled:opacity-50';
  // The name shows above the icon on hover or keyboard focus
  const tip = (label: string) => (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-2 py-1 text-xs font-medium text-[#ffd7a8] opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100"
    >
      {label}
    </span>
  );
  // Lit while the edit is on
  const iconButton = (label: string, Icon: LucideIcon, onClick: () => void, on = false) => (
    <button
      type="button"
      disabled={pending}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`group/tip relative ${iconClass} ${on ? '!border-[#ff8a1f] !bg-[#ff8a1f] !text-[#1a0a00]' : ''}`}
    >
      <Icon size={14} aria-hidden="true" />
      {tip(label)}
    </button>
  );

  return (
    <div
      className={
        variant === 'overlay'
          ? 'absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100'
          : 'relative z-10 flex shrink-0 items-center gap-1'
      }
    >
      {added &&
        iconButton(
          'Added by hand: click to take off the wall',
          Sparkles,
          () => toggle({ added: false }),
          true
        )}
      {iconButton(
        hidden ? 'Hidden: click to show' : 'Hide from this page',
        hidden ? Eye : EyeOff,
        () => toggle({ hidden: !hidden }),
        hidden
      )}
      {/* A label opens the file picker itself, so the upload needs no ref */}
      <label aria-label="Upload a poster" className={`group/tip relative ${iconClass}`}>
        <ImageUp size={14} aria-hidden="true" />
        {tip('Upload a poster')}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void shrinkForUpload(file).then((image) => {
              const form = new FormData();
              form.set('season', season);
              form.set('eventId', eventId);
              form.set('poster', image, 'poster.jpg');
              send({ body: form });
            });
          }}
        />
      </label>
      {error && (
        <span role="alert" className="rounded bg-black/80 px-1.5 text-xs text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
