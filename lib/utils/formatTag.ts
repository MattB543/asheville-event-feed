// Special words that should always be uppercase
const UPPERCASE_WORDS = ['AI', 'DJ', 'LGBTQ+', 'D&D', 'DIY', 'VR', 'AR', 'NYC', 'AVL'];

/**
 * Format a tag for display:
 * - Replace hyphens with spaces
 * - Capitalize each word
 * - Handle special cases like "Ai" -> "AI"
 */
export function formatTagForDisplay(tag: string): string {
  return tag
    .replace(/-/g, ' ') // Replace hyphens with spaces
    .split(' ')
    .filter(w => w.length > 0) // Remove empty strings
    .map((word) => {
      // Handle special cases
      const upper = word.toUpperCase();
      if (UPPERCASE_WORDS.includes(upper)) {
        return upper;
      }
      // Capitalize first letter of each word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Extract the core tag from AI output that may include descriptions.
 * e.g., "Live Music – concerts, bands, performances" → "Live Music"
 * e.g., "Nightlife – 21+, bar events" → "Nightlife"
 */
function extractCoreTag(tag: string): string {
  // Split on common description separators: " – " (en dash), " - " (hyphen), " — " (em dash)
  const separators = [' – ', ' — ', ' - '];
  for (const sep of separators) {
    if (tag.includes(sep)) {
      return tag.split(sep)[0].trim();
    }
  }
  return tag.trim();
}

/**
 * Count words in a tag (for validation).
 */
function countWords(tag: string): number {
  return tag.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Normalize a tag from AI output:
 * - Extract core tag if AI included description (split on " – " or " - ")
 * - Replace hyphens with spaces
 * - Capitalize each word
 * - Handle special cases like "Ai" -> "AI"
 * - Returns null if tag has more than 3 words (invalid)
 *
 * Used when parsing custom tags from AI to ensure consistent storage.
 */
export function normalizeTagFromAI(tag: string): string | null {
  // First, extract core tag if AI included a description
  let cleaned = extractCoreTag(tag);

  // Format it properly (hyphens to spaces, capitalize)
  cleaned = formatTagForDisplay(cleaned);

  // Reject tags with more than 3 words
  if (countWords(cleaned) > 3) {
    return null;
  }

  return cleaned;
}

/**
 * Try to match a malformed AI tag to an official tag.
 * e.g., "Live Music – concerts, bands" → "Live Music" (if in allowed list)
 */
export function tryExtractOfficialTag(tag: string, allowedTags: readonly string[]): string | null {
  // First try exact match
  if (allowedTags.includes(tag as typeof allowedTags[number])) {
    return tag;
  }

  // Extract core tag and try to match
  const core = extractCoreTag(tag);
  if (allowedTags.includes(core as typeof allowedTags[number])) {
    return core;
  }

  // Try with proper formatting
  const formatted = formatTagForDisplay(core);
  if (allowedTags.includes(formatted as typeof allowedTags[number])) {
    return formatted;
  }

  return null;
}
