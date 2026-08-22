import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { newsletterSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { type Top30SubscriptionType } from '@/lib/newsletter/types';
import { isRecord } from '@/lib/utils/validation';

const ALLOWED_SUBSCRIPTIONS: Top30SubscriptionType[] = ['none', 'live', 'weekly'];

// GET /api/top30/subscribe - Get current user's top 30 subscription
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await db
      .select({
        top30Subscription: newsletterSettings.top30Subscription,
      })
      .from(newsletterSettings)
      .where(eq(newsletterSettings.userId, user.id))
      .limit(1);

    const subscription = (result[0]?.top30Subscription as Top30SubscriptionType) || 'none';

    return NextResponse.json({ subscription });
  } catch (error) {
    console.error('Error fetching top 30 subscription:', error);
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 });
  }
}

// POST /api/top30/subscribe - Update top 30 subscription
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const subscription = body.subscription as Top30SubscriptionType | undefined;

    if (!subscription || !ALLOWED_SUBSCRIPTIONS.includes(subscription)) {
      return NextResponse.json({ error: 'Invalid subscription value' }, { status: 400 });
    }

    // Upsert the subscription setting
    await db
      .insert(newsletterSettings)
      .values({
        userId: user.id,
        top30Subscription: subscription,
        top30LastEventIds: [],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: newsletterSettings.userId,
        set: {
          top30Subscription: subscription,
          updatedAt: new Date(),
        },
      });

    console.log(`[Top30] Updated subscription for ${user.email}: ${subscription}`);

    return NextResponse.json({ success: true, subscription });
  } catch (error) {
    console.error('Error saving top 30 subscription:', error);
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
}
