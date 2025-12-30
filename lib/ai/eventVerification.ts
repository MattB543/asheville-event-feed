/**
 * Event Verification via Jina Reader API
 *
 * Fetches event source pages and uses AI to verify event status,
 * detect cancellations, and update event details.
 */

import { env, isJinaEnabled } from "@/lib/config/env";
import { azureChatCompletion, isAzureAIEnabled } from "./provider-clients";
import { matchesDefaultFilter } from "@/lib/config/defaultFilters";

/**
 * Sources that have useful external event URLs worth verifying.
 * These link to actual event pages (not aggregator platforms like Eventbrite/Meetup).
 */
export const VERIFIABLE_SOURCES = [
  "AVL_TODAY",
  "EXPLORE_ASHEVILLE",
  "MOUNTAIN_X",
] as const;

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
  lastVerifiedAt: Date | null;
}

/**
 * AI verification result for a single event.
 */
export interface VerificationResult {
  eventId: string;
  eventTitle: string;
  action: "keep" | "hide" | "update";
  reason: string;
  confidence: number;
  updates?: {
    price?: string | null;
    description?: string | null;
    location?: string | null;
  };
  error?: string;
}

/**
 * Overall result from batch verification.
 */
export interface BatchVerificationResult {
  success: boolean;
  eventsChecked: number;
  eventsHidden: number;
  eventsUpdated: number;
  eventsKept: number;
  eventsSkipped: number;
  errors: number;
  results: VerificationResult[];
  totalTokensUsed: number;
  durationMs: number;
}

/**
 * Configuration options for verification.
 */
export interface VerificationOptions {
  /** Maximum events to check per run (default: 100) */
  maxEvents?: number;
  /** Delay between Jina API calls in ms (default: 120) */
  jinaDelayMs?: number;
  /** Delay between AI calls in ms (default: 100) */
  aiDelayMs?: number;
  /** Minimum days since last verification (default: 10) */
  verificationIntervalDays?: number;
  /** Maximum days into future to check events (default: 1000 events limit) */
  maxFutureEvents?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Dry run - don't actually update/hide events (default: false) */
  dryRun?: boolean;
}

const DEFAULT_OPTIONS: Required<VerificationOptions> = {
  maxEvents: 100,
  jinaDelayMs: 120, // ~500 RPM = 120ms between requests
  aiDelayMs: 100,
  verificationIntervalDays: 10,
  maxFutureEvents: 1000,
  verbose: false,
  dryRun: false,
};

/**
 * System prompt for event verification AI.
 */
const SYSTEM_PROMPT = `You analyze event page content to verify event status. Compare the web page content with the stored event data.

Your task:
1. Determine if this event is CANCELLED, POSTPONED, or no longer happening on the stored date
2. Check if the page is NOT about this specific event (wrong page, 404, generic content)
3. Identify any UPDATES to: price, description, or location

Response format (JSON only, no markdown):
{
  "action": "keep" | "hide" | "update",
  "reason": "brief explanation (max 50 words)",
  "confidence": 0.0-1.0,
  "updates": {
    "price": "new price string or null",
    "description": "brief updated description or null",
    "location": "updated location or null"
  }
}

Guidelines:
- "hide" = Event is cancelled, postponed indefinitely, or page doesn't contain this event
- "update" = Event is active but details differ from stored data
- "keep" = Event is active and details match stored data

Be CONSERVATIVE:
- Only hide if you're >80% confident the event is cancelled or wrong page
- Only update if you see clear differences in the actual event details
- When in doubt, use "keep"

Do NOT hide events just because:
- The page has limited information
- You can't find exact matches for all fields
- The format is different`;

/**
 * Check if event verification is available (both Jina and Azure AI configured).
 */
export function isVerificationEnabled(): boolean {
  return isJinaEnabled() && isAzureAIEnabled();
}

/**
 * Fetch page content via Jina Reader API.
 *
 * @param url - The event page URL to fetch
 * @returns Markdown content of the page, or null if failed
 */
