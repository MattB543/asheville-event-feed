/**
 * Event Verification via Jina Reader API
 *
 * Fetches each event's source page and uses AI to fill a missing description or
 * price, detect cancellations, and spot links that have died. Used by the verify
 * cron (app/api/cron/verify/route.ts) and scripts/verify-event.ts, which share
 * `verifyEvent` and `applyVerification` so both follow the same policy.
 */

import { and, eq, sql, type SQL } from 'drizzle-orm';
import { env } from '@/lib/config/env';
import { THIN_DESCRIPTION_LENGTH } from '@/lib/config/verification';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { azureChatCompletion, isAzureAIEnabled, parseJsonFromModel } from './provider-clients';

/**
 * Sources that have useful external event URLs worth verifying.
 * These link to actual event pages (not aggregator platforms like Eventbrite/Meetup).
 */
export const VERIFIABLE_SOURCES = ['AVL_TODAY', 'EXPLORE_ASHEVILLE', 'MOUNTAIN_X'] as const;

/**
 * URLs that are never a readable page about one event, so verifying them can
 * only conclude "page doesn't show this event" (every one used to be hidden):
 * - AVL Today's fallback for events with no link of their own, its
 *   client-rendered events page (lib/scrapers/avltoday.ts)
 * - Facebook and Instagram, which serve a fetcher a login wall
 * - the retired Buncombe County library calendar (its links all 404; the
 *   LIBRARY scraper reads the current one)
 *
 * Written to work as both a JS RegExp and a Postgres `~*` pattern, so the cron's
 * query and `hasVerifiablePage` exclude exactly the same rows.
 */
export const UNVERIFIABLE_URL_PATTERN = String.raw`^https?://((www\.)?avltoday\.6amcity\.com/events#|([a-z0-9-]+\.)*(facebook|instagram)\.com/|(www\.)?buncombecounty\.org/governing/depts/library/)`;

const UNVERIFIABLE_URL_REGEX = new RegExp(UNVERIFIABLE_URL_PATTERN, 'i');

/** Whether the URL is a page about this one event, so there is something to verify against. */
export function hasVerifiablePage(url: string | null | undefined): url is string {
  return !!url && !UNVERIFIABLE_URL_REGEX.test(url);
}

/** Same test as the cron's `LENGTH(description) < THIN_DESCRIPTION_LENGTH` (NULL counts as thin). */
function isThinDescription(description: string | null): boolean {
  return !description || description.length < THIN_DESCRIPTION_LENGTH;
}

/**
 * Minimum AI confidence required before a verification result is allowed to
 * mutate an event (hide it or overwrite its details).
 */
export const HIDE_CONFIDENCE_THRESHOLD = 0.8;

/**
 * A page that answers 404/410 is only treated as the event being gone once the
 * scrapers have also stopped listing it for this long - the same rule the
 * cleanup cron's dead-URL pass uses. Until then the event is retried with
 * backoff, so it is marked dead once its source drops it.
 */
const DEAD_STALE_HOURS = 24;

/**
 * Same circuit breaker as the cleanup cron's dead-URL pass: if more than this
 * share of a source's judged pages 404 in one run, that is a site change or an
 * outage, not removals, so none of that source's events are marked dead.
 */
const DEAD_SOURCE_MAX_SHARE = 0.2;
const DEAD_SOURCE_MIN_CHECKED = 5;

/** Retry delays for results that didn't land (fetch failed, AI error, low confidence). */
const VERIFY_BACKOFF_MS = [6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000];

/** Minimum gap between Jina fetches. Keyless Jina allows 20 a minute per IP. */
const FETCH_INTERVAL_MS = 3500;

/** Client-side cap on one Jina request; `x-timeout` only bounds Jina's own page load. */
export const JINA_REQUEST_TIMEOUT_MS = 45_000;

/** AI call limits for one verdict (a normal one takes 10-20s) */
const AI_ATTEMPTS = 2;
const AI_ATTEMPT_TIMEOUT_MS = 60_000;

