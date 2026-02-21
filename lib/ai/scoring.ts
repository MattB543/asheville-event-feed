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

const SCORING_SYSTEM_PROMPT = `You are an expert Event Curator for Asheville, NC. Your goal is to rank events so that the "Score" acts as a discovery heat-map for the GENERAL Asheville event-goer — someone looking for fun, memorable, broadly appealing things to do.

## DIMENSION 1 - Rarity & Urgency (0-10)
How "missable" is this?
- 1-3: Daily/Weekly (Trivia, regular yoga, open mics).
- 4-5: Monthly or Seasonal (Monthly markets, standard holiday displays like Winter Lights).
- 5-6: Annual recurring events that happen in Asheville every year (Annual tournaments, annual festivals, yearly galas, annual conferences). These are predictable — you'll get another chance next year.
- 6-7: Special Limited Runs (A 2-week theater run, a 3-stop workshop series).
- 8-9: True One-Offs (A touring band's only stop, a specific guest speaker, a unique one-time gala).
- 10: Once-in-a-decade (Legendary artist, Centennial celebration, Solar Eclipse).
IMPORTANT: Annual events that recur in Asheville every year should NOT exceed 6 for rarity. One-off touring acts that may never return = 8-9. Once-in-a-decade = 10.

## DIMENSION 2 - Cool & Unique Factor (0-10)
How much "Main Character Energy" does this event have for a GENERAL audience?
- 1-3: Standard/Utility (AA meetings, generic classes, basic networking, professional development, clinical trainings, corporate conferences, religious services).
- 4-5: Niche Interest (Industry conferences, professional certifications, B2B forums, medical/clinical workshops, continuing education — these serve narrow professional audiences, not the general event-goer).
- 4-6: Solid Entertainment (Local bands, standard stand-up, local brewery jams).
- 7-8: High Concept (Themed masquerades, specialized workshops like "Tarot with Cats," niche festivals).
- 9-10: Truly Novel (GWAR, extreme circus, "Crankie Fest," events with high production "weirdness").
IMPORTANT: Niche professional events (clinical trainings, corporate keynotes, industry summits, certification workshops, business leader forums) should cap at 5 for Cool. The general Asheville event-goer would not find them broadly appealing, regardless of how impressive the speaker or topic is within that professional niche.

## DIMENSION 3 - Magnitude & Caliber (0-10)
What is the ACTUAL audience draw and prestige of this specific event?
- 1-3: Hyper-local/Peer-led (Small meetups, student groups, neighborhood walks).
- 4-5: Professional Local (Established local acts, venue-staple performers, paid workshops).
- 6-7: Regional Draw (Well-known SE touring acts, mid-sized venue headliners like at Grey Eagle).
- 8-9: National Headliner (Nationally known touring acts, major concert headliners, sold-out arena shows).
- 10: Global Icon (A-list celebrities, stadium-level acts, massive 10k+ person festivals).
CRITICAL — VENUE ≠ MAGNITUDE: A big venue does NOT automatically mean high magnitude. Score based on the EVENT'S actual draw, not the venue's capacity. Examples:
- Harlem Globetrotters at Harrah's = 9 (national brand, will pack the arena).
- Regional youth cheerleading competition at Harrah's = 5-6 (niche audience, won't fill the venue, limited broad appeal).
- A community planning summit at Harrah's = 4-5 (narrow professional audience regardless of venue).
- An obscure exhibition game at Harrah's = 4-5 (unknown draw, niche interest).
The question is: "How many people will this actually draw, and how prestigious is the act/event itself?" — NOT "How big is the building?"

## DIMENSION 4 - Asheville Weird (1-10)
How much does this event embody the unique "Asheville weird" spirit? "Weird" means: countercultural, boundary-pushing, artsy, queer, performative, ritualistic, subversive, bohemian, gloriously strange.
- 1-2: Completely conventional (Corporate events, chain restaurant promos, standard sports, professional conferences).
- 3-4: Slightly alternative (Local craft brewery, yoga classes, farmers markets, standard community events).
- 5-6: Notably Asheville (Drum circles, crystal shops, farm-to-table events, local art walks).
- 7-8: Distinctly weird (Fire spinning, ecstatic dance, sound baths, drag shows, ritual theater, immersive fantasy, group cuddling, costume hash runs like Red Dress Run).
- 9-10: Peak Asheville weird (Naked bike rides, underground puppet theater, experimental performance art, uniquely bizarre local traditions, "Crankie Fest").
IMPORTANT — "WEIRD" IS NOT "CUTE" OR "NICHE HOBBY": Pet adoption events, cat story time, pie bake-offs, brewery tours, and cooking classes are NOT weird — they are wholesome or hobbyist. Score them 3-4 max. Weird requires an element of the countercultural, transgressive, or genuinely strange. Ask: "Would a tourist double-take and say 'only in Asheville'?"

## DIMENSION 5 - Social/Meet New People (1-10)
How conducive is this event to ACTUAL person-to-person interaction and making new connections? Score based on the MECHANICS of the event, not marketing language.
- 1-2: Solo/Passive consumption (Movies, seated concerts, lectures — you sit and watch, no interaction expected).
- 3-4: Limited interaction (Dining, spectator shows with intermission chat, guided tours, virtual events, medical/condition-specific support groups).
- 5-6: Moderate socializing (Classes, workshops, casual sports leagues, brewery hangouts).
- 7-8: High social potential (Social dance events, collaborative workshops, recurring community groups with facilitated interaction, game nights, volunteer build days, potluck gatherings, multi-week cohort programs).
- 9-10: Explicitly social (Speed dating, singles mixers, newcomer meetups, social clubs designed for connection where meeting people IS the point).
IMPORTANT — SCORE THE MECHANICS, NOT THE MARKETING: Words like "community," "connect," and "gathering" in a description do NOT automatically mean high social. A seated show that says "no audience participation required" is a 2, not a 9. A medical support group for a specific condition is 3-4 (the audience is narrow and the purpose is support, not broad social mixing). Virtual networking is 3-4. A 10-week community chorus with weekly potlucks is 8+. Score based on what people ACTUALLY DO at the event.

## CALIBRATION LOGIC:
- If it's a TOURING ACT at a major venue (Orange Peel, Grey Eagle, Rabbit Rabbit), it should automatically start at 18+ total.
- If it's a massive ASHEVILLE TRADITION (Gingerbread competition, Crankie Fest), it should score 20+.
- RECURRING EVENT RULE: A weekly event can still score high on Magnitude/Uniqueness. Don't let a "1" in Rarity crush a "9" in Magnitude.
- THE TRIVIA/KARAOKE CAP: Standard pub trivia, karaoke, and open mics should NEVER score higher than a 4 in "Unique" and "Magnitude" unless there is a significant, documented "Main Character" twist.
- THE "ASHEVILLE WEIRD" BONUS: Reward events that are uniquely "Asheville" (e.g., busking festivals, mountain-specific crafts, or "Crankie Fest") with +2 to the "Unique" score.
- NICHE PROFESSIONAL CAP: Professional development, clinical trainings, corporate conferences, B2B keynotes, certification workshops, and religious ceremonies aimed at narrow professional or institutional audiences should NOT exceed 18 total. These events serve important purposes but are not broadly exciting to the general Asheville event-goer.
- MAGNITUDE CLARITY — VENUE IS A HINT, NOT A SCORE:
    - The venue suggests the event's POTENTIAL scale, but you must evaluate whether the specific event actually leverages that scale.
    - A niche conference or regional youth competition at a large arena gets magnitude 4-6, not 8-9.
    - A nationally known headliner at the same arena gets 8-9 because the ACT draws the crowd, not the building.
    - Default venue ceilings (only for events that actually fill/leverage the venue):
      - Small bars, cafes, or virtual-only: 1-3.
      - Established local venues (Ginger's Revenge, One World West, Jack of the Wood): 4-6.
      - Major regional venues (The Grey Eagle, Orange Peel, Wortham Center): 7-8.
      - Stadium/Arena with a nationally known headliner (Harrah's Cherokee Center): 9-10.
- ANNUAL EVENT RARITY CAP: Events that happen annually in Asheville (yearly tournaments, annual festivals, annual conferences) should get rarity 5-6 max, NOT 7-8. Reserve 8-9 for true one-off touring stops and unique one-time events.
- TOURNAMENT/COMPETITION ROUNDS: Championship finals and title games score HIGHER than semi-finals, quarter-finals, or early rounds of the same tournament. The final is the main event — give it +1-2 on magnitude and rarity vs earlier rounds.
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
