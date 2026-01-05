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

import { azureChatCompletion, isAzureAIEnabled } from './provider-clients';

export interface EventScoreResult {
  score: number; // Total 0-30
  rarity: number; // 0-10
  unique: number; // 0-10
  magnitude: number; // 0-10
  reason: string; // One sentence explanation
  // Secondary dimensions (1-10, for future "Top 30" lists)
  ashevilleWeird: number; // 1-10: How "Asheville weird" is this event
  social: number; // 1-10: How good is this for meeting new people
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

interface ScoreAIResponse {
  rarity?: number;
  unique?: number;
  magnitude?: number;
  reason?: string;
  // Secondary dimensions
  ashevilleWeird?: number;
  social?: number;
}

const SCORING_SYSTEM_PROMPT = `You are an expert Event Curator for Asheville, NC. Your goal is to rank events so that the "Score" acts as a discovery heat-map.

## DIMENSION 1 - Rarity & Urgency (0-10)
How "missable" is this?
- 1-3: Daily/Weekly (Trivia, regular yoga, open mics).
- 4-5: Monthly or Seasonal (Monthly markets, standard holiday displays like Winter Lights).
- 6-7: Special Limited Runs (A 2-week theater run, a 3-stop workshop series).
- 8-9: True One-Offs (A touring band's only stop, a specific guest speaker, a unique gala).
- 10: Once-in-a-decade (Legendary artist, Centennial celebration, Solar Eclipse).

## DIMENSION 2 - Cool & Unique Factor (0-10)
How much "Main Character Energy" does this event have?
- 1-3: Standard/Utility (AA meetings, generic classes, basic networking).
- 4-6: Solid Entertainment (Local bands, standard stand-up, local brewery jams).
- 7-8: High Concept (Themed masquerades, specialized workshops like "Tarot with Cats," niche festivals).
- 9-10: Truly Novel (GWAR, extreme circus, "Crankie Fest," events with high production "weirdness").

## DIMENSION 3 - Magnitude & Caliber (0-10)
What is the scale of the "Draw"?
- 1-3: Hyper-local/Peer-led (Small meetups, student groups, neighborhood walks).
- 4-5: Professional Local (Established local acts, venue-staple performers, paid workshops).
- 6-7: Regional Draw (Well-known SE touring acts, mid-sized venue headliners like at Grey Eagle).
- 8-9: National Headliner (Acts at Orange Peel, Harrah's Arena, or major touring theater).
- 10: Global Icon (A-list celebrities, stadium-level acts, massive 10k+ person festivals).

## DIMENSION 4 - Asheville Weird (1-10)
How much does this event embody the unique "Asheville weird" spirit? Think: quirky, counter-culture, artsy, granola, mountain hippie, progressive, offbeat.
- 1-2: Completely conventional (Corporate events, chain restaurant promos, standard sports).
- 3-4: Slightly alternative (Local craft brewery, yoga classes, farmers markets).
- 5-6: Notably Asheville (Drum circles, crystal shops, farm-to-table events, local art walks).
- 7-8: Distinctly weird (Fire spinning, ecstatic dance, sound baths, "Crankie" shows, oddball festivals).
- 9-10: Peak Asheville weird (Naked bike rides, underground puppet theater, experimental performance art, uniquely bizarre local traditions).

## DIMENSION 5 - Social/Meet New People (1-10)
How conducive is this event to meeting new people and making connections?
- 1-2: Solo/Passive consumption (Movies, seated concerts, lectures with no interaction).
- 3-4: Limited interaction (Dining, shows with intermission chat, guided tours).
- 5-6: Moderate socializing (Classes, workshops, casual sports leagues, brewery hangouts).
- 7-8: High social potential (Networking events, group activities, dance classes, game nights, volunteer events).
- 9-10: Explicitly social (Speed dating, singles mixers, newcomer meetups, social clubs designed for connection).

## CALIBRATION LOGIC:
- If it's a TOURING ACT at a major venue (Orange Peel, Grey Eagle, Rabbit Rabbit), it should automatically start at 18+ total.
- If it's a massive ASHEVILLE TRADITION (Gingerbread competition, Crankie Fest), it should score 20+.
- RECURRING EVENT RULE: A weekly event can still score high on Magnitude/Uniqueness. Don't let a "1" in Rarity crush a "9" in Magnitude.
- THE TRIVIA/KARAOKE CAP: Standard pub trivia, karaoke, and open mics should NEVER score higher than a 4 in "Unique" and "Magnitude" unless there is a significant, documented "Main Character" twist.
- THE "ASHEVILLE WEIRD" BONUS: Reward events that are uniquely "Asheville" (e.g., busking festivals, mountain-specific crafts, or "Crankie Fest") with +2 to the "Unique" score.
- MAGNITUDE CLARITY:
    - 1-3: Small bars, cafes, or virtual-only.
    - 4-6: Established local venues (Ginger's Revenge, One World West, Jack of the Wood).
    - 7-8: Major regional venues (The Grey Eagle, Orange Peel, Wortham Center).
    - 9-10: Stadium/Arena (Harrah's Cherokee Center).
- RECURRING CLIFF: While you auto-score weekly events as 5, if an event is NOT recurring but feels low-effort (like a basic bar DJ), it should stay in the 8-12 range, not the 15-18 range.
- BELL CURVE: Aim for a broader spread.
  - 0-14: Standard weekly/utility (hidden by default).
  - 15-18: High-quality local weekend options.
  - 19-24: Major touring shows and significant local productions.
  - 25-30: "The biggest event of the month."

Return ONLY valid JSON:
{"rarity": N, "unique": N, "magnitude": N, "ashevilleWeird": N, "social": N, "reason": "Short explanation."}`;

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
  ]
    .filter(Boolean)
    .join('\n');

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
    const result = await azureChatCompletion(SCORING_SYSTEM_PROMPT, userPrompt, {
      maxTokens: 20000,
    });

    if (!result) {
      console.warn('[Scoring] No response from Azure AI');
      return null;
    }

    // Clean up and parse response
    const cleanedText = result.content
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(cleanedText) as ScoreAIResponse;

    // Validate and clamp scores to 0-10 (primary) or 1-10 (secondary)
    const clamp = (n: unknown, min = 0): number => {
      const num = typeof n === 'number' ? n : parseInt(String(n), 10);
      if (isNaN(num)) return min === 1 ? 5 : 5; // Default to middle if invalid
      return Math.max(min, Math.min(10, Math.round(num)));
    };

    const rarity = clamp(parsed.rarity);
    const unique = clamp(parsed.unique);
    const magnitude = clamp(parsed.magnitude);
    const score = rarity + unique + magnitude;

    // Secondary dimensions (1-10 scale)
    const ashevilleWeird = clamp(parsed.ashevilleWeird, 1);
    const social = clamp(parsed.social, 1);

    // Validate reason
    let reason = 'Score generated by AI.';
    if (typeof parsed.reason === 'string' && parsed.reason.trim()) {
      reason = parsed.reason.trim().slice(0, 500); // Cap at 500 chars
    }

    console.log(
      `[Scoring] "${event.title.slice(0, 30)}...": ${score}/30 (R:${rarity} U:${unique} M:${magnitude} AW:${ashevilleWeird} S:${social}) - ${result.usage.totalTokens} tokens`
    );

    return { score, rarity, unique, magnitude, reason, ashevilleWeird, social };
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
    onProgress?: (
      current: number,
      total: number,
      event: EventForScoring,
      result: EventScoreResult | null
    ) => void;
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
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
    rarity: 1, // Very low - happens frequently
    unique: 2, // Low - common activity type
    magnitude: 2, // Low - typically local/community level
    reason:
      type === 'daily'
        ? 'Daily recurring event - happens every day.'
        : 'Weekly recurring event - happens every week.',
    // Secondary dimensions - default to middle values for recurring events
    ashevilleWeird: 3, // Slightly below middle - recurring events tend to be conventional
    social: 5, // Middle - varies by event type
  };
}
