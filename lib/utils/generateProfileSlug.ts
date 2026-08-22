/**
 * Generate a unique profile slug from email and user ID
 * Format: "{emailPrefix}-{first6CharsOfUserId}"
 * Example: "john-abc123" for john@example.com with userId starting with abc123...
 *
 * Falls back to "curator" when the email's local part has no usable characters
 * (e.g. "+++@example.com"), which would otherwise yield a leading-hyphen slug.
 */
export function generateProfileSlug(email: string, userId: string): string {
  // Extract email prefix (before @)
  const emailPrefix =
    email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') // Remove special chars
      .slice(0, 20) || 'curator';

  // Get first 6 chars of UUID
  const shortId = userId
    .slice(0, 6)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  return shortId ? `${emailPrefix}-${shortId}` : emailPrefix;
}
