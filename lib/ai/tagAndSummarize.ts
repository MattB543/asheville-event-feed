/**
 * Combined AI-powered event tagging and summary generation using Azure OpenAI.
 *
 * Generates both tags (official + custom) and a structured 1-2 sentence summary
 * in a single API call for efficiency.
 */

import { azureChatCompletion, isAzureAIEnabled } from './provider-clients';

export interface EventData {
  title: string;
  description?: string | null;
  location?: string | null;
  organizer?: string | null;
  startDate: Date;
}

export interface TagAndSummaryResult {
  tags: string[];
  summary: string | null;
}

// All allowed official tags - AI must ONLY use tags from this list
const ALLOWED_TAGS = [
  // Entertainment
  'Live Music', 'Comedy', 'Theater & Film', 'Dance', 'Trivia',
  // Food & Drink
  'Dining', 'Beer', 'Wine & Spirits', 'Food Classes',
  // Activities
  'Art', 'Crafts', 'Fitness', 'Wellness', 'Spiritual', 'Outdoors', 'Tours', 'Gaming',
  'Sports', 'Education', 'Book Club',
  // Audience/Social
  'Family', 'Dating', 'Networking', 'Nightlife', 'LGBTQ+', 'Pets',
  'Community', 'Civic', 'Volunteering', 'Support Groups',
  // Seasonal
  'Holiday', 'Markets',
] as const;

const SYSTEM_PROMPT = `You are an expert event analyzer for Asheville, NC. You will analyze events and provide two things:

1. TAGS - Assign tags in two categories:
   - OFFICIAL TAGS (1-4 tags): Select ONLY from the allowed list below
   - CUSTOM TAGS (1-5 tags): Create descriptive tags for genre, vibe, skill level, venue type, etc.

2. SUMMARY - Generate a 1-2 sentence structured summary for semantic search.

## ALLOWED OFFICIAL TAGS (use ONLY these exact tags):

Entertainment:
- Live Music – concerts, bands, open mics
- Comedy – stand-up, improv, showcases
- Theater & Film – plays, performances, movie nights
- Dance – lessons, parties, social dance nights
- Trivia – pub trivia, game nights

Food & Drink:
- Dining – special dinners, brunches, prix fixe meals
- Beer – brewery events, tastings
- Wine & Spirits – wine tastings, cocktail events
- Food Classes – cooking, baking, cocktail-making workshops

Activities:
- Art – galleries, exhibits, visual art events
- Crafts – pottery, jewelry, DIY workshops
- Fitness – yoga, exercise, climbing, general fitness
- Sports – team sports, athletic events, competitions
- Wellness – sound healing, holistic health, self-care
- Spiritual – meditation, ceremonies, religious gatherings
- Outdoors – hiking, nature, parks
- Tours – walking tours, ghost tours, historical
- Gaming – board games, D&D, video games
- Education – classes, workshops, lectures, learning events
- Book Club – book discussions, reading groups, literary meetups

Audience/Social:
- Family – kid-friendly, all-ages
- Dating – singles events, speed dating
- Networking – business, professional meetups
- Nightlife – 21+, bar events, late-night
- LGBTQ+ – pride, queer-specific events
- Pets – dog-friendly, goat yoga, cat lounges
- Community – neighborhood events, local meetups
- Civic – government meetings, town halls, public forums, political events
- Volunteering – volunteer opportunities, community service, charity work
- Support Groups – recovery, grief, mental health support meetings

Seasonal:
- Holiday – seasonal celebrations, Christmas, Halloween, etc.
- Markets – pop-ups, vendors, shopping, craft fairs

## TAG RULES:
1. For official tags: ONLY use tags from the list above. Do NOT create new official tags.
2. NEVER use category names as tags (not "Entertainment", "Food & Drink", etc.)
3. Use the exact spelling and capitalization for official tags.
4. Custom tags should be lowercase, descriptive, and specific (e.g., "jazz", "beginner friendly").

## SUMMARY RULES:
- NEVER repeat the event title or venue name (assume the user has already read them).
- Focus on the "Hook": What is the specific vibe, a unique detail not in the title, or the exact activity?
- Format: A single, active sentence under 20 words.
- Start with a verb (e.g., "Featuring," "Blending," "Showcasing," "Exploring") or a direct descriptor.
- No city names, no dates, no prices.
- Bad: "Live music at The Orange Peel featuring Mersiv." (Redundant)
- Good: "Bass-heavy electronic sets with immersive lighting and experimental beat-driven performances."
- Bad: "Group meditation at Urban Dharma featuring silent sits." (Redundant)
- Good: "Guided silent practice focusing on traditional Buddhist techniques and community empowerment."

Return ONLY valid JSON in this format:
{"official": ["Tag1", "Tag2"], "custom": ["tag1", "tag2"], "summary": "Your summary here."}`;

