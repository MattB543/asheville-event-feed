import { NextResponse } from 'next/server';
import { sendEventReport, type ReportType } from '@/lib/notifications/slack';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord, isString } from '@/lib/utils/validation';
import { verifyEventById, isVerificationEnabled } from '@/lib/ai/eventVerification';

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

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isRecord(parsed)) {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const eventId = isString(parsed.eventId) ? parsed.eventId : undefined;
  const eventTitle = isString(parsed.eventTitle) ? parsed.eventTitle : undefined;
  const eventUrl = isString(parsed.eventUrl) ? parsed.eventUrl : undefined;
  const reportType =
    isString(parsed.reportType) && VALID_REPORT_TYPES.includes(parsed.reportType as ReportType)
      ? (parsed.reportType as ReportType)
      : undefined;

  // Validate required fields
  if (!eventId) {
    return NextResponse.json({ success: false, error: 'Event ID is required' }, { status: 400 });
  }

  if (!eventTitle) {
    return NextResponse.json({ success: false, error: 'Event title is required' }, { status: 400 });
  }

  if (!eventUrl) {
    return NextResponse.json({ success: false, error: 'Event URL is required' }, { status: 400 });
  }

  if (!reportType) {
    return NextResponse.json({ success: false, error: 'Invalid report type' }, { status: 400 });
  }

  try {
    // For "incorrect_info" reports, auto-verify the event against its source
    // Use a timeout to prevent blocking the user response for too long
    let verificationResult = null;
    if (reportType === 'incorrect_info' && isVerificationEnabled()) {
      console.log(`[Report] Auto-verifying event: ${eventId}`);
      try {
        // Race verification against a 5-second timeout
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 5000);
        });

        verificationResult = await Promise.race([verifyEventById(eventId, true), timeoutPromise]);

        if (verificationResult) {
          console.log(
            `[Report] Verification result: ${verificationResult.action} (${verificationResult.confidence * 100}%)`
          );
        } else {
          console.log('[Report] Verification timed out, continuing without result');
        }
      } catch (verifyError) {
        console.error('[Report] Verification failed:', verifyError);
        // Continue with report even if verification fails
      }
    }

    await sendEventReport({
      eventId,
      eventTitle,
      eventUrl,
      reportType,
      verificationResult: verificationResult
        ? {
            action: verificationResult.action,
            reason: verificationResult.reason,
            confidence: verificationResult.confidence,
            applied: verificationResult.applied || false,
            updates: verificationResult.updates,
          }
        : undefined,
    });

    return NextResponse.json({
      success: true,
      verification: verificationResult
        ? {
            action: verificationResult.action,
            applied: verificationResult.applied || false,
          }
        : undefined,
    });
  } catch (error) {
    console.error('[Report] Failed to send report:', error);
    return NextResponse.json({ success: false, error: 'Failed to submit report' }, { status: 500 });
  }
}
