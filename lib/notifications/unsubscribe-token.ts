/**
 * HMAC-signed unsubscribe tokens for Top 30 emails.
 *
 * Lives here rather than in the unsubscribe route so the cron routes that mint
 * tokens don't have to import a route module (which drags that route's whole
 * module graph along with it).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '@/lib/config/env';

// Token expiry: 90 days in milliseconds
const TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

const TOKEN_PURPOSE = 'top30-unsubscribe';

// Get signing secret (use CRON_SECRET as it's already required for the app)
function getSigningSecret(): string {
  const secret = env.CRON_SECRET;
  if (!secret) {
    throw new Error('CRON_SECRET is required for token signing');
  }
  return secret;
}

// Create HMAC signature for payload
function createSignature(payload: string): string {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

// Verify HMAC signature
function verifySignature(payload: string, signature: string): boolean {
  const expectedSignature = createSignature(payload);
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

// Encode a secure unsubscribe token with userId and expiry
export function encodeUnsubscribeToken(userId: string): string {
  const expiry = Date.now() + TOKEN_EXPIRY_MS;
  const payload = JSON.stringify({ userId, expiry, purpose: TOKEN_PURPOSE });
  const payloadBase64 = Buffer.from(payload).toString('base64url');
  const signature = createSignature(payload);
  return `${payloadBase64}.${signature}`;
}

// Decode and verify unsubscribe token
export function decodeUnsubscribeToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [payloadBase64, signature] = parts;
    const payload = Buffer.from(payloadBase64, 'base64url').toString('utf-8');

    // Verify signature
    if (!verifySignature(payload, signature)) {
      console.log('[Top30] Invalid token signature');
      return null;
    }

    // Parse and validate payload
    const data = JSON.parse(payload) as { userId: string; expiry: number; purpose: string };

    // Check purpose
    if (data.purpose !== TOKEN_PURPOSE) {
      console.log('[Top30] Invalid token purpose');
      return null;
    }

    // Check expiry
    if (Date.now() > data.expiry) {
      console.log('[Top30] Token expired');
      return null;
    }

    return data.userId;
  } catch {
    return null;
  }
}
