/**
 * AI-powered event deduplication using Azure OpenAI.
 *
 * This is a final deduplication step that uses GPT to identify duplicates
 * that rule-based methods might miss, such as:
 * - Events with completely different titles but same content
 * - Events where organizer/venue naming varies significantly
 * - Subtle duplicates requiring semantic understanding
 */

import { azureChatCompletion, isAzureAIEnabled } from "./azure-client";
import { matchesDefaultFilter } from "../config/defaultFilters";

/**
 * Event data structure for AI deduplication.
 */
export interface EventForAIDedup {
  id: string;
  title: string;
  description: string | null;
  organizer: string | null;
  location: string | null;
  startDate: Date;
  price: string | null;
  source: string;
}

/**
 * Result from AI duplicate detection.
 */
export interface AIDuplicateGroup {
  remove: string[];    // IDs to remove
  reason: string;      // AI's explanation
}

/**
 * Result from processing a single day.
 */
export interface DayResult {
  date: string;
  eventCount: number;
  duplicatesFound: number;
  groups: AIDuplicateGroup[];
  tokensUsed: number;
  error?: string;
}

/**
 * Overall result from AI deduplication.
 */
export interface AIDeduplicationResult {
  success: boolean;
  daysProcessed: number;
  totalDuplicatesFound: number;
  idsToRemove: string[];
  totalTokensUsed: number;
  dayResults: DayResult[];
  errors: string[];
}

/**
 * System prompt for the AI deduplication task.
 */
const SYSTEM_PROMPT = `You identify duplicate event listings. Analyze events on the same day and return the numeric IDs of duplicates to REMOVE.

DUPLICATES are the same real-world event listed multiple times:
- Same event at same venue with different titles
- Same performer at same venue from different sources
- Titles that are variations of each other at same time/venue

NOT DUPLICATES:
- Different events at same venue (different times, 2+ hours apart)
- Similar events at different venues

When duplicates exist, REMOVE the one with:
- "Unknown" price (keep the one with known price)
- Less complete title/description
- Aggregator source (keep venue/primary source)

Be conservative - only flag clear duplicates.

Respond with ONLY valid JSON (no markdown):
{"duplicates":[{"remove":[1,2],"reason":"brief reason"}]}

If no duplicates: {"duplicates":[]}`;

/**
 * Format a single event for the AI prompt.
 * Uses a simple index instead of UUID for easier AI processing.
 */
function formatEventForPrompt(event: EventForAIDedup, index: number): string {
  const time = event.startDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });

  // Truncate description to avoid excessive token usage
  let description = event.description || "";
  if (description.length > 300) {
    description = description.slice(0, 300) + "...";
  }

  return JSON.stringify({
    id: index,
    title: event.title,
    description: description || "No description",
    organizer: event.organizer || "Unknown",
    location: event.location || "Unknown",
    time,
    price: event.price || "Unknown",
    source: event.source,
  });
}

/**
 * Filter out spam events based on default filters.
 */
function filterSpamEvents(events: EventForAIDedup[]): EventForAIDedup[] {
  return events.filter((event) => {
    // Check title
    if (matchesDefaultFilter(event.title)) {
      return false;
    }
    // Check description
    if (event.description && matchesDefaultFilter(event.description)) {
      return false;
    }
    // Check organizer
    if (event.organizer && matchesDefaultFilter(event.organizer)) {
      return false;
    }
    return true;
  });
}

/**
 * Group events by date (ignoring time).
 */
function groupEventsByDate(events: EventForAIDedup[]): Map<string, EventForAIDedup[]> {
  const grouped = new Map<string, EventForAIDedup[]>();

  for (const event of events) {
    // Use Eastern time date to match local event dates
    const dateKey = event.startDate.toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    }); // YYYY-MM-DD format

    const existing = grouped.get(dateKey) || [];
    existing.push(event);
    grouped.set(dateKey, existing);
  }

  return grouped;
}

