/**
 * Decode HTML entities in a string
 *
 * Handles common named and numeric entities found in scraped content.
 * Also strips HTML tags and normalizes whitespace.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    // Strip any HTML tags first
    .replace(/<[^>]*>/g, '')
    // Named entities - common
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    // Numeric entities for common characters
    .replace(/&#8211;/g, '–')  // en-dash
    .replace(/&#8212;/g, '—')  // em-dash
    .replace(/&#8217;/g, "'")  // right single quote
    .replace(/&#8216;/g, "'")  // left single quote
    .replace(/&#8220;/g, '"')  // left double quote
    .replace(/&#8221;/g, '"')  // right double quote
    .replace(/&#8230;/g, '…')  // ellipsis
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&#124;/g, '|')   // pipe/vertical bar
    // Named entities for special punctuation
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    // Clean up multiple spaces and trim
    .replace(/\s+/g, ' ')
    .trim();
}
