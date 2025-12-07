import { timingSafeEqual } from 'crypto';

/**
 * Timing-safe comparison of authorization header against expected token.
 * Prevents timing attacks that could reveal the secret character-by-character.
 */
export function verifyAuthToken(authHeader: string | null, secret: string | undefined): boolean {
  if (!authHeader || !secret) {
    return false;
  }

  const expectedToken = `Bearer ${secret}`;

  // Ensure both strings are the same length for comparison
  // If lengths differ, comparison will fail but we still do the work
  // to prevent timing leakage about length
  if (authHeader.length !== expectedToken.length) {
    // Do a dummy comparison to maintain constant time
    const dummy = Buffer.from(authHeader);
    const dummyExpected = Buffer.from(authHeader);
    timingSafeEqual(dummy, dummyExpected);
    return false;
  }

  const providedBuffer = Buffer.from(authHeader);
  const expectedBuffer = Buffer.from(expectedToken);

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
