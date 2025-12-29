/**
 * Format a tag for display:
 * - Replace hyphens with spaces
 * - Capitalize each word
 * - Handle special cases like "Ai" -> "AI"
 */
export function formatTagForDisplay(tag: string): string {
  return tag
    .replace(/-/g, " ") // Replace hyphens with spaces
    .split(" ")
    .map((word) => {
      // Handle special cases
      const upper = word.toUpperCase();
      if (upper === "AI" || upper === "DJ" || upper === "LGBTQ+") {
        return upper;
      }
      // Capitalize first letter of each word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Normalize a tag from AI output:
 * - Replace hyphens with spaces
 * - Capitalize each word
 * - Handle special cases like "Ai" -> "AI"
 *
 * Used when parsing custom tags from AI to ensure consistent storage.
 */
export function normalizeTagFromAI(tag: string): string {
  return formatTagForDisplay(tag.trim());
}