/**
 * Parsed duplicate group with numeric indices (before mapping to UUIDs).
 */
interface ParsedDuplicateGroup {
  remove: number[];
  reason: string;
}

/**
 * Parse the AI response into duplicate groups with numeric indices.
 */
function parseAIResponse(response: string): ParsedDuplicateGroup[] {
  try {
    // Clean up response - remove any markdown formatting
    let cleaned = response.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    if (!parsed.duplicates || !Array.isArray(parsed.duplicates)) {
      console.warn("[AI Dedup] Invalid response format: missing duplicates array");
      return [];
    }

    // Validate each group (now expecting numeric IDs)
    const validGroups: ParsedDuplicateGroup[] = [];
    for (const group of parsed.duplicates) {
      if (
        Array.isArray(group.remove) &&
        group.remove.length > 0 &&
        group.remove.every((id: unknown) => typeof id === "number") &&
        typeof group.reason === "string"
      ) {
        validGroups.push({
          remove: group.remove,
          reason: group.reason,
        });
      } else {
        console.warn("[AI Dedup] Skipping invalid group:", group);
      }
    }

    return validGroups;
  } catch (error) {
    console.error("[AI Dedup] Failed to parse AI response:", error);
    console.error("[AI Dedup] Raw response:", response);
    return [];
  }
}

/**
 * Map numeric indices back to UUIDs and validate.
 */
function mapIndicesToUUIDs(
  groups: ParsedDuplicateGroup[],
  indexToId: Map<number, string>
): AIDuplicateGroup[] {
  const result: AIDuplicateGroup[] = [];

  for (const group of groups) {
    const mappedIds: string[] = [];
    const invalidIndices: number[] = [];

    for (const index of group.remove) {
      const uuid = indexToId.get(index);
      if (uuid) {
        mappedIds.push(uuid);
      } else {
        invalidIndices.push(index);
      }
    }

    if (invalidIndices.length > 0) {
      console.warn(`[AI Dedup] Invalid indices in group: ${invalidIndices.join(", ")}`);
    }

    if (mappedIds.length > 0) {
      result.push({
        remove: mappedIds,
        reason: group.reason,
      });
    }
  }

  return result;
}

/**
 * Process a single day's events for duplicates.
 */
