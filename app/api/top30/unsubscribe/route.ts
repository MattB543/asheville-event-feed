import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { newsletterSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/config/env';
import { decodeUnsubscribeToken } from '@/lib/notifications/unsubscribe-token';

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
