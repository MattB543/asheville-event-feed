import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submittedEvents } from '@/lib/db/schema';
import { sendSubmissionNotification } from '@/lib/notifications/slack';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord, isString } from '@/lib/utils/validation';

// Simple in-memory rate limiting
const RATE_LIMIT_MAX = 10; // 10 submissions per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms

// GET: Return API documentation
export function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/events/submit',
    description:
      'Submit an event suggestion for review. Events are manually reviewed before appearing on the site.',
    required: ['title', 'startDate'],
    optional: [
      'description',
      'endDate',
      'location',
      'organizer',
      'price',
      'url',
      'imageUrl',
      'submitterEmail',
      'submitterName',
      'notes',
    ],
    formats: {
      startDate: 'ISO 8601 format (e.g., "2024-12-14T20:00:00-05:00" or "2024-12-14T20:00:00Z")',
      endDate: 'ISO 8601 format (optional)',
      price: 'String (e.g., "Free", "$15", "$10-$25")',
    },
    example: {
      title: 'Live Music Night at The Orange Peel',
      startDate: '2024-12-14T20:00:00-05:00',
      location: 'The Orange Peel, 101 Biltmore Ave, Asheville NC',
      organizer: 'The Orange Peel',
      price: '$15',
      url: 'https://theorangepeel.net/event/example',
      description: 'Join us for an amazing night of live music!',
      submitterEmail: 'your@email.com',
    },
    rateLimit: `${RATE_LIMIT_MAX} submissions per IP per hour`,
  });
}

// POST: Submit a new event
export async function POST(request: Request) {
  // Get client IP for rate limiting
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';

  // Check rate limit
  const rateLimitKey = `submit:${ip}`;
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

  const title = isString(parsed.title) ? parsed.title.trim() : '';
  const startDateRaw = isString(parsed.startDate) ? parsed.startDate : '';
  const description = isString(parsed.description) ? parsed.description.trim() : null;
  const location = isString(parsed.location) ? parsed.location.trim() : null;
  const organizer = isString(parsed.organizer) ? parsed.organizer.trim() : null;
  const price = isString(parsed.price) ? parsed.price.trim() : null;
  const url = isString(parsed.url) ? parsed.url.trim() : null;
  const imageUrl = isString(parsed.imageUrl) ? parsed.imageUrl.trim() : null;
  const submitterEmail = isString(parsed.submitterEmail)
    ? parsed.submitterEmail.trim().toLowerCase()
    : null;
  const submitterName = isString(parsed.submitterName) ? parsed.submitterName.trim() : null;
  const notes = isString(parsed.notes) ? parsed.notes.trim() : null;
  const endDateRaw = isString(parsed.endDate) ? parsed.endDate : null;

  // Validate required fields
  if (!title) {
    return NextResponse.json(
      {
        success: false,
        error: 'Title is required',
        field: 'title',
      },
      { status: 400 }
    );
  }

  if (!startDateRaw) {
    return NextResponse.json(
      {
        success: false,
        error: 'Start date is required',
        field: 'startDate',
      },
      { status: 400 }
    );
  }

  // Parse and validate start date
  const startDate = new Date(startDateRaw);
  if (isNaN(startDate.getTime())) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid start date format. Use ISO 8601 format (e.g., "2024-12-14T20:00:00-05:00")',
        field: 'startDate',
      },
      { status: 400 }
    );
  }

  // Parse optional end date
  let endDate: Date | null = null;
  if (endDateRaw) {
    endDate = new Date(endDateRaw);
    if (isNaN(endDate.getTime())) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid end date format. Use ISO 8601 format',
          field: 'endDate',
        },
        { status: 400 }
      );
    }
  }

  // Validate URL if provided
  if (url) {
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

  // Determine source (check for API indicator in user agent or custom header)
  const userAgent = request.headers.get('user-agent') || '';
  const isApi =
    request.headers.get('x-submission-source') === 'api' || !userAgent.includes('Mozilla'); // Simple heuristic: browsers have Mozilla in UA

  try {
    // Insert into database
    const result = await db
      .insert(submittedEvents)
      .values({
        title,
        description,
        startDate,
        endDate,
        location,
        organizer,
        price,
        url,
        imageUrl,
        submitterEmail,
        submitterName,
        notes,
        source: isApi ? 'api' : 'form',
        status: 'pending',
      })
      .returning({ id: submittedEvents.id });

    const submissionId = result[0]?.id;

    if (!submissionId) {
      throw new Error('Failed to get submission ID');
    }

    // Send Slack notification (async, don't block response)
    sendSubmissionNotification({
      id: submissionId,
      title,
      startDate,
      organizer,
      location,
      url,
      submitterEmail,
      submitterName,
      source: isApi ? 'api' : 'form',
    }).catch((err) => {
      console.error('[Submit] Failed to send Slack notification:', err);
    });

    return NextResponse.json(
      {
        success: true,
        id: submissionId,
        message: 'Event submitted for review. Thank you!',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[Submit] Failed to save submission:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to submit event. Please try again.',
      },
      { status: 500 }
    );
  }
}
