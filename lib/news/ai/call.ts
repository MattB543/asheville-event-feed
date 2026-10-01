/**
 * The one way the news pipeline calls a model (docs/news/05-v1-plan.md §3).
 * Every call goes to the news deployment at low effort in JSON mode, with no
 * retry inside the run: a failed call is retried by the next run. Callers get
 * a result object instead of an exception, so a content-filter block (which
 * never succeeds on retry) can be told apart from a transient failure.
 *
 * Prompt modules take a `NewsModelCaller` rather than importing this directly,
 * so scripts/news/eval-clustering.ts can put a cache in front of it.
 */

import { azureChatCompletion, type AzureChatCompletionOptions } from '@/lib/ai/provider-clients';
import { newsDeployment } from './model';

/** Options shared by every news call. Part of the eval's cache key. */
export const NEWS_MODEL_OPTIONS = {
  reasoningEffort: 'low',
  jsonMode: true,
  maxRetries: 1,
  timeoutMs: 60_000,
} as const satisfies AzureChatCompletionOptions;

export interface NewsModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export type NewsModelResult =
  | { ok: true; content: string; usage: NewsModelUsage }
  | {
      ok: false;
      /**
       * content_filter: Azure refused the input or output; permanent for this text.
       * transient: throttling, a timeout, a 5xx or a network error; worth a later run.
       * fatal: Azure isn't configured, or rejected the credentials, the deployment
       *   or one of our request parameters. Every call fails the same way until
       *   someone fixes the configuration, so it says nothing about the article.
       * error: anything else (another bad request, truncated or empty output).
       */
      reason: 'content_filter' | 'transient' | 'fatal' | 'error';
      error: string;
      usage: NewsModelUsage;
    };

export type NewsModelCaller = (system: string, user: string) => Promise<NewsModelResult>;

const NO_USAGE: NewsModelUsage = { inputTokens: 0, outputTokens: 0 };

function errorStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return null;
}

/** Azure's prompt filter answers 400 with code `content_filter` ("...content management policy"). */
export function isContentFilterError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : (undefined as string | undefined);
  if (code === 'content_filter') return true;
  return (
    errorStatus(error) === 400 &&
    /content_filter|content management policy|ResponsibleAIPolicyViolation/i.test(error.message)
  );
}

function isTransientError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === null) return true; // network error, timeout, abort
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * 400 codes that blame the request rather than the article: a parameter or
 * value the deployment doesn't accept ('reasoning_effort' does not support
 * 'minimal'), or a deployment whose model can't chat.
 */
const FATAL_400_CODES = new Set([
  'unsupported_parameter',
  'unsupported_value',
  'unknown_parameter',
  'OperationNotSupported',
]);

/** 401/403 (key or network rules), 404 (no such deployment), or a 400 in FATAL_400_CODES. */
function isFatalError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 401 || status === 403 || status === 404) return true;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return status === 400 && typeof code === 'string' && FATAL_400_CODES.has(code);
}

/** One news model call. Never throws. */
export async function callNewsModel(system: string, user: string): Promise<NewsModelResult> {
  try {
    const response = await azureChatCompletion(system, user, {
      ...NEWS_MODEL_OPTIONS,
      deployment: newsDeployment(),
    });
    if (!response) {
      return {
        ok: false,
        reason: 'fatal',
        error: 'Azure OpenAI is not configured',
        usage: NO_USAGE,
      };
    }
    const usage = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    };
    if (response.finishReason === 'content_filter') {
      return { ok: false, reason: 'content_filter', error: 'finish_reason=content_filter', usage };
    }
    if (!response.content) {
      return {
        ok: false,
        reason: 'error',
        error: `Empty response (finish_reason=${response.finishReason})`,
        usage,
      };
    }
    return { ok: true, content: response.content, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isContentFilterError(error)) {
      return { ok: false, reason: 'content_filter', error: message, usage: NO_USAGE };
    }
    return {
      ok: false,
      reason: isFatalError(error) ? 'fatal' : isTransientError(error) ? 'transient' : 'error',
      error: message,
      usage: NO_USAGE,
    };
  }
}

/** Running token totals for a pipeline run. */
export interface TokenMeter {
  in: number;
  out: number;
  calls: number;
}

/** `call`, with every result's usage added to `meter`. */
export function meteredCaller(call: NewsModelCaller, meter: TokenMeter): NewsModelCaller {
  return async (system, user) => {
    const result = await call(system, user);
    meter.in += result.usage.inputTokens;
    meter.out += result.usage.outputTokens;
    meter.calls++;
    return result;
  };
}
