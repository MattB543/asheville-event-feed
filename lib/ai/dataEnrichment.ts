/**
 * AI-powered event data enrichment using Azure OpenAI GPT-5-mini.
 *
 * Extracts missing price and time information from event pages
 * when regex-based extraction fails.
 */

import { azureChatCompletion, isAzureAIEnabled } from './azure-client';
import { fetchAndConvertToMarkdown } from '@/lib/utils/htmlToMarkdown';
import { applyTimeToDate } from '@/lib/utils/extractTime';

export interface EnrichmentInput {
  title: string;
  description?: string | null;
  url: string;
  organizer?: string | null;
  currentPrice?: string | null;
  timeUnknown?: boolean;
  currentStartDate?: Date;
}

export interface EnrichmentResult {
  price?: string;           // Extracted price: "Free", "$20", "$20+", "Ticketed"
  time?: string;            // Extracted time: "19:00" (24-hour format)
  updatedStartDate?: Date;  // If time was extracted, the updated start date
  confidence: 'high' | 'medium' | 'low';
  source: 'ai' | 'page_content';
}

const EXTRACTION_SYSTEM_PROMPT = `You are a data extraction assistant. Extract event pricing and timing information from event descriptions and web page content.

IMPORTANT RULES:
1. Extract information that is EXPLICITLY stated OR strongly implied in the content
2. Common price phrases to recognize:
   - "$20 at the door", "20 bucks", "$15-25" → extract the price
   - "free event", "no cover", "free admission", "open to all" → "Free"
   - "buy tickets", "tickets available", "ticketed event" without price → "Ticketed"
   - Community events, meetups, public gatherings without price mentioned → likely "Free"
3. PRICE FORMAT - Always normalize to one of these formats:
   - "$25" - exact price
   - "$25+" - minimum price (for "starting at $25", "$25 and up", etc.)
   - "$15 - $30" - price range
   - "Free" - free events
   - "Ticketed" - requires tickets but price unknown
   - Do NOT include explanations like "$15 per person" - just "$15"
   - For complex prices like "$15 per child + adult" → "$15+"
4. For time, extract if a specific start time is mentioned (e.g., "7pm", "19:00", "doors at 6, show at 7", "starting at 8")
5. Return time in 24-hour format (e.g., "19:00" not "7:00 PM")
6. If you see a "doors" time and "show" time, return the show time
7. Use your judgment - if it's clearly a free community event or paid concert, indicate that

Return ONLY a JSON object with this structure (no markdown, no explanation):
{"price": "$25" | "$25+" | "$15 - $30" | "Free" | "Ticketed" | null, "time": "19:00" | null, "confidence": "high" | "medium" | "low"}`;

/**
 * Extract price and time from an event page using AI.
 * First tries to fetch the event page, falls back to description if fetch fails.
 *
 * @param input - Event information and what needs to be extracted
 * @returns EnrichmentResult or null if extraction fails
 */