/**
 * Hard limit on one event, fetch and AI together. The SDK's own timeout stops
 * once response headers arrive, so a stalled body could otherwise run on; this
 * bound is what lets the cron pick a start deadline that fits in maxDuration.
 * An event that hits it is deferred and retried later.
 */
export const MAX_EVENT_MS = 150_000;

/**
 * Event data structure for verification.
 */
export interface EventForVerification {
  id: string;
  title: string;
  description: string | null;
  startDate: Date;
  location: string | null;
  organizer: string | null;
  price: string | null;
  url: string;
  source: string;
  lastSeenAt: Date | null;
  verifyAttempts: number;
}

/**
 * What verification concluded about one event.
 * - keep: the page confirms the event as stored
 * - update: the page confirms it and adds a detail we lack or have wrong
 * - hide: the page is about this event and says it is cancelled, postponed, or
 *   not happening on the stored date
 * - unverifiable: the page can neither confirm nor contradict the event (an
 *   error or "not found" page, a login wall, a generic listing, another event)
 * - missing: the page answered 404/410 (decided from the HTTP status, no AI call)
 * A result with `error` didn't land (fetch failed, AI error) and is retried.
 */
export interface VerificationResult {
  eventId: string;
  eventTitle: string;
  action: 'keep' | 'hide' | 'update' | 'unverifiable' | 'missing';
  reason: string;
  confidence: number;
  updates?: {
    price?: string;
    description?: string;
    location?: string;
  };
  error?: string;
  /** The page couldn't be fetched, so nothing was judged */
  fetchFailed?: boolean;
  tokensUsed?: number;
}

interface VerificationAIResponse {
  action?: string;
  reason?: string;
  confidence?: number;
  updates?: {
    price?: string | null;
    description?: string | null;
    location?: string | null;
  };
}

const AI_ACTIONS: ReadonlySet<string> = new Set(['keep', 'hide', 'update', 'unverifiable']);

/**
 * Whether a verification result is confident enough to write to the database.
 * Errored results never apply, regardless of confidence.
 */
export function shouldApplyVerification(result: VerificationResult): boolean {
  if (result.error) return false;
  return result.confidence >= HIDE_CONFIDENCE_THRESHOLD;
}

/**
 * Coerce a model-supplied confidence into a finite 0-1 number.
 * Numeric strings are accepted; anything non-finite is rejected (null).
 */
function normalizeConfidence(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 0;
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.min(1, Math.max(0, num));
}

/**
 * System prompt for event verification AI.
 */
const SYSTEM_PROMPT = `You analyze event page content to verify event status. Compare the web page content with the stored event data.

Your task:
1. Decide whether the page is about this specific event at all
2. If it is, determine whether the event is CANCELLED, POSTPONED, or not happening on the stored date
3. Identify any UPDATES to: price, description, or location

Response format (JSON only, no markdown):
{
  "action": "keep" | "hide" | "update" | "unverifiable",
  "reason": "brief explanation (max 50 words)",
  "confidence": 0.0-1.0,
  "updates": {
    "price": "new price string, or null if the page lists none or it matches",
    "description": "the page's own description of this event, only when the stored description is missing or under 50 characters; otherwise null",
    "location": "updated location or null"
  }
}

Actions:
- "keep" = The page is about this event and confirms it as stored
- "update" = The page is about this event, confirms it, and shows details that differ from or add to the stored data
- "hide" = The page is about this event and explicitly shows it will not happen on the stored date: it says cancelled or postponed, marks that date as skipped, or gives a schedule that clearly rules the date out (e.g. the series starts after it or ended before it)
- "unverifiable" = The page can neither confirm nor contradict this event: an error or "page not found" page, a login or cookie wall, a homepage or general listing that doesn't mention it, or a page about a different event

"hide" needs evidence about this event on the page. A missing, broken, or unrelated page is "unverifiable", never "hide". A list of upcoming dates that merely leaves the stored date out is not enough on its own: lists are often partial, and the page content may be truncated. Use "unverifiable" unless the schedule clearly covers the stored date's period.

Descriptions:
- Never rewrite or summarize a stored description that is 50 characters or longer; it is the source's own text
- When filling a missing or short one, copy the page's wording (up to about 1000 characters) rather than paraphrasing it

Be CONSERVATIVE:
- Only hide if you're >80% confident the event is not happening on the stored date
- Only update if you see clear differences in the actual event details
- When in doubt between keep and hide, use "keep"

Do NOT hide events just because:
- The page has limited information
- You can't find exact matches for all fields
- The format is different`;

