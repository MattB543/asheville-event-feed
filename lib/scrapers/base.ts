import { fetchWithRetry, type RetryOptions } from '../utils/retry';
import { decodeHtmlEntities } from '../utils/parsers';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': DEFAULT_USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Fetch with retry + shared headers and optional scraper-specific error logging.
 */
export async function fetchEventData(
  url: string,
  options: RequestInit = {},
  retryOptions?: RetryOptions,
  context?: string
): Promise<Response> {
  const headers = {
    ...BROWSER_HEADERS,
    ...(options.headers || {}),
  };

  try {
    return await fetchWithRetry(url, { ...options, headers }, retryOptions);
  } catch (error) {
    const label = context ? `[${context}]` : '[Scraper]';
    console.error(`${label} Fetch failed for ${url}:`, error);
    throw error;
  }
}

/**
 * Extract description from meta tag (name="description", falling back to
 * og:description). Returns undefined for short/boilerplate values.
 */
export function extractMetaDescription(html: string): string | undefined {
  // Try name="description" first (both attribute orders)
  const metaDesc =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);

  if (metaDesc && metaDesc[1]) {
    const decoded = decodeHtmlEntities(metaDesc[1]);
    // Only return if it's a meaningful description (not just venue info)
    if (decoded.length > 50) {
      return decoded;
    }
  }

  // Fallback to og:description
  const ogDesc =
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);

  if (ogDesc && ogDesc[1]) {
    const decoded = decodeHtmlEntities(ogDesc[1]);
    if (decoded.length > 50) {
      return decoded;
    }
  }

  return undefined;
}

/**
 * Save debug data to DEBUG_DIR when set (local dev only).
 */
export async function debugSave(
  filename: string,
  data: unknown,
  options?: { label?: string; dir?: string }
): Promise<void> {
  const debugDir = options?.dir || process.env.DEBUG_DIR;
  if (!debugDir) return;

  try {
    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const filepath = path.join(debugDir, filename);
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filepath, content);
    const label = options?.label || 'DEBUG';
    console.log(`[${label}] Saved: ${filepath}`);
  } catch (error) {
    const label = options?.label || 'DEBUG';
    console.warn(`[${label}] Failed to save ${filename}:`, error);
  }
}
