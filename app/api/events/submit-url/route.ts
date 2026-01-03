import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submittedEvents } from '@/lib/db/schema';
import { sendUrlSubmissionNotification } from '@/lib/notifications/slack';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord, isString } from '@/lib/utils/validation';

// Simple in-memory rate limiting (shared logic with submit endpoint)
const RATE_LIMIT_MAX = 10; // 10 submissions per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms

// POST: Submit an event URL for manual review
export async function POST(request: Request) {
  // Get client IP for rate limiting
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';

  // Check rate limit
  const rateLimitKey = `submit-url:${ip}`;
  if (isRateLimited(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Rate limit exceeded. Please try again later.',
      },
      { status: 429 }
    );
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid JSON body',
      },
      { status: 400 }
    );
  }

  if (!isRecord(parsed)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid request body',
      },
      { status: 400 }
    );
  }

  const url = isString(parsed.url) ? parsed.url.trim() : '';
  const submitterEmail = isString(parsed.submitterEmail)
    ? parsed.submitterEmail.trim().toLowerCase()
    : null;
  const submitterName = isString(parsed.submitterName) ? parsed.submitterName.trim() : null;
  const notes = isString(parsed.notes) ? parsed.notes.trim() : null;

  // Validate required URL field
  if (!url) {
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
    new URL(url);
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
  if (submitterEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(submitterEmail)) {
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
        url,
        submitterEmail,
        submitterName,
        notes,
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
      url,
      submitterEmail: submitterEmail ? submitterEmail.trim() : null,
      submitterName,
    }).catch((err) => {
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
