'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle, Info, Loader2, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

interface PosterUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** One extraction as the upload route serializes it. */
interface UploadExtraction {
  title: string;
  startDate: string | null;
  outcome: string | null;
  eventSlug: string | null;
}

/** Every shape POST /api/posters/upload can answer with. */
interface UploadResponse {
  uploadId?: string;
  status?: string;
  capped?: boolean;
  warning?: string;
  extractions?: UploadExtraction[];
  duplicateOf?: string;
  message?: string;
  error?: string;
}

interface UploadResult {
  fileName: string;
  tone: 'success' | 'info' | 'error';
  message: string;
  detail?: string;
  /** Abandon any remaining files in this batch */
  stop?: boolean;
}

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

/**
 * Cap on an original we could not compress. The route allows 10 MB, but Vercel
 * rejects a request body over ~4.5 MB before the route ever sees it, so
 * anything larger than this would be a doomed upload.
 */
const MAX_FALLBACK_BYTES = 4 * 1024 * 1024;

/**
 * Copy for a stopped upload. The abort only ends our wait: the route does not
 * observe request.signal, so work already on the server runs to completion.
 */
const CANCELLED_MESSAGE =
  'Upload cancelled — anything that already reached the server may still be processed and appear on the feed.';

/**
 * Client-side ceiling on one request. The server may legitimately spend a while
 * on the vision call, but without a limit a hung connection would pin the modal
 * in its busy state forever.
 */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Shrink and re-encode client-side so a phone photo fits under Vercel's ~4.5 MB
 * body cap. Same approach as the matching onboarding bookshelf upload.
 *
 * Rejects on any format the browser cannot decode into an <img> - notably HEIC
 * outside Safari - which the caller handles by sending the original bytes.
 */
async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { naturalWidth: w, naturalHeight: h } = img;

      if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Compression failed'));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

function summarizeExtractions(extractions: UploadExtraction[]): string {
  if (extractions.length === 0) {
    return 'Poster saved, but no event details were read from it.';
  }

  const created = extractions.filter((item) => item.outcome === 'created').length;
  const matched = extractions.filter((item) => item.outcome === 'matched_existing').length;
  const other = extractions.length - created - matched;

  const parts: string[] = [];
  if (created > 0) parts.push(`${created} added`);
  if (matched > 0) parts.push(`${matched} already listed`);
  if (other > 0) parts.push(`${other} skipped`);

  const found = `Found ${extractions.length} event${extractions.length === 1 ? '' : 's'}!`;
  return parts.length > 0 ? `${found} ${parts.join(', ')}` : found;
}

const toneStyles: Record<UploadResult['tone'], string> = {
  success:
    'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300',
  info: 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  error:
    'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300',
};

const toneIcons: Record<UploadResult['tone'], typeof CheckCircle> = {
  success: CheckCircle,
  info: Info,
  error: AlertCircle,
};

function cancelledResult(fileName: string): UploadResult {
  return { fileName, tone: 'info', message: CANCELLED_MESSAGE, stop: true };
}

