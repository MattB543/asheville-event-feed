'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, MapPin, Tag, Users } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { formatDateEastern } from '@/lib/utils/timezone';

export interface AdminQueueExtraction {
  id: string;
  ordinal: number;
  title: string;
  /** ISO string, or null when the poster gave no readable date */
  startDate: string | null;
  timeUnknown: boolean;
  location: string | null;
  organizer: string | null;
  description: string | null;
  price: string | null;
  rawText: string | null;
  outcome: string | null;
  eventSlug: string | null;
}

export interface AdminQueueUpload {
  id: string;
  status: string;
  safetyReason: string | null;
  /** Set when held as an adult-audience event rather than as unsafe content */
  adultReason: string | null;
  /** Hidden from the signed-out /posters feed, even after approval */
  adult: boolean;
  errorMessage: string | null;
  rawModelOutputExcerpt: string | null;
  /** Signed ingress URL while private, public URL once published */
  imageUrl: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  reviewedAt: string | null;
  extractions: AdminQueueExtraction[];
  /** Outcome of the last moderation action taken in this session, if it needs saying */
  notice?: string | null;
}

interface AdminPosterQueueProps {
  pending: AdminQueueUpload[];
  failed: AdminQueueUpload[];
  /** Server-computed super-admin flag; the API enforces it again */
  canModerate: boolean;
  /** True for the unfiltered view, where `pending` holds uploads of every status */
  showingAll?: boolean;
}

type ModerateAction = 'approve' | 'deny';

interface ModerateResponse {
  status?: string;
  createdCount?: number;
  failedCount?: number;
  hiddenCount?: number;
  restoredCount?: number;
  warning?: string;
  error?: string;
}

