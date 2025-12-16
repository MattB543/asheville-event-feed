/**
 * Generate a unique profile slug from email and user ID
 * Format: "{emailPrefix}-{first6CharsOfUserId}"
 * Example: "john-abc123" for john@example.com with userId starting with abc123...
 */
export function generateProfileSlug(email: string, userId: string): string {
  // Extract email prefix (before @)
  const emailPrefix = email.split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove special chars
    .slice(0, 20); // Limit length

  // Get first 6 chars of UUID
  const shortId = userId.slice(0, 6).toLowerCase();

  return `${emailPrefix}-${shortId}`;
}
