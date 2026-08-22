import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendEventReport, type ReportType } from '@/lib/notifications/slack';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord, isString } from '@/lib/utils/validation';

const VALID_REPORT_TYPES: ReportType[] = ['incorrect_info', 'duplicate', 'spam'];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isRecord(parsed)) {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  // Title/URL are deliberately NOT read from the body - they're looked up from
  // the database below so a report can't name or link a different event.
  const eventId = isString(parsed.eventId) ? parsed.eventId : undefined;
  const reportType =
    isString(parsed.reportType) && VALID_REPORT_TYPES.includes(parsed.reportType as ReportType)
      ? (parsed.reportType as ReportType)
      : undefined;

  // Validate required fields
  if (!eventId) {
    return NextResponse.json({ success: false, error: 'Event ID is required' }, { status: 400 });
  }

  if (!UUID_REGEX.test(eventId)) {
    return NextResponse.json({ success: false, error: 'Invalid event ID format' }, { status: 400 });
  }

  if (!reportType) {
    return NextResponse.json({ success: false, error: 'Invalid report type' }, { status: 400 });
  }

  try {
    // Look the event up so the Slack message uses canonical DB values rather
    // than client-supplied strings (and so unknown IDs are rejected).
    const [event] = await db
      .select({ title: events.title, url: events.url })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!event) {
      return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 });
    }

    // Note: no synchronous AI verification here - this route is anonymous, and
    // verification is a paid call with mutation power. It runs from the
    // authenticated cron/admin workflow instead (/api/cron/verify).
    await sendEventReport({
      eventId,
      eventTitle: event.title,
      eventUrl: event.url,
      reportType,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Report] Failed to send report:', error);
    return NextResponse.json({ success: false, error: 'Failed to submit report' }, { status: 500 });
  }
}
