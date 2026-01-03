/**
 * Combined AI-powered event tagging and summary generation using Azure OpenAI.
 *
 * Generates both tags (official + custom) and a structured 1-2 sentence summary
 * in a single API call for efficiency.
 */

import { azureChatCompletion, isAzureAIEnabled } from './provider-clients';
import { normalizeTagFromAI, tryExtractOfficialTag } from '@/lib/utils/formatTag';

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

interface TagAndSummaryAIResponse {
  official?: unknown;
  custom?: unknown;
  summary?: string;
}

// All allowed official tags - AI must ONLY use tags from this list
const ALLOWED_TAGS = [
  // Entertainment
  'Live Music',
  'Comedy',
  'Theater & Film',
  'Dance',
  'Trivia',
  'Open Mic',
  'Karaoke',
  // Food & Drink
  'Dining',
  'Beer',
  'Wine & Spirits',
  // Activities
  'Art',
  'Crafts',
  'Fitness',
  'Wellness',
  'Spiritual',
  'Meditation',
  'Outdoors',
  'Tours',
  'Gaming',
  'Sports',
  'Education',
  'Tech',
  'Book Club',
  'Museum Exhibition',
  // Audience/Social
  'Family',
  'Dating',
  'Networking',
  'Nightlife',
  'LGBTQ+',
  'Pets',
  'Community',
  'Volunteering',
  'Support Groups',
  // Seasonal
  'Holiday',
  'Markets',
] as const;