/**
 * Jina rejected the request itself, even without a key, so every fetch in the
 * run will fail the same way. Thrown rather than returned as a per-event skip:
 * from 2026-01-10 a 402 "InsufficientBalanceError" made the cron skip every
 * event for months while reporting success.
 */
export class JinaAccountError extends Error {}

/** Jina rate-limited us (HTTP 429): stop fetching for the rest of the run. */
class JinaRateLimitError extends Error {}

/**
 * Check if event verification is available. Jina needs no key (see
 * fetchPageContent), so only Azure AI has to be configured.
 */
export function isVerificationEnabled(): boolean {
  return isAzureAIEnabled();
}

/** Set once Jina refuses JINA_API_KEY, so later fetches go keyless without a wasted request. */
let jinaKeyRefused = false;

function requestJina(url: string, apiKey?: string): Promise<Response> {
  return fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'x-respond-with': 'markdown',
      'x-timeout': '30',
    },
    signal: AbortSignal.timeout(JINA_REQUEST_TIMEOUT_MS),
  });
}

/**
 * What fetching an event page produced:
 * - page: content worth showing the AI
 * - missing: the site answered 404/410, which Jina reports on a 200 as
 *   "Warning: Target URL returned error 404"
 * - failed: nothing usable (blocked, server error, timeout, bot challenge);
 *   `reason` says which, for the run record
 */
export type PageFetch =
  | { kind: 'page'; content: string }
  | { kind: 'missing'; status: number }
  | { kind: 'failed'; reason: string };

/**
 * Fetch page content via Jina Reader API.
 *
 * Uses JINA_API_KEY when it works. Jina also serves keyless requests (20 a
 * minute per IP, far above this job's pace), so a refused key (401, or 402 when
 * the balance runs out, as it did from 2026-10-02) falls back to that, and the
 * key is skipped for the rest of the process.
 *
 * Throws JinaAccountError when Jina refuses even a keyless request, and
 * JinaRateLimitError on a 429.
 */
