import { NextResponse } from 'next/server';
import { env, isSlackEnabled } from '@/lib/config/env';
import { getCampById } from '@/lib/db/queries/camps';
import { SITE_URL } from '@/lib/seo/site';
import { clientIp, isRateLimited } from '@/lib/utils/rate-limit';
import { fetchWithRetry } from '@/lib/utils/retry';
import { isRecord, isString } from '@/lib/utils/validation';

const RATE_LIMIT_MAX = 10; // messages an hour per IP
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const MAX_LENGTH = 2000;

/** Anyone can type this, so Slack's control characters are escaped (no injected links or mentions). */
function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * POST /api/camps/feedback { message, campId? }: "Missing a camp, or something wrong?" (01 §4.6).
 * Posts to Slack like /api/events/report and stores nothing. The camp's name and link come from
 * the database, never the request.
 */
export async function POST(request: Request) {
  if (isRateLimited(`camp-feedback:${clientIp(request)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
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
  if (!isRecord(parsed) || !isString(parsed.message)) {
    return NextResponse.json({ success: false, error: 'Message is required' }, { status: 400 });
  }
  const message = parsed.message.trim();
  if (message.length < 3 || message.length > MAX_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Message must be 3-${MAX_LENGTH} characters` },
      { status: 400 }
    );
  }

  try {
    const camp = isString(parsed.campId) ? await getCampById(parsed.campId) : null;
    const about = camp
      ? `*About:* <${SITE_URL}/camps/${camp.slug}|${escapeSlack(camp.card.name)}> (${escapeSlack(camp.providerName)})`
      : '*About:* the camp directory';

    if (isSlackEnabled()) {
      await fetchWithRetry(
        env.SLACK_WEBHOOK!,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  // A section's text tops out at 3,000 characters
                  text: `:tent: *Camp feedback*\n${about}\n>${escapeSlack(message).slice(0, 2500).replace(/\n/g, '\n>')}`,
                },
              },
            ],
          }),
        },
        { maxRetries: 2 }
      );
    } else {
      console.log('[Slack] Webhook not configured, skipping camp feedback:', message.slice(0, 200));
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Camps] Feedback failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to send feedback' }, { status: 500 });
  }
}