const SYSTEM_PROMPT = `You are an expert event analyzer for Asheville, NC. You will analyze events and provide two things:

1. TAGS - Assign tags in two categories:
   - OFFICIAL TAGS (1-4 tags): Select ONLY from the allowed list below
   - CUSTOM TAGS (1-5 tags): Create descriptive tags for genre, vibe, skill level, venue type, etc.

2. SUMMARY - Generate a 1-2 sentence structured summary for semantic search.

## ALLOWED OFFICIAL TAGS (use ONLY these exact tag names):

IMPORTANT: Return ONLY the tag name (e.g., "Live Music"), NOT the description after the dash.

Entertainment:
• Live Music (concerts, bands, live performances)
• Comedy (stand-up, improv, showcases)
• Theater & Film (plays, performances, movie nights)
• Dance (lessons, parties, social dance nights)
• Trivia (pub trivia, game nights)
• Open Mic (open mic nights, poetry slams, showcases)
• Karaoke (karaoke nights, sing-along events)

Food & Drink:
• Dining (special dinners, brunches, prix fixe meals)
• Beer (brewery events, tastings)
• Wine & Spirits (wine tastings, cocktail events)

Activities:
• Art (galleries, visual art events, art classes)
• Crafts (pottery, jewelry, DIY workshops)
• Fitness (yoga, exercise, climbing, general fitness)
• Sports (team sports, athletic events, competitions)
• Wellness (sound healing, holistic health, self-care)
• Spiritual (ceremonies, religious gatherings, dharma talks)
• Meditation (meditation sits, mindfulness, guided meditation)
• Outdoors (hiking, nature, parks)
• Tours (walking tours, ghost tours, historical)
• Gaming (board games, D&D, video games)
• Education (classes, workshops, lectures, learning events)
• Tech (technology meetups, coding, maker events)
• Book Club (book discussions, reading groups, literary meetups)
• Museum Exhibition (museum exhibits, gallery shows, curated displays)

Audience/Social:
• Family (kid-friendly, all-ages)
• Dating (singles events, speed dating)
• Networking (business, professional meetups)
• Nightlife (21+, bar events, late-night)
• LGBTQ+ (pride, queer-specific events)
• Pets (dog-friendly, goat yoga, cat lounges)
• Community (neighborhood events, local meetups)
• Volunteering (volunteer opportunities, community service, charity work)
• Support Groups (recovery, grief, mental health support meetings)

Seasonal:
• Holiday (seasonal celebrations, Christmas, Halloween, etc.)
• Markets (pop-ups, vendors, shopping, craft fairs)

## TAG RULES:
1. For official tags: ONLY use the tag name from the list above (e.g., "Live Music", NOT "Live Music – concerts, bands").
2. NEVER use category names as tags (not "Entertainment", "Food & Drink", etc.)
3. Use the exact spelling and capitalization for official tags.
4. Custom tags: lowercase, descriptive, specific, and MAX 3 WORDS (e.g., "jazz", "beginner friendly", "rooftop venue").
5. DEDUPLICATION: Custom tags must provide NEW information not found in the Official tags. If the official tag is "Live Music," do not use "live music" as a custom tag; use "honky-tonk" or "psych-rock" instead.
6. Custom tags should NOT contain hyphens or dashes. Use spaces instead (e.g., "all ages" not "all-ages").

## SUMMARY RULES:
- LENGTH: 1 to 2 descriptive sentences (approx 25-35 words).
- NO REPETITION: assume the user has read the title/venue.
- DYNAMIC OPENING: Never start with "Featuring," "Offering," "Showcasing," "This event is," or "Join us." Jump straight into the sensory details or the core action.
- VIVID DETAIL: Use specific adjectives from the description (e.g., instead of "instruments," use "fiddles and upright bass"; instead of "food," use "hand-tossed wood-fired pizza").
- SEARCH OPTIMIZATION: Ensure the summary contains the most important keywords for semantic search (vibe, genre, specific activities).
- GOOD EXAMPLE: "Participatory acoustic circle jams of Appalachian old-time fiddle, banjo, and guitar. Players and listeners gather in a low-lit taproom for traditional mountain melodies and community connection."
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
export async function generateTagsAndSummary(event: EventData): Promise<TagAndSummaryResult> {
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
  ]
    .filter(Boolean)
    .join('\n');

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

    const parsed = JSON.parse(cleanedText) as TagAndSummaryAIResponse;

    // Validate and extract tags
    const officialTags = Array.isArray(parsed.official) ? parsed.official : [];
    const customTags = Array.isArray(parsed.custom) ? parsed.custom : [];

    // Validate official tags - try to extract valid tags from malformed AI output
    // e.g., "Live Music – concerts, bands" → "Live Music"
    const validOfficialTags: string[] = [];
    const unrecoverableOfficialTags: string[] = [];

    for (const tag of officialTags) {
      if (typeof tag !== 'string') continue;

      // Try to extract a valid official tag (handles malformed tags like "Live Music – concerts")
      const extracted = tryExtractOfficialTag(tag, ALLOWED_TAGS);
      if (extracted) {
        // Avoid duplicates
        if (!validOfficialTags.includes(extracted)) {
          validOfficialTags.push(extracted);
        }
      } else {
        unrecoverableOfficialTags.push(tag);
      }
    }

    // Log truly invalid official tags (ones we couldn't recover)
    if (unrecoverableOfficialTags.length > 0) {
      console.warn(
        `[TagAndSummarize] Invalid official tags for "${event.title}": ${unrecoverableOfficialTags.join(', ')}`
      );
    }

    // Custom tags: validate, normalize, and filter
    // - Extract core tag if AI included description
    // - Capitalize words, replace hyphens
    // - Reject tags with more than 3 words
    // - Reject duplicates of official tags
    const validCustomTags: string[] = [];
    for (const tag of customTags) {
      if (typeof tag !== 'string' || !tag.trim()) continue;

      const normalized = normalizeTagFromAI(tag);

      // Skip if normalization failed (e.g., more than 3 words)
      if (!normalized) continue;

      // Skip if it duplicates an official tag (case-insensitive)
      const isDuplicateOfOfficial = validOfficialTags.some(
        (official) => official.toLowerCase() === normalized.toLowerCase()
      );
      if (isDuplicateOfOfficial) continue;

      // Skip duplicates within custom tags
      if (validCustomTags.some((t) => t.toLowerCase() === normalized.toLowerCase())) continue;

      validCustomTags.push(normalized);
    }

    // Extract and clean summary
    let summary: string | null = null;
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      summary = parsed.summary
        .trim()
        .replace(/^["']|["']$/g, '') // Remove quotes if present
        .replace(/\n+/g, ' '); // Replace newlines with spaces
    }

    const tags = [...validOfficialTags, ...validCustomTags];

    console.log(
      `[TagAndSummarize] Generated ${tags.length} tags, summary: ${summary?.slice(0, 50)}... (${result.usage.totalTokens} tokens)`
    );

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
export async function generateEventSummary(event: EventData): Promise<string | null> {
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