async function processDayEvents(
  date: string,
  events: EventForAIDedup[]
): Promise<DayResult> {
  // Filter out spam events first
  const filteredEvents = filterSpamEvents(events);

  const result: DayResult = {
    date,
    eventCount: filteredEvents.length,
    duplicatesFound: 0,
    groups: [],
    tokensUsed: 0,
  };

  // Skip days with only 1 event (can't have duplicates)
  if (filteredEvents.length < 2) {
    return result;
  }

  // Create index-to-UUID mapping (1-indexed for human readability)
  const indexToId = new Map<number, string>();
  filteredEvents.forEach((event, i) => {
    indexToId.set(i + 1, event.id);
  });

  // Format events for prompt with indices
  const eventLines = filteredEvents.map((event, i) => formatEventForPrompt(event, i + 1)).join("\n");
  const userPrompt = `Here are ${filteredEvents.length} events on ${date}. Identify any duplicates:\n\n${eventLines}`;

  try {
    // Save input to file for debugging (if debugDir is set)
    const debugDir = process.env.AI_DEDUP_DEBUG_DIR;
    if (debugDir) {
      const fs = await import("fs/promises");
      const inputPath = `${debugDir}/input-${date}.txt`;
      await fs.writeFile(inputPath, `SYSTEM PROMPT:\n${SYSTEM_PROMPT}\n\nUSER PROMPT:\n${userPrompt}`, "utf-8");
    }

    const response = await azureChatCompletion(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 4000, // Enough for detailed JSON response
    });

    if (!response) {
      result.error = "AI client not available";
      return result;
    }

    // Save output to file for debugging (if debugDir is set)
    if (debugDir) {
      const fs = await import("fs/promises");
      const outputPath = `${debugDir}/output-${date}.txt`;
      await fs.writeFile(outputPath, response.content, "utf-8");
    }

    result.tokensUsed = response.usage.totalTokens;

    // Parse response and map indices back to UUIDs
    const groups = parseAIResponse(response.content);
    const validGroups = mapIndicesToUUIDs(groups, indexToId);

    result.groups = validGroups;
    result.duplicatesFound = validGroups.reduce(
      (sum, g) => sum + g.remove.length,
      0
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[AI Dedup] Error processing ${date}:`, errorMessage);
    result.error = errorMessage;
    return result;
  }
}

/**
 * Run AI-powered deduplication on all events.
 *
 * @param events - All events to check for duplicates
 * @param options - Configuration options
 * @returns Result with IDs to remove and detailed logs
 */
export async function runAIDeduplication(
  events: EventForAIDedup[],
  options?: {
    maxDays?: number;         // Max days to process (for testing)
    delayBetweenDays?: number; // Delay in ms between API calls
    verbose?: boolean;         // Log progress
  }
): Promise<AIDeduplicationResult> {
  const verbose = options?.verbose ?? true;
  const delayMs = options?.delayBetweenDays ?? 500;
  const maxDays = options?.maxDays;

  const result: AIDeduplicationResult = {
    success: true,
    daysProcessed: 0,
    totalDuplicatesFound: 0,
    idsToRemove: [],
    totalTokensUsed: 0,
    dayResults: [],
    errors: [],
  };

  // Check if AI is available
  if (!isAzureAIEnabled()) {
    result.success = false;
    result.errors.push("Azure OpenAI not configured");
    return result;
  }

  // Group events by date
  const eventsByDate = groupEventsByDate(events);
  const dates = Array.from(eventsByDate.keys()).sort();

  if (verbose) {
    console.log(`[AI Dedup] Processing ${dates.length} dates with ${events.length} total events`);
  }

  // Process each date
  let processedCount = 0;
  for (const date of dates) {
    // Check max days limit
    if (maxDays && processedCount >= maxDays) {
      if (verbose) {
        console.log(`[AI Dedup] Reached max days limit (${maxDays})`);
      }
      break;
    }

    const dayEvents = eventsByDate.get(date)!;

    // Skip days with only 1 event
    if (dayEvents.length < 2) {
      continue;
    }

    if (verbose) {
      console.log(`[AI Dedup] Processing ${date}: ${dayEvents.length} events`);
    }

    const dayResult = await processDayEvents(date, dayEvents);
    result.dayResults.push(dayResult);
    result.daysProcessed++;
    result.totalTokensUsed += dayResult.tokensUsed;

    if (dayResult.error) {
      result.errors.push(`${date}: ${dayResult.error}`);
    }

    if (dayResult.duplicatesFound > 0) {
      result.totalDuplicatesFound += dayResult.duplicatesFound;
      for (const group of dayResult.groups) {
        result.idsToRemove.push(...group.remove);
      }

      if (verbose) {
        console.log(`[AI Dedup] Found ${dayResult.duplicatesFound} to remove on ${date}`);
        for (const group of dayResult.groups) {
          for (const removeId of group.remove) {
            const ev = events.find(e => e.id === removeId);
            console.log(`  - Remove: "${ev?.title}" (${ev?.source})`);
          }
          console.log(`    Reason: ${group.reason}`);
        }
      }
    }

    processedCount++;

    // Delay between API calls to avoid rate limiting
    if (delayMs > 0 && processedCount < dates.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (verbose) {
    console.log(`[AI Dedup] Complete: ${result.totalDuplicatesFound} duplicates found across ${result.daysProcessed} days`);
    console.log(`[AI Dedup] Total tokens used: ${result.totalTokensUsed}`);
  }

  return result;
}

/**
 * Check if AI deduplication is available.
 */
export function isAIDeduplicationAvailable(): boolean {
  return isAzureAIEnabled();
}
