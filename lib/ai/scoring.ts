/**
 * AI-powered event quality scoring using Azure OpenAI.
 *
 * Scores events on three dimensions (0-10 each, total 0-30):
 * - Rarity & Urgency: How often does this event happen?
 * - Cool & Unique Factor: How novel/interesting is this event?
 * - Talent & Production Magnitude: What's the scale/caliber?
 *
 * Uses similar events context to assess uniqueness and rarity.
 */

import { azureChatCompletion, isAzureAIEnabled } from './azure-client';

export interface EventScoreResult {
  score: number;      // Total 0-30
  rarity: number;     // 0-10
  unique: number;     // 0-10
  magnitude: number;  // 0-10
  reason: string;     // One sentence explanation
}

export interface EventForScoring {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  organizer: string | null;
  tags: string[] | null;
  aiSummary: string | null;
  startDate: Date;
  price: string | null;
}

export interface SimilarEventContext {
  title: string;
  location: string | null;
  organizer: string | null;
  startDate: Date;
  similarity: number;
}

const SCORING_SYSTEM_PROMPT = `You are an expert Event Curator scoring events for a local events calendar in Asheville, NC. Score each event on THREE dimensions (0-10 each) to help users discover the most interesting events.

## DIMENSION 1 - Rarity & Urgency (How often does this happen?)

IMPORTANT: Determine if this event is recurring BEFORE scoring:
- Weekly recurring: rarity 0-2 (even if it's at a nice venue)
- Monthly recurring: rarity 2-3
- Annual recurring (including holiday events): rarity 3-4
- True one-offs (tours, festivals, special collaborations): rarity 5-10

Score guide:
- 0-2: Daily/weekly recurring (trivia nights, open mics, weekly classes)
- 3-4: Monthly events OR annual recurring (monthly showcases, annual Christmas parties)
- 5-6: Limited runs (3-week theater run, seasonal exhibit)
- 7-8: One-time special events (specific tour dates, unique collaborations)
- 9-10: Major one-offs (legendary artist tour, major festival)

HOLIDAY RULE: Holiday timing (Christmas, NYE) does NOT automatically increase rarity. An annual Christmas event = rarity 3-4, not 6-8.

## DIMENSION 2 - Cool & Unique Factor (How novel/interesting is this?)

IMPORTANT: If there are 10+ similar events with >70% similarity, uniqueness should rarely exceed 5.

Score guide:
- 0-2: Standard/utility (support groups, basic classes, city meetings)
- 3-4: Common entertainment (cover bands, standard yoga, regular comedy)
- 5-6: Somewhat distinctive (themed events, niche interests)
- 7-8: Genuinely creative (unusual format, specialized skills, immersive)
- 9-10: Truly exceptional ("GWAR", mini wrestling, major art installations)

SIMILARITY RULE: A creatively-produced event that's similar to many others still has LOW uniqueness. Novel format + common type = moderate uniqueness (4-6), not high (7+).

## DIMENSION 3 - Talent & Production Magnitude (What's the scale/caliber?)

IMPORTANT: Venue prestige alone doesn't determine magnitude. A bar cover band at Orange Peel is still magnitude 3-4.

Score guide:
- 1-2: Casual, minimal production (meetups, group walks, peer-led)
- 3-4: Local professional (bar bands, small workshops, local instructors)
- 5-6: Established local production (monthly showcases, established series, local theater)
- 7-8: Regional draw or major local production (touring regional acts, symphony, professional theater)
- 9-10: National/international (Bob Dylan, arena acts, legendary status)

COVER BAND RULE: Cover bands at bars = magnitude 3-4 max, regardless of venue.

## SIMILAR EVENTS CONTEXT

Use the similar events list to calibrate your scores:
- 15+ similar events at 80%+ similarity = this is a COMMON event type, lower rarity and uniqueness
- 5-15 similar events = moderate commonality
- <5 similar events = potentially unique

## OUTPUT FORMAT

Return ONLY valid JSON:
{"rarity": N, "unique": N, "magnitude": N, "reason": "One sentence explaining the total score."}

Where N is an integer from 0-10. Be conservative - most events should score 8-18 total, not 20+.`;

/**
 * Generate a quality score for an event using Azure OpenAI.
 * Uses similar events context to assess rarity and uniqueness.
 */
