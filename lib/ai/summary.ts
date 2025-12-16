/**
 * AI-powered event summary generation using Azure OpenAI.
 *
 * Generates structured 1-2 sentence summaries for events
 * that are optimized for embedding and semantic search.
 */

import { azureChatCompletion, isAzureAIEnabled } from './azure-client';

export interface EventSummaryInput {
  title: string;
  description?: string | null;
  location?: string | null;
  organizer?: string | null;
  tags?: string[] | null;
  startDate?: Date | null;
}

const SUMMARY_SYSTEM_PROMPT = `You are a concise event summarizer. Generate a 1-2 sentence structured summary of events for semantic search indexing.

Format: "[Event type] at [venue name] featuring [key details]. [Target audience or special note if relevant]."

Rules:
- Be factual and specific
- Include the venue name if provided, but do NOT include the city name (e.g., "Asheville", "Asheville, NC") - the city is already displayed separately in the UI
- Mention key activities or features
- Keep under 50 words
- Use present tense
- Do not include dates or times
- Do not include prices
- Do not start with "This event" or similar phrases
- Output ONLY the summary, nothing else`;

/**
 * Generate a structured summary for an event using Azure OpenAI.
 * Returns null if Azure AI is not configured or if generation fails.
 */
export async function generateEventSummary(
  event: EventSummaryInput
): Promise<string | null> {
  if (!isAzureAIEnabled()) {
    console.warn('[Summary] Azure AI not configured, skipping summary generation');
    return null;
  }

  const eventInfo = [
    `Title: ${event.title}`,
    event.description ? `Description: ${event.description.slice(0, 500)}` : null,
    event.location ? `Location: ${event.location}` : null,
    event.organizer ? `Organizer: ${event.organizer}` : null,
    event.tags?.length ? `Tags: ${event.tags.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  try {
    const result = await azureChatCompletion(
      SUMMARY_SYSTEM_PROMPT,
      `Summarize this event:\n\n${eventInfo}`,
      { maxTokens: 20000 } // Need many tokens for reasoning models (o1/o3 style)
    );

    if (!result) {
      console.warn('[Summary] No response from Azure AI');
      return null;
    }

    // Clean up the summary
    const summary = result.content
      .trim()
      .replace(/^["']|["']$/g, '') // Remove quotes if present
      .replace(/\n+/g, ' '); // Replace newlines with spaces

    if (!summary) {
      console.warn('[Summary] Empty content from Azure AI');
      return null;
    }

    console.log(`[Summary] Generated (${result.usage.totalTokens} tokens): ${summary.slice(0, 60)}...`);
    return summary;
  } catch (error) {
    console.error('[Summary] Error generating summary:', error);
    return null;
  }
}

/**
 * Generate summaries for multiple events in batch.
 * Processes sequentially to avoid rate limits.
 */
export async function generateEventSummaries(
  events: EventSummaryInput[],
  options?: {
    delayMs?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<(string | null)[]> {
  const { delayMs = 200, onProgress } = options || {};
  const results: (string | null)[] = [];

  for (let i = 0; i < events.length; i++) {
    const summary = await generateEventSummary(events[i]);
    results.push(summary);

    onProgress?.(i + 1, events.length);

    // Add delay between requests to avoid rate limits
    if (i < events.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
