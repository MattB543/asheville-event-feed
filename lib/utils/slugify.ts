/**
 * Slug utilities for generating SEO-friendly event URLs
 *
 * URL format: /events/{clean-title}-{YYYY-MM-DD}-{6-char-uuid}
 * Example: /events/summer-music-festival-2025-12-14-a1b2c3
 */

/**
 * Cleans a title string for use in a URL slug
 * - Converts to lowercase
 * - Removes special characters
 * - Replaces spaces with hyphens
 * - Limits length to prevent overly long URLs
 */
export function cleanTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars except spaces and hyphens
    .replace(/[\s_]+/g, "-") // Replace spaces/underscores with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .slice(0, 60); // Limit length
}

/**
 * Formats a date as YYYY-MM-DD for URL slugs
 */
export function formatDateForSlug(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Generates a complete event slug from event data
 *
 * @param title - Event title
 * @param startDate - Event start date
 * @param id - Event UUID
 * @returns SEO-friendly slug like "summer-music-festival-2025-12-14-a1b2c3"
 */
export function generateEventSlug(
  title: string,
  startDate: Date,
  id: string
): string {
  const cleanedTitle = cleanTitle(title);
  const dateStr = formatDateForSlug(startDate);
  const shortId = id.slice(0, 6);

  return `${cleanedTitle}-${dateStr}-${shortId}`;
}

/**
 * Parses an event slug to extract the short ID
 *
 * @param slug - The URL slug
 * @returns Object with shortId, or null if invalid
 */
export function parseEventSlug(slug: string): { shortId: string } | null {
  // The slug format is: {title}-{YYYY-MM-DD}-{6-char-id}
  // The last 6 characters are the short ID
  // The date is 10 characters (YYYY-MM-DD) before the short ID

  if (!slug || slug.length < 18) {
    // Minimum: x-YYYY-MM-DD-xxxxxx = 18 chars
    return null;
  }

  // Extract the last 6 characters as the short ID
  const shortId = slug.slice(-6);

  // Validate it looks like a hex string (UUID prefix)
  if (!/^[a-f0-9]{6}$/i.test(shortId)) {
    return null;
  }

  return { shortId };
}

/**
 * Generates the full URL for an event page
 *
 * @param title - Event title
 * @param startDate - Event start date
 * @param id - Event UUID
 * @param baseUrl - Base URL of the site (optional)
 * @returns Full URL like "https://avlgo.com/events/summer-music-festival-2025-12-14-a1b2c3"
 */
export function generateEventUrl(
  title: string,
  startDate: Date,
  id: string,
  baseUrl?: string
): string {
  const slug = generateEventSlug(title, startDate, id);
  const base = baseUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://avlgo.com";
  return `${base}/events/${slug}`;
}