export async function generateEventScore(
  event: EventForScoring,
  similarEvents: SimilarEventContext[]
): Promise<EventScoreResult | null> {
  if (!isAzureAIEnabled()) {
    console.warn('[Scoring] Azure AI not configured, skipping');
    return null;
  }

  // Build event info
  const eventInfo = [
    `Title: ${event.title}`,
    event.description ? `Description: ${event.description.slice(0, 300)}` : null,
    event.location ? `Location: ${event.location}` : null,
    event.organizer ? `Organizer: ${event.organizer}` : null,
    event.tags?.length ? `Tags: ${event.tags.join(', ')}` : null,
    event.aiSummary ? `Summary: ${event.aiSummary}` : null,
    `Date: ${event.startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
    event.price ? `Price: ${event.price}` : null,
  ].filter(Boolean).join('\n');

  // Build similar events context
  let similarEventsText = '(No similar events found - this may indicate a unique event)';
  if (similarEvents.length > 0) {
    const eventLines = similarEvents.map((e, i) => {
      const dateStr = e.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const location = e.location || e.organizer || 'Unknown venue';
      const similarity = Math.round(e.similarity * 100);
      return `${i + 1}. "${e.title}" at ${location} on ${dateStr} (${similarity}% similar)`;
    });
    similarEventsText = eventLines.join('\n');
  }

  const userPrompt = `Score this event:

${eventInfo}

Similar upcoming events (by semantic similarity):
${similarEventsText}`;

  try {
    const result = await azureChatCompletion(
      SCORING_SYSTEM_PROMPT,
      userPrompt,
      { maxTokens: 20000 }
    );

    if (!result) {
      console.warn('[Scoring] No response from Azure AI');
      return null;
    }

    // Clean up and parse response
    const cleanedText = result.content
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(cleanedText);

    // Validate and clamp scores to 0-10
    const clamp = (n: unknown): number => {
      const num = typeof n === 'number' ? n : parseInt(String(n), 10);
      if (isNaN(num)) return 5; // Default to middle if invalid
      return Math.max(0, Math.min(10, Math.round(num)));
    };

    const rarity = clamp(parsed.rarity);
    const unique = clamp(parsed.unique);
    const magnitude = clamp(parsed.magnitude);
    const score = rarity + unique + magnitude;

    // Validate reason
    let reason = 'Score generated by AI.';
    if (typeof parsed.reason === 'string' && parsed.reason.trim()) {
      reason = parsed.reason.trim().slice(0, 500); // Cap at 500 chars
    }

    console.log(`[Scoring] "${event.title.slice(0, 30)}...": ${score}/30 (R:${rarity} U:${unique} M:${magnitude}) - ${result.usage.totalTokens} tokens`);

    return { score, rarity, unique, magnitude, reason };
  } catch (error) {
    console.error('[Scoring] Error:', error);
    return null;
  }
}

/**
 * Generate scores for multiple events in batch.
 * Requires similar events to be fetched beforehand for each event.
 */
export async function generateEventScoresBatch(
  eventsWithContext: Array<{
    event: EventForScoring;
    similarEvents: SimilarEventContext[];
  }>,
  options?: {
    delayMs?: number;
    onProgress?: (current: number, total: number, event: EventForScoring, result: EventScoreResult | null) => void;
  }
): Promise<Map<string, EventScoreResult | null>> {
  const { delayMs = 500, onProgress } = options || {};
  const results = new Map<string, EventScoreResult | null>();

  for (let i = 0; i < eventsWithContext.length; i++) {
    const { event, similarEvents } = eventsWithContext[i];
    const result = await generateEventScore(event, similarEvents);
    results.set(event.id, result);

    onProgress?.(i + 1, eventsWithContext.length, event, result);

    // Add delay between requests to avoid rate limits
    if (i < eventsWithContext.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Create a default score for recurring events.
 * Daily/weekly recurring events get a fixed low score of 5/30.
 */
export function getRecurringEventScore(type: 'daily' | 'weekly'): EventScoreResult {
  return {
    score: 5,
    rarity: 1,  // Very low - happens frequently
    unique: 2,  // Low - common activity type
    magnitude: 2, // Low - typically local/community level
    reason: type === 'daily'
      ? 'Daily recurring event - happens every day.'
      : 'Weekly recurring event - happens every week.'
  };
}