const STATUS_STYLES: Record<string, string> = {
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  published: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  denied: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  failed: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const STATUS_LABELS: Record<string, string> = {
  processing: 'Processing',
  pending_review: 'Pending review',
  published: 'Published',
  denied: 'Denied',
  failed: 'Failed',
};

function formatWhen(startDate: string | null, timeUnknown: boolean): string {
  if (!startDate) return 'No date';

  const date = new Date(startDate);
  const day = formatDateEastern(date, { weekday: 'short', month: 'short', day: 'numeric' });

  if (timeUnknown) return `${day} · Time TBD`;

  return `${day} · ${formatDateEastern(date, { hour: 'numeric', minute: '2-digit' })}`;
}

function formatUploadedAt(createdAt: string): string {
  return formatDateEastern(new Date(createdAt), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.failed
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

interface PosterQueueCardProps {
  upload: AdminQueueUpload;
  canModerate: boolean;
  busyAction: ModerateAction | null;
  onModerate: (uploadId: string, action: ModerateAction) => void;
}

function PosterQueueCard({ upload, canModerate, busyAction, onModerate }: PosterQueueCardProps) {
  const isPending = upload.status === 'pending_review';
  const isPublished = upload.status === 'published';
  const isDenied = upload.status === 'denied';
  const canApprove = canModerate && (isPending || isPublished || isDenied);
  // A denied card offers only Approve: the badge already says it is denied, so
  // a Deny button there reads as a no-op. Re-running a half-finished takedown
  // is still possible through the API, which accepts deny on a denied upload.
  const canDeny = canModerate && (isPending || isPublished);
  const busy = busyAction !== null;

  return (
    <article className="flex flex-col sm:flex-row gap-4 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
      <div className="sm:w-44 sm:flex-shrink-0">
        {upload.imageUrl ? (
          <a
            href={upload.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open full size"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={upload.imageUrl}
              alt={`Poster upload ${upload.id.slice(0, 8)}`}
              loading="lazy"
              className="w-full max-h-72 sm:max-h-none object-contain sm:object-cover sm:aspect-[3/4] rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          </a>
        ) : (
          <div className="w-full sm:aspect-[3/4] rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 p-2 text-center">
            Image unavailable
          </div>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {formatUploadedAt(upload.createdAt)}
        </p>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={upload.status} />
          {upload.adult && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
              title="Hidden from the signed-out /posters feed, even once approved"
            >
              <Users size={12} />
              Adult
            </span>
          )}
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
            {upload.id.slice(0, 8)}
          </span>
          {upload.reviewedAt && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Reviewed {formatUploadedAt(upload.reviewedAt)}
            </span>
          )}
        </div>

        {upload.safetyReason && (
          <p className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span className="break-words">
              <span className="font-medium">Safety: </span>
              {upload.safetyReason}
            </span>
          </p>
        )}

        {upload.adultReason && (
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <Users size={14} className="flex-shrink-0 mt-0.5" />
            <span className="break-words">
              <span className="font-medium">Adult audience: </span>
              {upload.adultReason}
            </span>
          </p>
        )}

        {upload.notice && (
          <p className="text-sm text-amber-700 dark:text-amber-400 break-words">{upload.notice}</p>
        )}

        {upload.errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400 break-words">
            {upload.errorMessage}
          </p>
        )}

        {upload.extractions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No extracted events. Approving publishes the image on its own.
          </p>
        ) : (
          <ul className="space-y-3">
            {upload.extractions.map((extraction) => (
              <li key={extraction.id} className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 break-words">
                    {extraction.title}
                  </span>
                  {extraction.outcome && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {extraction.eventSlug ? (
                        <Link
                          href={`/events/${extraction.eventSlug}`}
                          className="underline hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          {extraction.outcome}
                        </Link>
                      ) : (
                        extraction.outcome
                      )}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={14} className="flex-shrink-0" />
                    {formatWhen(extraction.startDate, extraction.timeUnknown)}
                  </span>
                  {extraction.location && (
                    <span className="inline-flex items-center gap-1 min-w-0">
                      <MapPin size={14} className="flex-shrink-0" />
                      <span className="truncate">{extraction.location}</span>
                    </span>
                  )}
                  {extraction.price && (
                    <span className="inline-flex items-center gap-1">
                      <Tag size={14} className="flex-shrink-0" />
                      {extraction.price}
                    </span>
                  )}
                  {extraction.organizer && (
                    <span className="truncate text-gray-500 dark:text-gray-500">
                      {extraction.organizer}
                    </span>
                  )}
                </div>

                {extraction.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 break-words">
                    {extraction.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {upload.rawModelOutputExcerpt && (
          <details className="text-xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer">Model output</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-800 rounded p-2">
              {upload.rawModelOutputExcerpt}
            </pre>
          </details>
        )}

        {(canApprove || canDeny) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {canApprove && (
              <button
                onClick={() => onModerate(upload.id, 'approve')}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-white bg-brand-600 rounded hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
              >
                {busyAction === 'approve'
                  ? isDenied
                    ? 'Restoring...'
                    : 'Approving...'
                  : isDenied
                    ? 'Approve'
                    : isPublished
                      ? 'Retry events'
                      : 'Approve'}
              </button>
            )}
            {canDeny && (
              <button
                onClick={() => onModerate(upload.id, 'deny')}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {busyAction === 'deny' ? 'Denying...' : isPublished ? 'Take down' : 'Deny'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function AdminPosterQueue({
  pending,
  failed,
  canModerate,
  showingAll = false,
}: AdminPosterQueueProps) {
  const { showToast } = useToast();
  const [uploads, setUploads] = useState(pending);
  const [busy, setBusy] = useState<Record<string, ModerateAction>>({});

  const settleUpload = (uploadId: string, status: string, notice: string | null) => {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === uploadId
          ? { ...upload, status, notice, reviewedAt: new Date().toISOString() }
          : upload
      )
    );
  };

  const handleModerate = (uploadId: string, action: ModerateAction) => {
    const upload = uploads.find((item) => item.id === uploadId);

    // Taking down a live poster deletes its public image and hides its events,
    // which is not something to do on a stray click.
    if (
      action === 'deny' &&
      (upload?.status === 'published' || upload?.status === 'denied') &&
      !window.confirm('Take this poster down? Its public image is deleted and its events hidden.')
    ) {
      return;
    }

    // The mirror image: approving a denied upload republishes an image someone
    // deliberately removed and un-hides its events.
    if (
      action === 'approve' &&
      upload?.status === 'denied' &&
      !window.confirm('Approve this denied poster? Its image goes back up and its events unhide.')
    ) {
      return;
    }

    setBusy((current) => ({ ...current, [uploadId]: action }));

    void (async () => {
      try {
        const response = await fetch(`/api/posters/${uploadId}/moderate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });

        const data = (await response.json()) as ModerateResponse;

        if (!response.ok) {
          showToast(data.error ?? 'Moderation failed', 'error');
          return;
        }

        const status = data.status ?? (action === 'approve' ? 'published' : 'denied');

        // A partial approve stays on the card: a toast that says "Published"
        // and disappears would hide the fact that events are still missing.
        if (data.warning) {
          settleUpload(uploadId, status, data.warning);
          showToast(data.warning, 'error');
          return;
        }

        settleUpload(uploadId, status, null);

        if (action === 'approve') {
          const created = data.createdCount ?? 0;
          const restored = data.restoredCount ?? 0;
          const parts = [
            created > 0 ? `${created} event${created === 1 ? '' : 's'} added` : null,
            restored > 0 ? `${restored} event${restored === 1 ? '' : 's'} restored` : null,
          ].filter(Boolean);

          showToast(parts.length > 0 ? `Published. ${parts.join(', ')}.` : 'Published.');
        } else {
          const hidden = data.hiddenCount ?? 0;
          showToast(
            hidden > 0 ? `Denied. ${hidden} event${hidden === 1 ? '' : 's'} hidden.` : 'Denied.'
          );
        }
      } catch (error) {
        console.error('[Posters] Moderation request failed:', error);
        showToast('Moderation failed', 'error');
      } finally {
        setBusy((current) => {
          const rest = { ...current };
          delete rest[uploadId];
          return rest;
        });
      }
    })();
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        {uploads.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            <p className="text-gray-600 dark:text-gray-400">
              {showingAll ? 'No uploads yet.' : 'Nothing is waiting for review.'}
            </p>
          </div>
        ) : (
          uploads.map((upload) => (
            <PosterQueueCard
              key={upload.id}
              upload={upload}
              canModerate={canModerate}
              busyAction={busy[upload.id] ?? null}
              onModerate={handleModerate}
            />
          ))
        )}
      </section>

      {failed.length > 0 && (
        <section className="space-y-4">
          <div className="pt-4 border-t border-gray-200 dark:border-gray-800">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Recent failures
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              These never produced extractions, so there is nothing to approve. Kept for debugging.
            </p>
          </div>

          {failed.map((upload) => (
            <PosterQueueCard
              key={upload.id}
              upload={upload}
              canModerate={canModerate}
              busyAction={null}
              onModerate={handleModerate}
            />
          ))}
        </section>
      )}
    </div>
  );
}