export default function PosterUploadModal({ isOpen, onClose }: PosterUploadModalProps) {
  const { user, session, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Distinguishes "the user cancelled" from "the request died on its own". */
  const cancelledRef = useRef(false);

  const [phase, setPhase] = useState<'idle' | 'compressing' | 'reading'>('idle');
  /** True from the moment a cancel is requested until the batch loop unwinds. */
  const [isCancelling, setIsCancelling] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  /** Access token that came back 401, so a re-auth clears the prompt by itself. */
  const [expiredToken, setExpiredToken] = useState<string | null>(null);

  const isBusy = phase !== 'idle';
  const sessionExpired = expiredToken !== null && expiredToken === (session?.access_token ?? null);
  // Auth resolves client-side, so the file picker stays hidden until we know
  // whether this visitor is signed in - offering it first would end in a 401.
  const needsSignIn = !user || sessionExpired;

  /**
   * Abandon the batch. The flag is what actually stops it: a cancel during the
   * compression step has no request to abort yet, and the loop checks the flag
   * again before it can start the next one.
   */
  const cancelUpload = useCallback(() => {
    cancelledRef.current = true;
    setIsCancelling(true);
    abortRef.current?.abort();
  }, []);

  // While a request is in flight the same control cancels instead of closing,
  // so a hung upload can never trap the user in the dialog. A second press
  // closes immediately rather than waiting for the loop to unwind.
  const handleCloseOrCancel = useCallback(() => {
    if (isBusy && !isCancelling) {
      cancelUpload();
      return;
    }

    cancelledRef.current = true;
    abortRef.current?.abort();
    onClose();
  }, [cancelUpload, isBusy, isCancelling, onClose]);

  // Reset between openings so a previous run's summary does not greet the next
  // upload.
  useEffect(() => {
    if (isOpen) return;
    setResults([]);
    setPhase('idle');
    setIsCancelling(false);
    setCurrentFile(null);
    setExpiredToken(null);
  }, [isOpen]);

  // Scroll lock plus focus handoff: focus moves into the dialog on open and
  // back to whatever opened it on close.
  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget = dialogRef.current?.querySelector<HTMLElement>(
      'button, input, a[href], [tabindex]:not([tabindex="-1"])'
    );
    (focusTarget ?? dialogRef.current)?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  // A modal torn down mid-upload should not leave the request running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handleCloseOrCancel();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null);

    if (focusable.length === 0) {
      // Nothing tabbable left: hold focus on the dialog rather than letting it
      // escape to the page behind.
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const uploadOne = async (file: File): Promise<UploadResult> => {
    setCurrentFile(file.name);
    setPhase('compressing');

    let payload: Blob = file;
    let payloadName = file.name || 'poster';

    try {
      payload = await compressImage(file);
      payloadName = 'poster.jpg';
    } catch (error) {
      // Only Safari can decode HEIC into a canvas, so a decode failure is not
      // proof the file is unusable. If it is small enough to survive the
      // platform body limit, send the original bytes with whatever type the
      // browser gave them and let sharp be the authority on the format.
      console.error('[Posters] Client-side decode failed:', error);

      if (file.size > MAX_FALLBACK_BYTES) {
        return {
          fileName: file.name,
          tone: 'error',
          message: "Your browser couldn't read that image — try a JPEG or PNG.",
        };
      }
    }

    // Compression is not abortable, so a cancel during it is honoured here.
    if (cancelledRef.current) return cancelledResult(file.name);

    setPhase('reading');

    const formData = new FormData();
    formData.append('image', payload, payloadName);

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(
      () => controller.abort(new DOMException('Upload timed out', 'TimeoutError')),
      REQUEST_TIMEOUT_MS
    );

    let response: Response;
    try {
      // Last gate before the request leaves: a cancel raised while the
      // controller was being wired must not let another upload start.
      if (cancelledRef.current) return cancelledResult(file.name);

      response = await fetch('/api/posters/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
    } catch (error) {
      if (cancelledRef.current) return cancelledResult(file.name);

      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      console.error('[Posters] Upload request failed:', error);
      return {
        fileName: file.name,
        tone: 'error',
        message: timedOut
          ? 'That upload took too long, so we stopped waiting. It may still finish on the server and appear on the feed.'
          : 'Network error. Please check your connection and try again.',
      };
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
    }

    let data: UploadResponse = {};
    try {
      data = (await response.json()) as UploadResponse;
    } catch {
      // A body-less error still has a status worth reporting.
    }

    if (response.status === 401) {
      setExpiredToken(session?.access_token ?? null);
      return {
        fileName: file.name,
        tone: 'error',
        message: 'Sign in to upload posters.',
        stop: true,
      };
    }

    if (response.status === 429) {
      // Every remaining file in the batch would hit the same wall.
      return {
        fileName: file.name,
        tone: 'error',
        message: data.error ?? 'Upload limit reached. Try again tomorrow.',
        stop: true,
      };
    }

    if (response.status === 422) {
      return {
        fileName: file.name,
        tone: 'info',
        message: data.error ?? "We couldn't find an event poster in that image.",
      };
    }

    if (response.status === 400) {
      return {
        fileName: file.name,
        tone: 'error',
        message: data.error ?? 'That image could not be accepted.',
      };
    }

    if (!response.ok) {
      return {
        fileName: file.name,
        tone: 'error',
        message: data.error ?? 'Something went wrong reading that poster. Please try again.',
      };
    }

    // 200 = byte-identical re-upload, short-circuited before any processing.
    if (data.duplicateOf) {
      return {
        fileName: file.name,
        tone: 'info',
        message: data.message ?? 'This poster was already uploaded.',
      };
    }

    const details = [
      data.warning,
      data.capped ? 'This image held more posters than we can read at once.' : null,
    ].filter((part): part is string => Boolean(part));
    const detail = details.length > 0 ? details.join(' ') : undefined;

    if (data.status === 'pending_review') {
      return {
        fileName: file.name,
        tone: 'info',
        message: 'Submitted for review. It will appear once a moderator approves it.',
        detail,
      };
    }

    return {
      fileName: file.name,
      tone: 'success',
      message: summarizeExtractions(data.extractions ?? []),
      detail,
    };
  };

  const handleFiles = async (fileList: FileList) => {
    // An empty type means the browser did not recognise the file; the server's
    // format probe is a better judge than we are, so let those through.
    const files = Array.from(fileList).filter(
      (file) => file.type === '' || file.type.startsWith('image/')
    );

    if (files.length === 0) {
      setResults([
        {
          fileName: '',
          tone: 'error',
          message: 'Please choose an image file (JPEG, PNG, WEBP or HEIC).',
        },
      ]);
      return;
    }

    setResults([]);
    cancelledRef.current = false;
    setIsCancelling(false);
    let anyPublished = false;

    // One image per request, so several selected files go up one after another.
    for (const file of files) {
      if (cancelledRef.current) break;

      const result = await uploadOne(file);
      setResults((prev) => [...prev, result]);
      if (result.tone === 'success') anyPublished = true;
      if (result.stop) break;
    }

    setPhase('idle');
    setIsCancelling(false);
    setCurrentFile(null);
    cancelledRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = '';

    // The feed is server-rendered and uncached, so a refresh is all it takes to
    // show the poster that was just published.
    if (anyPublished) router.refresh();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="poster-upload-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="poster-upload-title"
            className="text-xl font-bold text-gray-900 dark:text-gray-100"
          >
            Upload a poster
          </h2>
          <button
            onClick={handleCloseOrCancel}
            aria-label={isBusy && !isCancelling ? 'Cancel upload' : 'Close'}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {isAuthLoading ? (
            <div
              className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
              role="status"
            >
              <Loader2 size={16} className="animate-spin flex-shrink-0" />
              Checking your account…
            </div>
          ) : needsSignIn ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {sessionExpired
                  ? 'Your session expired. Sign in again to upload posters.'
                  : 'Sign in to upload posters. We use your account to keep spam out and to cap uploads per day.'}
              </p>
              <GoogleSignInButton redirectTo="/posters" />
              <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                Prefer email?{' '}
                <Link
                  href="/login?next=%2Fposters"
                  className="underline hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Sign in another way
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Snap a flyer or upload a poster image. We read the event details off it and add
                anything new to the feed. A photo of a whole bulletin board works too.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                disabled={isBusy}
                onChange={(event) => {
                  if (event.target.files) void handleFiles(event.target.files);
                }}
                className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-600 file:text-white hover:file:bg-brand-700 file:cursor-pointer disabled:opacity-50"
              />

              {isBusy && (
                <div className="space-y-2">
                  <div
                    className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                    role="status"
                  >
                    <Loader2 size={16} className="animate-spin flex-shrink-0" />
                    <span>
                      {isCancelling
                        ? 'Cancelling…'
                        : phase === 'compressing'
                          ? 'Preparing your image…'
                          : 'Reading your poster…'}
                      {currentFile ? ` (${currentFile})` : ''}
                    </span>
                  </div>
                  {phase === 'reading' && !isCancelling && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      This usually takes a few seconds, sometimes up to 20.
                    </p>
                  )}
                  <button
                    onClick={handleCloseOrCancel}
                    className="text-xs font-medium text-gray-600 dark:text-gray-300 underline hover:text-gray-900 dark:hover:text-white cursor-pointer"
                  >
                    {isCancelling ? 'Close' : 'Cancel upload'}
                  </button>
                </div>
              )}
            </>
          )}

          <div aria-live="polite">
            {results.length > 0 && (
              <ul className="space-y-2">
                {results.map((result, index) => {
                  const Icon = toneIcons[result.tone];
                  return (
                    <li
                      key={`${result.fileName}-${index}`}
                      className={`flex gap-2 p-3 rounded-lg border text-sm ${toneStyles[result.tone]}`}
                    >
                      <Icon size={16} className="flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        {result.fileName && (
                          <p className="font-medium truncate">{result.fileName}</p>
                        )}
                        <p>{result.message}</p>
                        {result.detail && <p className="mt-1 opacity-80">{result.detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!isBusy && results.some((result) => result.tone === 'success') && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Your poster is now in the feed behind this dialog.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