/**
 * Generate both tags and summary for an event in a single Azure OpenAI call.
 * Returns empty tags array and null summary if Azure AI is not configured.
 */
export async function generateTagsAndSummary(
  event: EventData
): Promise<TagAndSummaryResult> {
  if (!isAzureAIEnabled()) {
    console.warn('[TagAndSummarize] Azure AI not configured, skipping');
    return { tags: [], summary: null };
  }

  const eventInfo = [
    `Title: ${event.title}`,
    event.description ? `Description: ${event.description.slice(0, 500)}` : null,
    event.location ? `Location: ${event.location}` : null,
    event.organizer ? `Organizer: ${event.organizer}` : null,
    `Date: ${event.startDate.toISOString()}`,
  ].filter(Boolean).join('\n');

  try {
    const result = await azureChatCompletion(
      SYSTEM_PROMPT,
      `Analyze this event:\n\n${eventInfo}`,
      { maxTokens: 20000 } // High limit for reasoning models
    );

    if (!result) {
      console.warn('[TagAndSummarize] No response from Azure AI');
      return { tags: [], summary: null };
    }

    // Clean up markdown code blocks if present
    const cleanedText = result.content
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(cleanedText);

    // Validate and extract tags
    const officialTags = Array.isArray(parsed.official) ? parsed.official : [];
    const customTags = Array.isArray(parsed.custom) ? parsed.custom : [];

    // Validate official tags against allowed list
    const validOfficialTags = officialTags.filter(
      (tag: unknown): tag is string =>
        typeof tag === 'string' && ALLOWED_TAGS.includes(tag as typeof ALLOWED_TAGS[number])
    );

    // Log invalid official tags
    const invalidOfficialTags = officialTags.filter(
      (tag: unknown) => typeof tag === 'string' && !ALLOWED_TAGS.includes(tag as typeof ALLOWED_TAGS[number])
    );
    if (invalidOfficialTags.length > 0) {
      console.warn(`[TagAndSummarize] Invalid official tags for "${event.title}": ${invalidOfficialTags.join(', ')}`);
    }

    // Custom tags are allowed as-is (just ensure they're strings)
    const validCustomTags = customTags.filter(
      (tag: unknown): tag is string => typeof tag === 'string' && (tag as string).trim().length > 0
    );

    // Extract and clean summary
    let summary: string | null = null;
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      summary = parsed.summary
        .trim()
        .replace(/^["']|["']$/g, '') // Remove quotes if present
        .replace(/\n+/g, ' '); // Replace newlines with spaces
    }

    const tags = [...validOfficialTags, ...validCustomTags];

    console.log(`[TagAndSummarize] Generated ${tags.length} tags, summary: ${summary?.slice(0, 50)}... (${result.usage.totalTokens} tokens)`);

    return { tags, summary };
  } catch (error) {
    console.error('[TagAndSummarize] Error:', error);
    return { tags: [], summary: null };
  }
}

/**
 * Generate tags only using the combined pipeline.
 */
export async function generateEventTags(event: EventData): Promise<string[]> {
  const result = await generateTagsAndSummary(event);
  return result.tags;
}

/**
 * Generate summary only using the combined pipeline.
 */
export async function generateEventSummary(
  event: EventData
): Promise<string | null> {
  const result = await generateTagsAndSummary(event);
  return result.summary;
}

/**
 * Generate tags and summaries for multiple events in batch.
 * Processes sequentially to avoid rate limits.
 */
export async function generateTagsAndSummariesBatch(
  events: EventData[],
  options?: {
    delayMs?: number;
    onProgress?: (current: number, total: number, event: EventData) => void;
  }
): Promise<TagAndSummaryResult[]> {
  const { delayMs = 500, onProgress } = options || {};
  const results: TagAndSummaryResult[] = [];

  for (let i = 0; i < events.length; i++) {
    const result = await generateTagsAndSummary(events[i]);
    results.push(result);

    onProgress?.(i + 1, events.length, events[i]);

    // Add delay between requests to avoid rate limits
    if (i < events.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
