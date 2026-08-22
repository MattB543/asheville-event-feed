/**
 * Combined AI-powered event tagging and summary generation using Azure OpenAI.
 *
 * Generates both tags (official + custom) and a structured 1-2 sentence summary
 * in a single API call for efficiency.
 */

import { azureChatCompletion, isAzureAIEnabled, parseJsonFromModel } from './provider-clients';
import { normalizeTagFromAI, tryExtractOfficialTag } from '@/lib/utils/formatTag';
import { ALL_KNOWN_TAGS, TAG_CATEGORIES, TAG_GUIDANCE } from '@/lib/config/tagCategories';

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

/**
 * Why a tag/summary generation attempt produced nothing usable.
 * - `transient`: worth retrying soon (rate limit, timeout, upstream 5xx, no response)
 * - `permanent`: retrying immediately won't help (not configured, unparsable or
 *   empty model output, content filtered)
 */
export type TagAndSummaryFailureReason = 'transient' | 'permanent';

/**
 * Result of an attempt. `tags`/`summary` are always present (empty on failure)
 * so existing callers that only read the content keep working; the cron uses
 * `ok`/`reason` to decide between recording success and scheduling a retry.
 */
export type TagAndSummaryOutcome =
  | ({ ok: true } & TagAndSummaryResult)
  | ({
      ok: false;
      reason: TagAndSummaryFailureReason;
      error: string;
    } & TagAndSummaryResult);

const EMPTY_RESULT: TagAndSummaryResult = { tags: [], summary: null };

function failure(
  reason: TagAndSummaryFailureReason,
  error: string
): TagAndSummaryOutcome & { ok: false } {
  return { ok: false, reason, error, ...EMPTY_RESULT };
}

/** Classify an Azure/network error as worth retrying soon or not. */
function classifyError(error: unknown): TagAndSummaryFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  return /429|408|409|5\d\d|timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|rate limit/i.test(
    message
  )
    ? 'transient'
    : 'permanent';
}

interface TagAndSummaryAIResponse {
  official?: unknown;
  custom?: unknown;
  summary?: string;
}

// All allowed official tags - AI must ONLY use tags from this list.
// Single-sourced from the UI's tag categories so the two can't drift apart.
const ALLOWED_TAGS: readonly string[] = ALL_KNOWN_TAGS;

/**
 * Render the allowed-tag section of the system prompt from TAG_CATEGORIES,
 * keeping the per-tag guidance that teaches the model what each label means.
 */
function buildAllowedTagsSection(): string {
  return TAG_CATEGORIES.map((category) => {
    const lines = category.tags.map((tag) => {
      const guidance = TAG_GUIDANCE[tag];
      return guidance ? `• ${tag} (${guidance})` : `• ${tag}`;
    });
    return `${category.name}:\n${lines.join('\n')}`;
  }).join('\n\n');
}

const SYSTEM_PROMPT = `You are an expert event analyzer for Asheville, NC. You will analyze events and provide two things:

1. TAGS - Assign tags in two categories:
   - OFFICIAL TAGS (1-4 tags): Select ONLY from the allowed list below
   - CUSTOM TAGS (1-5 tags): Create descriptive tags for genre, vibe, skill level, venue type, etc.

2. SUMMARY - Generate a 1-2 sentence structured summary for semantic search.

## ALLOWED OFFICIAL TAGS (use ONLY these exact tag names):

IMPORTANT: Return ONLY the tag name (e.g., "Live Music"), NOT the description after the dash.

${buildAllowedTagsSection()}

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
export async function generateTagsAndSummary(event: EventData): Promise<TagAndSummaryOutcome> {
  if (!isAzureAIEnabled()) {
    console.warn('[AI:Tags] Azure AI not configured, skipping');
    return failure('permanent', 'Azure AI not configured');
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
      { maxTokens: 20000, jsonMode: true } // High limit for reasoning models
    );

    if (!result) {
      console.warn(`[AI:Tags] No response from Azure AI for "${event.title.slice(0, 40)}..."`);
      return failure('transient', 'No response from Azure AI');
    }

    const parsed = parseJsonFromModel<TagAndSummaryAIResponse>(result.content);
    if (!parsed) {
      console.error(
        `[AI:Tags] JSON parse failed for "${event.title.slice(0, 40)}..." - received: ${result.content.slice(0, 200)}`
      );
      // A truncated response is a token-budget problem, not bad content:
      // worth one more attempt rather than being treated as poison.
      const truncated = result.finishReason === 'length';
      return failure(
        truncated ? 'transient' : 'permanent',
        truncated ? 'Response truncated (finish_reason=length)' : 'JSON parse failed'
      );
    }

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
        `[AI:Tags] Invalid official tags for "${event.title}": ${unrecoverableOfficialTags.join(', ')}`
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

    if (tags.length === 0) {
      console.warn(
        `[AI:Tags] All tags filtered out for "${event.title.slice(0, 40)}..." - official: ${officialTags.length} raw -> ${validOfficialTags.length} valid, custom: ${customTags.length} raw -> ${validCustomTags.length} valid`
      );
    }

    // The model answered but produced nothing usable - a content problem, so
    // don't hammer it again on the next run.
    if (tags.length === 0 && !summary) {
      return { ...failure('permanent', 'Model returned no usable tags or summary') };
    }

    return { ok: true, tags, summary };
  } catch (error) {
    const reason = classifyError(error);
    console.error(
      `[AI:Tags] ${reason} error processing "${event.title.slice(0, 40)}...":`,
      error instanceof Error ? error.message : error
    );
    return failure(reason, error instanceof Error ? error.message : String(error));
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
