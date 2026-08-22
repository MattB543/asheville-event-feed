export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000, shouldRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw lastError;
      }

      console.warn(
        `[Retry] Attempt ${attempt}/${maxRetries} failed:`,
        error instanceof Error ? error.message : String(error)
      );

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        const jitter = delay * 0.1 * Math.random();
        await new Promise((r) => setTimeout(r, delay + jitter));
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('Retry failed without capturing an error');
}

/** Default per-attempt request deadline for {@link fetchWithRetry}. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15000;

export interface FetchRetryOptions extends RetryOptions {
  /** Per-attempt request deadline in ms. Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Error thrown by {@link fetchWithRetry} for a non-2xx response, carrying the
 * status so callers can branch on it (e.g. 403 -> curl fallback).
 */
export class HttpResponseError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(status: number, statusText: string, url: string) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpResponseError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

/** Only transient HTTP failures are worth retrying — 4xx (other than 408/429) will not change. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/**
 * fetch + retry with a per-attempt deadline.
 *
 * Each attempt gets a FRESH `AbortSignal.timeout`, composed with any caller
 * signal — a caller signal never replaces the deadline, and an already-aborted
 * signal is never reused across attempts. Caller-initiated aborts are not
 * retried; a timeout gets at most one extra attempt.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: FetchRetryOptions
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    shouldRetry: callerShouldRetry,
    ...rest
  } = retryOptions ?? {};
  const callerSignal = options?.signal ?? undefined;

  return withRetry(
    async () => {
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);

      const response = await fetch(url, { ...options, signal });
      if (!response.ok) {
        throw new HttpResponseError(response.status, response.statusText, url);
      }
      return response;
    },
    {
      ...rest,
      shouldRetry: (error, attempt) => {
        // Never keep going once the caller cancelled.
        if (callerSignal?.aborted) return false;
        // A hung host gets one more chance, not the full retry budget.
        if (isTimeoutError(error)) return attempt < 2;
        if (isAbortError(error)) return false;
        if (error instanceof HttpResponseError && !isTransientStatus(error.status)) return false;
        return callerShouldRetry ? callerShouldRetry(error, attempt) : true;
      },
    }
  );
}