export async function fetchPageContent(url: string): Promise<PageFetch> {
  const fetchStart = Date.now();
  const failed = (reason: string): PageFetch => {
    const elapsed = ((Date.now() - fetchStart) / 1000).toFixed(1);
    console.warn(`[Verify] Fetch failed for ${url}: ${reason} (${elapsed}s)`);
    return { kind: 'failed', reason };
  };

  try {
    const isRefused = (res: Response) => res.status === 401 || res.status === 402;
    const apiKey = jinaKeyRefused ? undefined : env.JINA_API_KEY;
    let response = await requestJina(url, apiKey);

    if (apiKey && isRefused(response)) {
      const body = (await response.text()).slice(0, 200);
      console.warn(
        `[Verify] Jina refused the API key (HTTP ${response.status} ${body}); continuing without it`
      );
      jinaKeyRefused = true;
      response = await requestJina(url);
    }

    if (isRefused(response)) {
      const body = (await response.text()).slice(0, 200);
      throw new JinaAccountError(`Jina refused the request: HTTP ${response.status} ${body}`);
    }
    if (response.status === 429) {
      throw new JinaRateLimitError('Jina rate limit (HTTP 429)');
    }
    if (!response.ok) return failed(`jina HTTP ${response.status}`);

    const content = await response.text();

    // Checked before the status: a bot challenge can come back as a 404 (the
    // cleanup cron has seen Cloudflare do it), and must never read as "gone"
    if (content.includes('Title: Just a moment...') || content.includes('requiring CAPTCHA')) {
      return failed('bot challenge');
    }

    // The status the event's own site answered with, when it wasn't a 2xx
    const targetStatus = Number(
      content.match(/^Warning: Target URL returned error (\d{3})/m)?.[1] ?? 0
    );
    if (targetStatus === 404 || targetStatus === 410) {
      return { kind: 'missing', status: targetStatus };
    }
    // A block or an outage says nothing about the event, and the AI may read
    // the error page as "page doesn't contain this event"
    if (targetStatus >= 400) return failed(`site HTTP ${targetStatus}`);

    if (!content || content.length < 100) {
      return failed(`minimal content (${content.length} chars)`);
    }

    return { kind: 'page', content };
  } catch (error) {
    if (error instanceof JinaAccountError || error instanceof JinaRateLimitError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout =
      (error instanceof Error && error.name === 'TimeoutError') || /timeout/i.test(message);
    return failed(isTimeout ? 'timeout' : `network: ${message}`);
  }
}

/**
 * The model's proposed updates, cut down to fields that actually change. A
 * description is only taken when the stored one is thin (see THIN_DESCRIPTION_LENGTH)
 * and the new one is longer. Returns undefined when nothing is left.
 */
function realUpdates(
  event: EventForVerification,
  proposed: VerificationAIResponse['updates']
): VerificationResult['updates'] {
  const { price, location, description } = proposed ?? {};
  const changed = (next: unknown, current: string | null): next is string =>
    typeof next === 'string' && next.trim() !== '' && next.trim() !== (current ?? '').trim();

  const updates: NonNullable<VerificationResult['updates']> = {};
  // "Unknown" is our own placeholder for no price, not something to write
  if (changed(price, event.price) && price.trim().toLowerCase() !== 'unknown') {
    updates.price = price.trim();
  }
  if (changed(location, event.location)) updates.location = location.trim();
  if (
    isThinDescription(event.description) &&
    changed(description, event.description) &&
    description.trim().length > (event.description?.trim().length ?? 0)
  ) {
    // Same cap as the scrapers apply to a source description
    updates.description = description.trim().slice(0, 2000);
  }
  return Object.keys(updates).length > 0 ? updates : undefined;
}

/**
 * Verify a single event using AI analysis.
 *
 * @param event - The event to verify
 * @param pageContent - The fetched page content
 * @returns Verification result
 */
export async function verifyEventWithAI(
  event: EventForVerification,
  pageContent: string
): Promise<VerificationResult> {
  const result: VerificationResult = {
    eventId: event.id,
    eventTitle: event.title,
    action: 'keep',
    reason: 'Default - no AI response',
    confidence: 0,
  };

  if (!isAzureAIEnabled()) {
    result.error = 'Azure AI not configured';
    return result;
  }

  // Build user prompt with event data and page content
  const eventDate = event.startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

  const eventTime = event.startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });

  // Truncate page content to avoid token limits
  const truncatedContent =
    pageContent.length > 8000
      ? pageContent.slice(0, 8000) + '\n\n[Content truncated...]'
      : pageContent;

  const storedDescription = event.description?.trim()
    ? event.description.length > 1500
      ? `${event.description.slice(0, 1500)}...`
      : event.description
    : 'None';

  const userPrompt = `## Stored Event Data
Title: ${event.title}
Date: ${eventDate}
Time: ${eventTime}
Location: ${event.location || 'Not specified'}
Organizer: ${event.organizer || 'Not specified'}
Price: ${event.price || 'Unknown'}
Source URL: ${event.url}
Description (${event.description?.length ?? 0} characters): ${storedDescription}

## Web Page Content
${truncatedContent}

Analyze the page content and determine if this event is still active and accurate.`;

  const aiStart = Date.now();
  try {
    const aiResponse = await azureChatCompletion(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 10000, // Reasoning models need plenty of tokens for thinking + output
      jsonMode: true,
      maxRetries: AI_ATTEMPTS,
      timeoutMs: AI_ATTEMPT_TIMEOUT_MS,
    });

    const aiElapsed = ((Date.now() - aiStart) / 1000).toFixed(1);

    if (!aiResponse || !aiResponse.content) {
      result.error = 'No AI response';
      console.warn(
        `[Verify] AI returned empty response for "${event.title.slice(0, 50)}" (${aiElapsed}s)`
      );
      return result;
    }

    // Parse JSON response
    const parsed = parseJsonFromModel<VerificationAIResponse>(aiResponse.content);
    if (!parsed) {
      result.error = 'Invalid AI response format';
      console.warn(
        `[Verify] AI returned non-JSON for "${event.title.slice(0, 50)}" (${aiElapsed}s)`
      );
      return result;
    }

    // Validate at the boundary. An unrecognised action is a validation ERROR,
    // not a silent "keep": a clean keep stamps lastVerifiedAt, which would
    // permanently retire the event from re-verification.
    const rawAction = parsed.action;
    if (typeof rawAction !== 'string' || !AI_ACTIONS.has(rawAction)) {
      result.error = `Invalid AI action: ${JSON.stringify(rawAction)}`;
      console.warn(
        `[Verify] AI returned unknown action ${JSON.stringify(rawAction)} for "${event.title.slice(0, 50)}" (${aiElapsed}s)`
      );
      return result;
    }

    const confidence = normalizeConfidence(parsed.confidence);
    if (confidence === null) {
      result.error = `Invalid AI confidence: ${JSON.stringify(parsed.confidence)}`;
      console.warn(
        `[Verify] AI returned non-numeric confidence ${JSON.stringify(parsed.confidence)} for "${event.title.slice(0, 50)}" (${aiElapsed}s)`
      );
      return result;
    }

    result.action = rawAction as VerificationResult['action'];
    result.reason = parsed.reason || 'No reason provided';
    result.confidence = confidence;
    result.tokensUsed = aiResponse.usage.totalTokens;

    if (result.action === 'update') {
      result.updates = realUpdates(event, parsed.updates);
      // Nothing left to write (e.g. the model "filled" a description we already
      // have), so a confident result is a keep: stamped as verified, not reported
      // as updated. A low-confidence one stays an update so it is retried.
      if (!result.updates && shouldApplyVerification(result)) result.action = 'keep';
    }

    return result;
  } catch (error) {
    const aiElapsed = ((Date.now() - aiStart) / 1000).toFixed(1);
    const errMsg = error instanceof Error ? error.message : String(error);
    const isTransient =
      errMsg.includes('timeout') ||
      errMsg.includes('Timeout') ||
      errMsg.includes('429') ||
      errMsg.includes('503') ||
      errMsg.includes('ECONNRESET');
    result.error = `AI error (${isTransient ? 'transient' : 'permanent'}): ${errMsg}`;
    console.error(
      `[Verify] AI ${isTransient ? 'transient' : 'permanent'} error for "${event.title.slice(0, 50)}": ${errMsg} (${aiElapsed}s)`
    );
    return result;
  }
}

