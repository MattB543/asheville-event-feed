import { createHash, timingSafeEqual } from 'crypto';

/**
 * Timing-safe comparison of authorization header against expected token.
 * Both sides are SHA-256 hashed first so the buffers are always the same
 * length - this removes the length-comparison branch (which leaked whether
 * the supplied token was the right length) while keeping the comparison
 * constant time.
 */
export function verifyAuthToken(authHeader: string | null, secret: string | undefined): boolean {
  if (!authHeader || !secret) {
    return false;
  }

  const expectedToken = `Bearer ${secret}`;

  const providedDigest = createHash('sha256').update(authHeader).digest();
  const expectedDigest = createHash('sha256').update(expectedToken).digest();

  return timingSafeEqual(providedDigest, expectedDigest);
}