export async function fetchPageContent(url: string): Promise<string | null> {
  if (!isJinaEnabled()) {
    console.warn("[Verify] Jina API key not configured");
    return null;
  }

  try {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;

    const response = await fetch(jinaUrl, {
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        "x-respond-with": "markdown",
        "x-timeout": "30",
      },
    });

    if (!response.ok) {
      console.warn(`[Verify] Jina fetch failed for ${url}: ${response.status}`);
      return null;
    }

    const content = await response.text();

    // Check for empty or error responses
    if (!content || content.length < 100) {
      console.warn(`[Verify] Jina returned minimal content for ${url}`);
      return null;
    }

    return content;
  } catch (error) {
    console.error(`[Verify] Error fetching ${url}:`, error);
    return null;
  }
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
    action: "keep",
    reason: "Default - no AI response",
    confidence: 0,
  };

  if (!isAzureAIEnabled()) {
    result.error = "Azure AI not configured";
    return result;
  }

  // Build user prompt with event data and page content
  const eventDate = event.startDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });

  const eventTime = event.startDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });

  // Truncate page content to avoid token limits
  const truncatedContent =
    pageContent.length > 8000
      ? pageContent.slice(0, 8000) + "\n\n[Content truncated...]"
      : pageContent;

  const userPrompt = `## Stored Event Data
Title: ${event.title}
Date: ${eventDate}
Time: ${eventTime}
Location: ${event.location || "Not specified"}
Organizer: ${event.organizer || "Not specified"}
Price: ${event.price || "Unknown"}
Source URL: ${event.url}

## Web Page Content
${truncatedContent}

Analyze the page content and determine if this event is still active and accurate.`;

  try {
    const aiResponse = await azureChatCompletion(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 10000, // Reasoning models need plenty of tokens for thinking + output
    });

    if (!aiResponse || !aiResponse.content) {
      result.error = "No AI response";
      return result;
    }

    // Parse JSON response
    const jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      result.error = "Invalid AI response format";
      return result;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    result.action = parsed.action || "keep";
    result.reason = parsed.reason || "No reason provided";
    result.confidence = parsed.confidence || 0;

    if (parsed.updates && result.action === "update") {
      result.updates = {
        price: parsed.updates.price || undefined,
        description: parsed.updates.description || undefined,
        location: parsed.updates.location || undefined,
      };
    }

    return result;
  } catch (error) {
    result.error = `AI error: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
}

/**
 * Filter events for verification based on criteria.
 *
 * @param events - All events to potentially verify
 * @param options - Verification options
 * @returns Filtered list of events to verify
 */
export function filterEventsForVerification(
  events: EventForVerification[],
  options: Required<VerificationOptions>
): EventForVerification[] {
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - options.verificationIntervalDays * 24 * 60 * 60 * 1000);

  return events
    .filter((event) => {
      // 1. Only verifiable sources
      if (!VERIFIABLE_SOURCES.includes(event.source as typeof VERIFIABLE_SOURCES[number])) {
        return false;
      }

      // 2. Skip hidden events
      // (handled in query, but safety check)

      // 3. Skip spam events based on default filters
      if (matchesDefaultFilter(event.title)) {
        return false;
      }
      if (event.description && matchesDefaultFilter(event.description)) {
        return false;
      }
      if (event.organizer && matchesDefaultFilter(event.organizer)) {
        return false;
      }

      // 4. Only future events
      if (event.startDate < now) {
        return false;
      }

      // 5. Skip recently verified events (within verificationIntervalDays)
      if (event.lastVerifiedAt && event.lastVerifiedAt > tenDaysAgo) {
        return false;
      }

      // 6. Must have a URL
      if (!event.url) {
        return false;
      }

      return true;
    })
    .slice(0, options.maxFutureEvents); // Limit to maxFutureEvents
}

/**
 * Process a batch of events for verification.
 *
 * @param events - Events to verify (already filtered)
 * @param options - Verification options
 * @returns Batch verification results
 */
export async function processEventVerification(
  events: EventForVerification[],
  options: Partial<VerificationOptions> = {}
): Promise<BatchVerificationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  const result: BatchVerificationResult = {
    success: true,
    eventsChecked: 0,
    eventsHidden: 0,
    eventsUpdated: 0,
    eventsKept: 0,
    eventsSkipped: 0,
    errors: 0,
    results: [],
    totalTokensUsed: 0,
    durationMs: 0,
  };

  if (!isVerificationEnabled()) {
    result.success = false;
    console.error("[Verify] Verification not enabled - check JINA_API_KEY and Azure AI config");
    return result;
  }

  // Filter events for verification
  const eventsToCheck = filterEventsForVerification(events, opts).slice(0, opts.maxEvents);

  if (opts.verbose) {
    console.log(`[Verify] Processing ${eventsToCheck.length} events (filtered from ${events.length})`);
  }

  for (const event of eventsToCheck) {
    try {
      if (opts.verbose) {
        console.log(`[Verify] Checking: ${event.title.slice(0, 50)}...`);
      }

      // Fetch page content via Jina
      const pageContent = await fetchPageContent(event.url);

      if (!pageContent) {
        result.eventsSkipped++;
        result.results.push({
          eventId: event.id,
          eventTitle: event.title,
          action: "keep",
          reason: "Could not fetch page content",
          confidence: 0,
          error: "Jina fetch failed",
        });
        continue;
      }

      // Rate limit delay for Jina
      await new Promise((r) => setTimeout(r, opts.jinaDelayMs));

      // Verify with AI
      const verificationResult = await verifyEventWithAI(event, pageContent);
      result.results.push(verificationResult);
      result.eventsChecked++;

      // Count results
      switch (verificationResult.action) {
        case "hide":
          result.eventsHidden++;
          if (opts.verbose) {
            console.log(`[Verify] HIDE: ${event.title} - ${verificationResult.reason}`);
          }
          break;
        case "update":
          result.eventsUpdated++;
          if (opts.verbose) {
            console.log(`[Verify] UPDATE: ${event.title} - ${verificationResult.reason}`);
          }
          break;
        case "keep":
          result.eventsKept++;
          break;
      }

      if (verificationResult.error) {
        result.errors++;
      }

      // Rate limit delay for AI
      await new Promise((r) => setTimeout(r, opts.aiDelayMs));
    } catch (error) {
      result.errors++;
      result.results.push({
        eventId: event.id,
        eventTitle: event.title,
        action: "keep",
        reason: "Processing error",
        confidence: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  result.durationMs = Date.now() - startTime;

  if (opts.verbose) {
    console.log(`[Verify] Complete in ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`[Verify] Checked: ${result.eventsChecked}, Hidden: ${result.eventsHidden}, Updated: ${result.eventsUpdated}, Kept: ${result.eventsKept}, Skipped: ${result.eventsSkipped}, Errors: ${result.errors}`);
  }

  return result;
}

/**
 * Verify a single event by ID (for testing).
 *
 * @param event - The event to verify
 * @returns Verification result
 */
export async function verifySingleEvent(
  event: EventForVerification
): Promise<VerificationResult> {
  if (!isVerificationEnabled()) {
    return {
      eventId: event.id,
      eventTitle: event.title,
      action: "keep",
      reason: "Verification not enabled",
      confidence: 0,
      error: "Check JINA_API_KEY and Azure AI config",
    };
  }

  console.log(`[Verify] Fetching page content for: ${event.url}`);
  const pageContent = await fetchPageContent(event.url);

  if (!pageContent) {
    return {
      eventId: event.id,
      eventTitle: event.title,
      action: "keep",
      reason: "Could not fetch page content",
      confidence: 0,
      error: "Jina fetch failed",
    };
  }

  console.log(`[Verify] Page content fetched (${pageContent.length} chars), analyzing with AI...`);
  return verifyEventWithAI(event, pageContent);
}