/**
 * Fetch an event's page and judge it. Never throws for a per-event problem
 * (those come back as a result with `error`), only for JinaAccountError and
 * JinaRateLimitError, which end the run.
 */
export async function verifyEvent(event: EventForVerification): Promise<VerificationResult> {
  const base = { eventId: event.id, eventTitle: event.title };

  if (!hasVerifiablePage(event.url)) {
    return {
      ...base,
      action: 'unverifiable',
      reason: 'The URL is not a page about this event',
      confidence: 1,
    };
  }

  const page = await fetchPageContent(event.url);
  if (page.kind === 'failed') {
    return {
      ...base,
      action: 'keep',
      reason: page.reason,
      confidence: 0,
      error: page.reason,
      fetchFailed: true,
    };
  }
  if (page.kind === 'missing') {
    return {
      ...base,
      action: 'missing',
      reason: `The page returns HTTP ${page.status}`,
      confidence: 1,
    };
  }
  return verifyEventWithAI(event, page.content);
}

/**
 * What applying one result did, kept in the cron run's record (cron_job_runs is
 * the only durable trail: Vercel logs last ~1h).
 * - kept / unverifiable: stamped as verified, nothing else changed
 * - updated / hidden / dead: the row was changed (dead = deadAt set)
 * - deferred: nothing landed; retried after a backoff
 * - stale: the row changed (a scrape re-titled it, moved it, or changed a field
 *   being updated) while it was being checked, so the verdict was dropped; it
 *   is picked up again by a later run
 * - write_failed: the database write threw
 */
