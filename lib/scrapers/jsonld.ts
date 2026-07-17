/**
 * Shared JSON-LD extraction for HTML-scraping venue scrapers.
 *
 * Venue pages often carry multiple JSON-LD blocks (WordPress SEO plugins add
 * BreadcrumbList/Organization/WebSite blocks, sometimes wrapped in @graph),
 * so we must scan every block rather than only the first one.
 */

type JsonLdNode = {
  '@type'?: string | string[];
  '@graph'?: unknown[];
} & Record<string, unknown>;

function isEventNode(node: unknown): node is JsonLdNode {
  if (!node || typeof node !== 'object') return false;
  const type = (node as JsonLdNode)['@type'];
  // Accept Event and schema.org subtypes (MusicEvent, TheaterEvent, ...)
  if (typeof type === 'string') return type === 'Event' || type.endsWith('Event');
  if (Array.isArray(type)) {
    return type.some(
      (value) => typeof value === 'string' && (value === 'Event' || value.endsWith('Event'))
    );
  }
  return false;
}

function findEventNode(value: unknown): JsonLdNode | null {
  if (isEventNode(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const event = findEventNode(item);
      if (event) return event;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    return findEventNode((value as JsonLdNode)['@graph']);
  }
  return null;
}

/**
 * Find the first Event-typed JSON-LD object in an HTML document.
 * Scans all <script type="application/ld+json"> blocks (regardless of other
 * attributes), including top-level arrays and @graph wrappers.
 */
export function findJsonLdEvent<T = Record<string, unknown>>(html: string): T | null {
  const matches = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const match of matches) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue; // Skip invalid JSON blocks
    }

    const event = findEventNode(parsed);
    if (event) return event as T;
  }

  return null;
}
