import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submittedEvents } from '@/lib/db/schema';
import { sendUrlSubmissionNotification } from '@/lib/notifications/slack';

// Simple in-memory rate limiting (shared logic with submit endpoint)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 10; // 10 submissions per hour
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

// POST: Submit an event URL for manual review
export async function POST(request: Request) {
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

  let body: Record<string, unknown>;
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

  // Validate required URL field
  if (!body.url || typeof body.url !== 'string' || body.url.trim().length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'URL is required',
        field: 'url',
      },
      { status: 400 }
    );
  }

  // Validate URL format
  try {
    new URL(body.url as string);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid URL format',
        field: 'url',
      },
      { status: 400 }
    );
  }

  // Validate email if provided
  if (body.submitterEmail && typeof body.submitterEmail === 'string') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.submitterEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid email format',
          field: 'submitterEmail',
        },
        { status: 400 }
      );
    }
  }

  try {
    // Insert into database with placeholder values for required fields
    const result = await db
      .insert(submittedEvents)
      .values({
        title: 'URL Submission',
        startDate: new Date(), // Placeholder - will be updated during review
        url: (body.url as string).trim(),
        submitterEmail: body.submitterEmail ? String(body.submitterEmail).trim().toLowerCase() : null,
        submitterName: body.submitterName ? String(body.submitterName).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
        source: 'url',
        status: 'pending',
      })
      .returning({ id: submittedEvents.id });

    const submissionId = result[0]?.id;

    if (!submissionId) {
      throw new Error('Failed to get submission ID');
    }

    // Send Slack notification (async, don't block response)
    sendUrlSubmissionNotification({
      id: submissionId,
      url: (body.url as string).trim(),
      submitterEmail: body.submitterEmail ? String(body.submitterEmail).trim() : null,
      submitterName: body.submitterName ? String(body.submitterName).trim() : null,
    }).catch(err => {
      console.error('[SubmitURL] Failed to send Slack notification:', err);
    });

    return NextResponse.json(
      {
        success: true,
        id: submissionId,
        message: 'URL submitted for review. Thank you!',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[SubmitURL] Failed to save submission:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to submit URL. Please try again.',
      },
      { status: 500 }
    );
  }
}