export interface VerificationOutcome {
  id: string;
  title: string;
  url: string;
  source: string;
  outcome:
    | 'kept'
    | 'updated'
    | 'hidden'
    | 'dead'
    | 'unverifiable'
    | 'deferred'
    | 'stale'
    | 'write_failed';
  reason: string;
  confidence?: number;
  changes?: Record<string, { from: string | null; to: string }>;
}

function unlistedCutoff(now: Date): Date {
  return new Date(now.getTime() - DEAD_STALE_HOURS * 60 * 60 * 1000);
}

/** Whether the scrapers have stopped listing the event (as of when it was read). */
function isUnlisted(event: EventForVerification, now: Date): boolean {
  return !event.lastSeenAt || event.lastSeenAt < unlistedCutoff(now);
}

/**
 * Write one verification result to the database.
 *
 * - hide / update need HIDE_CONFIDENCE_THRESHOLD; below it they are deferred.
 * - missing (404/410) sets deadAt, like the cleanup cron, only when the scrapers
 *   have stopped listing the event for DEAD_STALE_HOURS and `allowDead` (the
 *   per-source circuit breaker) permits. A listed event with a dead link is
 *   deferred, so it is marked dead once its source drops it.
 * - Every write, retry bookkeeping included, is conditioned on the title and
 *   date that were checked, an update also on each field it changes, and a dead
 *   mark on the row still being unlisted. A scrape that changed the row mid-run
 *   wins, and the outcome is `stale`.
 */
