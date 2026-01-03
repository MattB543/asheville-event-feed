/**
 * HTML to Markdown Converter
 *
 * Converts HTML content to clean markdown suitable for AI processing.
 * Strips unnecessary elements and preserves content structure.
 */

/**
 * Remove HTML tags and normalize whitespace
 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert HTML to clean markdown for AI consumption.
 *
 * @param html - Raw HTML content
 * @param maxLength - Maximum length of output (default: 10000 chars)
 * @returns Clean markdown string
 */
export function htmlToMarkdown(html: string, maxLength: number = 10000): string {
  if (!html || html.trim().length === 0) {
    return '';
  }

  // Remove script and style tags first (including contents)
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

  // Remove navigation, header, footer, aside elements
  cleaned = cleaned
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '');

  // Remove common ad/tracking elements by class/id patterns
  // Note: Can't use 's' flag for dotAll, so using [\s\S] instead
  cleaned = cleaned
    .replace(
      /<[^>]*class="[^"]*(?:ad|advertisement|banner|promo|cookie|tracking|analytics|popup|modal)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi,
      ''
    )
    .replace(
      /<[^>]*id="[^"]*(?:ad|advertisement|banner|promo|cookie|tracking|analytics|popup|modal)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi,
      ''
    );

  // Convert headers to markdown
  cleaned = cleaned
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');

  // Convert lists
  cleaned = cleaned
    .replace(/<ul[^>]*>/gi, '\n')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '\n')
    .replace(/<\/ol>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');

  // Convert links to markdown format (keep URL visible)
  cleaned = cleaned.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Convert emphasis
  cleaned = cleaned
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Convert paragraphs and divs to line breaks
  cleaned = cleaned
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  cleaned = stripTags(cleaned);

  // Clean up whitespace
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ') // Collapse horizontal whitespace
    .replace(/\n /g, '\n') // Remove leading spaces on lines
    .replace(/ \n/g, '\n') // Remove trailing spaces on lines
    .trim();

  // Truncate if too long
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
    // Try to end at a sentence boundary
    const lastPeriod = cleaned.lastIndexOf('.');
    const lastNewline = cleaned.lastIndexOf('\n');
    const cutPoint = Math.max(lastPeriod, lastNewline);
    if (cutPoint > maxLength * 0.8) {
      cleaned = cleaned.slice(0, cutPoint + 1);
    }
    cleaned += '\n\n[Content truncated...]';
  }

  return cleaned;
}

/**
 * Extract specific content from HTML by looking for common event detail patterns.
 * Returns an object with extracted sections.
 */
export function extractEventDetails(html: string): {
  title?: string;
  description?: string;
  price?: string;
  date?: string;
  time?: string;
  venue?: string;
} {
  const result: {
    title?: string;
    description?: string;
    price?: string;
    date?: string;
    time?: string;
    venue?: string;
  } = {};

  // Try to extract title from common patterns
  const titleMatch =
    html.match(/<h1[^>]*>(.*?)<\/h1>/i) ||
    html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
    html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) {
    result.title = stripTags(titleMatch[1]);
  }

  // Try to extract description from og:description or meta description
  const descMatch =
    html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
    html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  if (descMatch) {
    result.description = stripTags(descMatch[1]);
  }

  // Try to find price patterns in the HTML
  const pricePatterns = [
    /<[^>]*class="[^"]*price[^"]*"[^>]*>([^<]+)/i,
    /\$(\d+(?:\.\d{2})?)/,
    /price[:\s]*\$?(\d+(?:\.\d{2})?)/i,
  ];
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.price = match[1] || match[0];
      break;
    }
  }

  // Try to find time patterns
  const timePatterns = [/<[^>]*class="[^"]*time[^"]*"[^>]*>([^<]+)/i, /<time[^>]*>([^<]+)/i];
  for (const pattern of timePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.time = stripTags(match[1]);
      break;
    }
  }

  // Try to find venue patterns
  const venuePatterns = [
    /<[^>]*class="[^"]*venue[^"]*"[^>]*>([^<]+)/i,
    /<[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)/i,
  ];
  for (const pattern of venuePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.venue = stripTags(match[1]);
      break;
    }
  }

  return result;
}

/**
 * Fetch a URL and convert to markdown.
 * Returns null if fetch fails.
 */
export async function fetchAndConvertToMarkdown(
  url: string,
  maxLength: number = 10000
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      console.warn(`[htmlToMarkdown] Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    return htmlToMarkdown(html, maxLength);
  } catch (error) {
    console.warn(`[htmlToMarkdown] Error fetching ${url}:`, error);
    return null;
  }
}
