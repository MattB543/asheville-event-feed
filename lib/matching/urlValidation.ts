export function getHttpsUrlValidationError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') {
      return 'Enter a complete URL starting with https://, or clear this field.';
    }

    if (!url.hostname) {
      return 'Enter a valid https:// URL, or clear this field.';
    }

    return null;
  } catch {
    return 'Enter a valid https:// URL, or clear this field.';
  }
}

export function isValidHttpsUrl(value: string): boolean {
  return getHttpsUrlValidationError(value) === null;
}