export async function applyVerification(
  event: EventForVerification,
  result: VerificationResult,
  now: Date,
  { allowDead = true }: { allowDead?: boolean } = {}
): Promise<VerificationOutcome> {
  const base = {
    id: event.id,
    title: event.title,
    url: event.url,
    source: event.source,
    reason: result.error ?? result.reason,
    ...(result.error ? {} : { confidence: result.confidence }),
  };

  // The row must still be the one that was checked
  const unchanged = and(
    eq(events.id, event.id),
    eq(events.title, event.title),
    eq(events.startDate, event.startDate)
  );

  const write = async (
    set: Partial<typeof events.$inferInsert>,
    outcome: VerificationOutcome['outcome'],
    extra: Partial<VerificationOutcome> = {},
    condition = unchanged
  ): Promise<VerificationOutcome> => {
    const rows = await db.update(events).set(set).where(condition).returning({ id: events.id });
    if (rows.length === 0) {
      return { ...base, outcome: 'stale', reason: 'Row changed while it was being verified' };
    }
    return { ...base, ...extra, outcome };
  };

  const stamp = (
    set: Partial<typeof events.$inferInsert>,
    outcome: VerificationOutcome['outcome'],
    extra: Partial<VerificationOutcome> = {},
    condition = unchanged
  ) => write({ ...set, lastVerifiedAt: now }, outcome, extra, condition);

  const defer = (reason: string) => {
    const attempts = event.verifyAttempts + 1;
    const delay = VERIFY_BACKOFF_MS[Math.min(attempts - 1, VERIFY_BACKOFF_MS.length - 1)];
    return write(
      { verifyAttempts: attempts, verifyNextAttemptAt: new Date(now.getTime() + delay) },
      'deferred',
      { reason }
    );
  };

  try {
    if (result.error) return await defer(result.error);

    switch (result.action) {
      case 'keep':
        return await stamp({}, 'kept');

      case 'unverifiable':
        return await stamp({}, 'unverifiable');

      case 'missing': {
        if (!isUnlisted(event, now)) {
          return await defer(`${result.reason}, but the source still lists the event`);
        }
        if (!allowDead) return await defer(`${result.reason} (source over the dead-link cap)`);
        const stillUnlisted = sql`(${events.lastSeenAt} IS NULL OR ${events.lastSeenAt} < ${unlistedCutoff(now).toISOString()})`;
        return await stamp({ deadAt: now }, 'dead', {}, and(unchanged, stillUnlisted));
      }

      case 'hide':
        if (!shouldApplyVerification(result)) {
          return await defer(`low confidence hide (${result.confidence}): ${result.reason}`);
        }
        return await stamp({ hidden: true, updatedAt: now }, 'hidden');

      case 'update': {
        if (!shouldApplyVerification(result) || !result.updates) {
          return await defer(`low confidence update (${result.confidence}): ${result.reason}`);
        }
        const changes: NonNullable<VerificationOutcome['changes']> = {};
        const set: Partial<typeof events.$inferInsert> = { updatedAt: now };
        // Each changed field must still hold the value that was checked
        const fieldsUnchanged: SQL[] = [];
        for (const field of ['price', 'description', 'location'] as const) {
          const to = result.updates[field];
          if (!to) continue;
          changes[field] = { from: event[field], to };
          set[field] = to;
          fieldsUnchanged.push(sql`${events[field]} IS NOT DISTINCT FROM ${event[field]}`);
        }
        return await stamp(set, 'updated', { changes }, and(unchanged, ...fieldsUnchanged));
      }
    }
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(`[Verify] DB error for "${event.title.slice(0, 50)}": ${message}`);
    return { ...base, outcome: 'write_failed', reason: message };
  }
}

/** The promise's value, or undefined if it hasn't settled within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Totals from one verification run, alongside the outcomes passed to `onOutcome`.
 */
export interface VerificationRunStats {
  /** Events whose page was judged (by the AI, or as missing from its status) */
  eventsChecked: number;
  /** Events whose page couldn't be fetched */
  eventsSkipped: number;
  /** Events left for a later run because the deadline or a rate limit hit first */
  eventsNotAttempted: number;
  /** Why the run stopped early, if it did */
  stoppedEarly?: string;
  totalTokensUsed: number;
  durationMs: number;
}

/**
 * Verify events one at a time, pacing Jina fetches, and write each result as
 * soon as it is judged, so a run cut short keeps the work it finished. Stops
 * starting new events at `deadline` (epoch ms) or on a Jina rate limit; the
 * rest are left untouched for the next run.
 *
 * Dead marks wait for the end: the per-source circuit breaker needs the whole
 * run's numbers (all 404s / all judged pages, per source).
 */
