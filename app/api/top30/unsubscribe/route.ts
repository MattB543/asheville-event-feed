import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { newsletterSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/config/env';
import { createHmac, timingSafeEqual } from 'crypto';

// Token expiry: 90 days in milliseconds
const TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

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
  const payload = JSON.stringify({ userId, expiry, purpose: 'top30-unsubscribe' });
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
    if (data.purpose !== 'top30-unsubscribe') {
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

// GET /api/top30/unsubscribe?token=xxx - One-click unsubscribe from email
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');

    if (!token) {
      return NextResponse.redirect(
        new URL('/profile?error=missing_token', env.NEXT_PUBLIC_APP_URL)
      );
    }

    const userId = decodeUnsubscribeToken(token);

    if (!userId) {
      return NextResponse.redirect(
        new URL('/profile?error=invalid_token', env.NEXT_PUBLIC_APP_URL)
      );
    }

    // Update the subscription to 'none'
    await db
      .update(newsletterSettings)
      .set({
        top30Subscription: 'none',
        updatedAt: new Date(),
      })
      .where(eq(newsletterSettings.userId, userId));

    console.log(`[Top30] User ${userId} unsubscribed via email link`);

    // Redirect to profile with success message
    return NextResponse.redirect(
      new URL('/profile?top30_unsubscribed=true', env.NEXT_PUBLIC_APP_URL)
    );
  } catch (error) {
    console.error('Error processing top 30 unsubscribe:', error);
    return NextResponse.redirect(
      new URL('/profile?error=unsubscribe_failed', env.NEXT_PUBLIC_APP_URL)
    );
  }
}
