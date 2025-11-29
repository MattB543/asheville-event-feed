/**
 * Remove markdown formatting from text while preserving the content.
 */
export function cleanMarkdown(text: string | null | undefined): string {
  if (!text) return '';

  let result = text;

  // Remove escaped characters (e.g., \*, \[, \()
  result = result.replace(/\\([*[\]()#>`~|])/g, '$1');

  // Remove bold/italic markers
  result = result.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');

  // Remove links but keep text: [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove headers (# ## ### etc.)
  result = result.replace(/^#{1,6}\s*/gm, '');

  // Remove inline code backticks
  result = result.replace(/`{1,3}([^`]+)`{1,3}/g, '$1');

  // Remove blockquotes
  result = result.replace(/^>\s*/gm, '');

  // Remove strikethrough
  result = result.replace(/~~([^~]+)~~/g, '$1');

  // Remove horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, '');

  return result;
}