export async function runVerification(
  eventsToCheck: EventForVerification[],
  {
    now,
    deadline,
    onOutcome,
  }: { now: Date; deadline: number; onOutcome: (outcome: VerificationOutcome) => void }
): Promise<VerificationRunStats> {
  const startTime = Date.now();
  const stats: VerificationRunStats = {
    eventsChecked: 0,
    eventsSkipped: 0,
    eventsNotAttempted: 0,
    totalTokensUsed: 0,
    durationMs: 0,
  };
  const judgedBySource = new Map<string, number>();
  const missingBySource = new Map<string, number>();
  const deadCandidates: Array<{ event: EventForVerification; result: VerificationResult }> = [];

  const record = (outcome: VerificationOutcome) => {
    onOutcome(outcome);
    if (outcome.outcome !== 'kept') {
      const changed = outcome.changes
        ? ` [${Object.entries(outcome.changes)
            .map(([field, { from, to }]) =>
              field === 'description'
                ? `description: ${from?.length ?? 0} -> ${to.length} chars`
                : `${field}: "${from ?? 'null'}" -> "${to}"`
            )
            .join(', ')}]`
        : '';
      console.log(
        `[Verify] ${outcome.outcome.toUpperCase()} ${outcome.id} "${outcome.title.slice(0, 50)}"${changed} - ${outcome.reason}`
      );
    }
  };

  console.log(`[Verify] Processing ${eventsToCheck.length} events`);

  let lastFetchAt = 0;
  for (let i = 0; i < eventsToCheck.length; i++) {
    const event = eventsToCheck[i];
    const label = `[Verify] [${i + 1}/${eventsToCheck.length}]`;

    // Pace every fetch, failed ones included, so a run of quick failures
    // can't burst past Jina's per-minute limit
    const wait = lastFetchAt + FETCH_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    if (Date.now() >= deadline) {
      stats.stoppedEarly = 'deadline';
      stats.eventsNotAttempted = eventsToCheck.length - i;
      break;
    }
    lastFetchAt = Date.now();

    console.log(`${label} Checking: "${event.title.slice(0, 60)}" (${event.source})`);
    let result: VerificationResult;
    try {
      result = (await withTimeout(verifyEvent(event), MAX_EVENT_MS)) ?? {
        eventId: event.id,
        eventTitle: event.title,
        action: 'keep',
        reason: `Timed out after ${MAX_EVENT_MS / 1000}s`,
        confidence: 0,
        error: `Timed out after ${MAX_EVENT_MS / 1000}s`,
      };
    } catch (error) {
      if (error instanceof JinaRateLimitError) {
        console.warn(`${label} Jina rate limit hit; leaving the rest for the next run`);
        stats.stoppedEarly = 'rate limited';
        stats.eventsNotAttempted = eventsToCheck.length - i;
        break;
      }
      throw error;
    }

    stats.totalTokensUsed += result.tokensUsed ?? 0;
    if (result.fetchFailed) {
      stats.eventsSkipped++;
    } else {
      stats.eventsChecked++;
    }
    if (!result.error) {
      judgedBySource.set(event.source, (judgedBySource.get(event.source) ?? 0) + 1);
      if (result.action === 'missing') {
        missingBySource.set(event.source, (missingBySource.get(event.source) ?? 0) + 1);
      }
    }
    console.log(
      `${label} ${result.error ? `ERROR ${result.error}` : `${result.action.toUpperCase()} (${result.confidence}) - ${result.reason}`}`
    );

    if (!result.error && result.action === 'missing' && isUnlisted(event, now)) {
      deadCandidates.push({ event, result });
    } else {
      record(await applyVerification(event, result, now));
    }
  }

  // A source losing a big share of its pages at once is a redesign or an
  // outage, not removals: none of its events are marked dead this run
  for (const { event, result } of deadCandidates) {
    const judged = judgedBySource.get(event.source) ?? 0;
    const missing = missingBySource.get(event.source) ?? 0;
    const overCap = judged >= DEAD_SOURCE_MIN_CHECKED && missing / judged > DEAD_SOURCE_MAX_SHARE;
    record(await applyVerification(event, result, now, { allowDead: !overCap }));
  }

  stats.durationMs = Date.now() - startTime;
  console.log(
    `[Verify] Run complete in ${(stats.durationMs / 1000).toFixed(1)}s - Checked: ${stats.eventsChecked}, Skipped (fetch failed): ${stats.eventsSkipped}, Not attempted: ${stats.eventsNotAttempted}${stats.stoppedEarly ? ` (stopped: ${stats.stoppedEarly})` : ''}, Tokens: ${stats.totalTokensUsed}`
  );
  return stats;
}
