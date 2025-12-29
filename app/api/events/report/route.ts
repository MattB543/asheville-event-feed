import { NextResponse } from 'next/server';
import { sendEventReport, ReportType } from '@/lib/notifications/slack';
import { isRateLimited } from '@/lib/utils/rate-limit';

const VALID_REPORT_TYPES: ReportType[] = ['incorrect_info', 'duplicate', 'spam'];

// Simple in-memory rate limiting per IP
const RATE_LIMIT_MAX = 20; // 20 reports per hour per IP
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms

export async function POST(request: Request) {
  // Get client IP for rate limiting
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';

  const rateLimitKey = `report:${ip}`;
  if (isRateLimited(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Please try again later.' },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate required fields
  const { eventId, eventTitle, eventUrl, reportType } = body;

  if (!eventId || typeof eventId !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Event ID is required' },
      { status: 400 }
    );
  }

  if (!eventTitle || typeof eventTitle !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Event title is required' },
      { status: 400 }
    );
  }

  if (!eventUrl || typeof eventUrl !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Event URL is required' },
      { status: 400 }
    );
  }

  if (!reportType || !VALID_REPORT_TYPES.includes(reportType as ReportType)) {
    return NextResponse.json(
      { success: false, error: 'Invalid report type' },
      { status: 400 }
    );
  }

  try {
    await sendEventReport({
      eventId: eventId as string,
      eventTitle: eventTitle as string,
      eventUrl: eventUrl as string,
      reportType: reportType as ReportType,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Report] Failed to send report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit report' },
      { status: 500 }
    );
  }
}
