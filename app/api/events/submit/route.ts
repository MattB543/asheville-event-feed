import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submittedEvents } from '@/lib/db/schema';
import { sendSubmissionNotification } from '@/lib/notifications/slack';

// Simple in-memory rate limiting
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

// GET: Return API documentation
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/events/submit',
    description: 'Submit an event suggestion for review. Events are manually reviewed before appearing on the site.',
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

  // Validate required fields
  if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'Title is required',
        field: 'title',
      },
      { status: 400 }
    );
  }

  if (!body.startDate) {
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
  const startDate = new Date(body.startDate as string);
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
  if (body.endDate) {
    endDate = new Date(body.endDate as string);
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
  if (body.url && typeof body.url === 'string') {
    try {
      new URL(body.url);
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

  // Determine source (check for API indicator in user agent or custom header)
  const userAgent = request.headers.get('user-agent') || '';
  const isApi = request.headers.get('x-submission-source') === 'api' ||
    !userAgent.includes('Mozilla'); // Simple heuristic: browsers have Mozilla in UA

  try {
    // Insert into database
    const result = await db
      .insert(submittedEvents)
      .values({
        title: (body.title as string).trim(),
        description: body.description ? String(body.description).trim() : null,
        startDate,
        endDate,
        location: body.location ? String(body.location).trim() : null,
        organizer: body.organizer ? String(body.organizer).trim() : null,
        price: body.price ? String(body.price).trim() : null,
        url: body.url ? String(body.url).trim() : null,
        imageUrl: body.imageUrl ? String(body.imageUrl).trim() : null,
        submitterEmail: body.submitterEmail ? String(body.submitterEmail).trim().toLowerCase() : null,
        submitterName: body.submitterName ? String(body.submitterName).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
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
      title: (body.title as string).trim(),
      startDate,
      organizer: body.organizer ? String(body.organizer).trim() : null,
      location: body.location ? String(body.location).trim() : null,
      url: body.url ? String(body.url).trim() : null,
      submitterEmail: body.submitterEmail ? String(body.submitterEmail).trim() : null,
      submitterName: body.submitterName ? String(body.submitterName).trim() : null,
      source: isApi ? 'api' : 'form',
    }).catch(err => {
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
