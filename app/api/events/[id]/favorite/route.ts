import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

// Simple in-memory rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 60; // 60 favorites per hour per IP
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/events/[id]/favorite
// Body: { action: 'add' | 'remove' }
// Returns: { success: true, favoriteCount: number }
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  // Get client IP for rate limiting
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';

  // Check rate limit
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Rate limit exceeded. Please try again later.',
      },
      { status: 429 }
    );
  }

  // Parse request body
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid JSON body',
      },
      { status: 400 }
    );
  }

  // Validate action
  if (!body.action || !['add', 'remove'].includes(body.action)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid action. Must be "add" or "remove".',
      },
      { status: 400 }
    );
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid event ID format.',
      },
      { status: 400 }
    );
  }

  try {
    // Update favorite count (increment or decrement, but never below 0)
    const increment = body.action === 'add' ? 1 : -1;

    const result = await db
      .update(events)
      .set({
        favoriteCount: sql`GREATEST(COALESCE(${events.favoriteCount}, 0) + ${increment}, 0)`,
      })
      .where(eq(events.id, id))
      .returning({ favoriteCount: events.favoriteCount });

    if (result.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Event not found.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      favoriteCount: result[0].favoriteCount ?? 0,
    });
  } catch (error) {
    console.error('[Favorite] Database error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update favorite count.',
      },
      { status: 500 }
    );
  }
}
