interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();
const MAX_RATE_LIMIT_ENTRIES = 1000;

/**
 * Simple in-memory rate limiter.
 * Returns true if the key is rate limited, false otherwise.
 */
export function isRateLimited(
  key: string,
  limit: number = 20,
  windowMs: number = 60 * 60 * 1000
): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return false;
  }

  if (record.count >= limit) {
    return true;
  }

  record.count++;

  if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
    for (const [entryKey, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) {
        rateLimitMap.delete(entryKey);
      }
    }
  }

  return false;
}