export async function enrichEventData(
  input: EnrichmentInput
): Promise<EnrichmentResult | null> {
  if (!isAzureAIEnabled()) {
    console.warn('[Enrichment] Azure AI not configured');
    return null;
  }

  // Determine what we need to extract
  const needsPrice = !input.currentPrice || input.currentPrice === 'Unknown';
  const needsTime = input.timeUnknown === true;

  if (!needsPrice && !needsTime) {
    // Nothing to enrich
    return null;
  }

  // Try to fetch the event page, fall back to description if that fails
  let contentSource: 'page' | 'description' = 'page';
  let pageMarkdown = await fetchAndConvertToMarkdown(input.url, 12000);

  if (!pageMarkdown) {
    // Fall back to using the description we already have
    if (input.description && input.description.trim().length > 10) {
      pageMarkdown = input.description;
      contentSource = 'description';
      console.log(`[Enrichment] Using description fallback for "${input.title}"`);
    } else {
      console.warn(`[Enrichment] No content available for "${input.title}" (page fetch failed, no description)`);
      return null;
    }
  }

  // Build the extraction prompt with all available context
  const userPrompt = `Event: "${input.title}"
Organizer: ${input.organizer || 'Unknown'}
URL: ${input.url}
${needsPrice ? 'NEED TO EXTRACT: Price (currently unknown)' : ''}
${needsTime ? 'NEED TO EXTRACT: Event start time (currently unknown)' : ''}

${contentSource === 'page' ? 'Page content' : 'Event description'}:
---
${pageMarkdown}
---

Extract the requested information. If the event appears to be a free community event/meetup with no price mentioned, return "Free". If it's clearly a ticketed show (concert, comedy, theater) but no price is shown, return "Ticketed".`;

  try {
    const result = await azureChatCompletion(
      EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
      { maxTokens: 4000 }
    );

    if (!result || !result.content) {
      console.warn(`[Enrichment] No response for "${input.title}"`);
      return null;
    }

    // Parse the JSON response
    let parsed: { price?: string | null; time?: string | null; confidence?: string };
    try {
      // Clean up the response (remove any markdown formatting)
      const cleanContent = result.content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      parsed = JSON.parse(cleanContent);
    } catch {
      console.warn(`[Enrichment] Failed to parse response for "${input.title}": ${result.content}`);
      return null;
    }

    const enrichmentResult: EnrichmentResult = {
      confidence: (parsed.confidence as 'high' | 'medium' | 'low') || 'medium',
      source: 'ai',
    };

    // Process extracted price
    if (needsPrice && parsed.price) {
      // Validate the price format
      if (
        parsed.price === 'Free' ||
        parsed.price === 'Ticketed' ||
        /^\$\d+(\.\d{2})?\+?$/.test(parsed.price) ||
        /^\$\d+\s*-\s*\$\d+$/.test(parsed.price)
      ) {
        enrichmentResult.price = parsed.price;
      } else if (parsed.price.toLowerCase().startsWith('free')) {
        // Handle "Free (suggested donation $X)" or similar
        enrichmentResult.price = 'Free';
        console.log(`[Enrichment] Normalized "${parsed.price}" → "Free"`);
      } else {
        // Try to extract just the dollar amount from complex formats like "$75 per person"
        const priceMatch = parsed.price.match(/^\$(\d+(?:\.\d{2})?)/);
        if (priceMatch) {
          enrichmentResult.price = `$${Math.round(parseFloat(priceMatch[1]))}`;
          console.log(`[Enrichment] Normalized complex price "${parsed.price}" → "${enrichmentResult.price}"`);
        }
      }
    }

    // Process extracted time
    if (needsTime && parsed.time && input.currentStartDate) {
      // Validate time format (HH:MM)
      const timeMatch = parsed.time.match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch) {
        const hour = parseInt(timeMatch[1], 10);
        const minute = parseInt(timeMatch[2], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
          enrichmentResult.time = parsed.time;
          enrichmentResult.updatedStartDate = applyTimeToDate(
            input.currentStartDate,
            hour,
            minute
          );
        }
      }
    }

    // Only return if we actually extracted something
    if (enrichmentResult.price || enrichmentResult.time) {
      console.log(`[Enrichment] Extracted for "${input.title}": price=${enrichmentResult.price}, time=${enrichmentResult.time}`);
      return enrichmentResult;
    }

    return null;
  } catch (error) {
    console.error(`[Enrichment] Error processing "${input.title}":`, error);
    return null;
  }
}

/**
 * Batch enrich multiple events.
 * Processes sequentially to respect rate limits.
 *
 * @param events - Array of events to enrich
 * @param options - Processing options
 * @returns Map of event URL to enrichment result
 */
export async function batchEnrichEvents(
  events: EnrichmentInput[],
  options?: {
    delayMs?: number;
    onProgress?: (current: number, total: number, event: EnrichmentInput) => void;
  }
): Promise<Map<string, EnrichmentResult>> {
  const { delayMs = 500, onProgress } = options || {};
  const results = new Map<string, EnrichmentResult>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    onProgress?.(i + 1, events.length, event);

    const result = await enrichEventData(event);
    if (result) {
      results.set(event.url, result);
    }

    // Rate limit delay (except for last item)
    if (i < events.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
