import { env, isSlackEnabled } from '@/lib/config/env';
import { fetchWithRetry } from '@/lib/utils/retry';
import { SITE_URL } from '@/lib/seo/site';

interface EventSubmission {
  id: string;
  title: string;
  startDate: Date;
  organizer?: string | null;
  location?: string | null;
  url?: string | null;
  submitterEmail?: string | null;
  submitterName?: string | null;
  source: string;
}

/**
 * Send a Slack notification for a new event submission.
 * Returns true if sent successfully, false if Slack is not configured or failed.
 */
export async function sendSubmissionNotification(submission: EventSubmission): Promise<boolean> {
  if (!isSlackEnabled()) {
    console.log('[Slack] Webhook not configured, skipping notification');
    return false;
  }

  // Format the date nicely
  const dateStr = submission.startDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = submission.startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Build the message blocks
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'New Event Submission',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Title:*\n${submission.title}`,
        },
        {
          type: 'mrkdwn',
          text: `*Date:*\n${dateStr} at ${timeStr}`,
        },
      ],
    },
  ];

  // Add optional fields
  const optionalFields: Array<{ type: string; text: string }> = [];

  if (submission.location) {
    optionalFields.push({
      type: 'mrkdwn',
      text: `*Location:*\n${submission.location}`,
    });
  }

  if (submission.organizer) {
    optionalFields.push({
      type: 'mrkdwn',
      text: `*Organizer:*\n${submission.organizer}`,
    });
  }

  if (optionalFields.length > 0) {
    blocks.push({
      type: 'section',
      fields: optionalFields,
    });
  }

  // Add submitter info section
  const submitterInfo: string[] = [];
  if (submission.submitterName) {
    submitterInfo.push(`*Submitted by:* ${submission.submitterName}`);
  }
  if (submission.submitterEmail) {
    submitterInfo.push(`*Email:* ${submission.submitterEmail}`);
  }
  submitterInfo.push(`*Source:* ${submission.source === 'api' ? 'API' : 'Web Form'}`);

  blocks.push({
    type: 'context',
    elements: submitterInfo.map((text) => ({
      type: 'mrkdwn',
      text,
    })),
  });

  // Add link button if URL provided
  if (submission.url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Original Event',
            emoji: true,
          },
          url: submission.url,
          action_id: 'view_event',
        },
      ],
    });
  }

  return postToSlack(blocks, 'submission notification');
}

export type ReportType = 'incorrect_info' | 'duplicate' | 'spam';

interface EventReport {
  eventId: string;
  eventTitle: string;
  eventUrl: string;
  reportType: ReportType;
  verificationResult?: {
    action: 'keep' | 'hide' | 'update';
    reason: string;
    confidence: number;
    applied: boolean;
    updates?: {
      price?: string | null;
      description?: string | null;
      location?: string | null;
    };
  };
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  incorrect_info: 'Incorrect Info',
  duplicate: 'Duplicate Event',
  spam: 'Spam',
};

const REPORT_TYPE_EMOJI: Record<ReportType, string> = {
  incorrect_info: ':warning:',
  duplicate: ':repeat:',
  spam: ':no_entry:',
};

/**
 * Send a Slack notification for an event report.
 * Returns true if sent successfully, false if Slack is not configured or failed.
 */
export async function sendEventReport(report: EventReport): Promise<boolean> {
  if (!isSlackEnabled()) {
    console.log('[Slack] Webhook not configured, skipping report notification');
    return false;
  }

  const emoji = REPORT_TYPE_EMOJI[report.reportType];
  const label = REPORT_TYPE_LABELS[report.reportType];

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} Event Report: ${label}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Event:*\n${report.eventTitle}`,
        },
        {
          type: 'mrkdwn',
          text: `*Report Type:*\n${label}`,
        },
      ],
    },
  ];

  // Add verification result section for incorrect_info reports
  if (report.verificationResult) {
    const vr = report.verificationResult;
    const actionEmoji =
      vr.action === 'keep'
        ? ':white_check_mark:'
        : vr.action === 'update'
          ? ':arrows_counterclockwise:'
          : ':no_entry:';
    const actionLabel =
      vr.action === 'keep' ? 'Verified OK' : vr.action === 'update' ? 'Updated' : 'Hidden';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${actionEmoji} Auto-Verification: ${actionLabel}*\n${vr.reason}\n_Confidence: ${(vr.confidence * 100).toFixed(0)}% | Applied: ${vr.applied ? 'Yes' : 'No'}_`,
      },
    });

    // Show what was updated if applicable
    if (vr.updates && vr.action === 'update') {
      const updateDetails: string[] = [];
      if (vr.updates.price) updateDetails.push(`Price: ${vr.updates.price}`);
      if (vr.updates.location) updateDetails.push(`Location: ${vr.updates.location}`);
      if (vr.updates.description) updateDetails.push(`Description: (updated)`);

      if (updateDetails.length > 0) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `*Updates:* ${updateDetails.join(' | ')}`,
            },
          ],
        });
      }
    }
  }

  blocks.push(
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Event ID:* ${report.eventId}`,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Event',
            emoji: true,
          },
          url: report.eventUrl,
          action_id: 'view_reported_event',
        },
      ],
    }
  );

  return postToSlack(blocks, 'report notification');
}

// Slack block types (simplified)
interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: Array<{
    type: string;
    text?:
      | string
      | {
          type: string;
          text: string;
          emoji?: boolean;
        };
    url?: string;
    action_id?: string;
  }>;
}

interface UrlSubmission {
  id: string;
  url: string;
  submitterName?: string | null;
  submitterEmail?: string | null;
}

/**
 * Send a Slack notification for a URL-only event submission.
 * These are simpler submissions where users just share a link for manual review.
 */
export async function sendUrlSubmissionNotification(submission: UrlSubmission): Promise<boolean> {
  if (!isSlackEnabled()) {
    console.log('[Slack] Webhook not configured, skipping URL submission notification');
    return false;
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'New Event URL Submission',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Someone submitted an event URL for review:\n\n${submission.url}`,
      },
    },
  ];

  // Add submitter info if provided
  const submitterInfo: string[] = [];
  if (submission.submitterName) {
    submitterInfo.push(`*Submitted by:* ${submission.submitterName}`);
  }
  if (submission.submitterEmail) {
    submitterInfo.push(`*Email:* ${submission.submitterEmail}`);
  }

  if (submitterInfo.length > 0) {
    blocks.push({
      type: 'context',
      elements: submitterInfo.map((text) => ({
        type: 'mrkdwn',
        text,
      })),
    });
  }

  // Add action button to view the URL
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Event URL',
          emoji: true,
        },
        url: submission.url,
        action_id: 'view_url_submission',
      },
    ],
  });

  return postToSlack(blocks, 'URL submission notification');
}

interface FlaggedPoster {
  uploadId: string;
  /** Why it needs review: the model's own reason, or 'GEMINI_BLOCKED:<reason>' */
  safetyReason: string;
  /** Titles the model did manage to read, if any (Gemini hard blocks yield none) */
  posterTitles?: string[];
  /** Absolute URL of the admin queue, when the caller knows the site origin */
  adminUrl?: string | null;
}

/**
 * Send a Slack notification when a poster upload is held for moderation.
 * Flagged images never become public, so there is no image to preview here -
 * the admin queue renders them via a signed URL.
 */
export async function sendPosterFlaggedNotification(poster: FlaggedPoster): Promise<boolean> {
  if (!isSlackEnabled()) {
    console.log('[Slack] Webhook not configured, skipping poster flag notification');
    return false;
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':lock: Poster Upload Held for Review',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:*\n${poster.safetyReason}`,
      },
    },
  ];

  if (poster.posterTitles && poster.posterTitles.length > 0) {
    const titleList = poster.posterTitles
      .slice(0, 10)
      .map((title) => `• ${title.slice(0, 60)}${title.length > 60 ? '...' : ''}`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Extracted posters (${poster.posterTitles.length}):*\n${titleList}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `*Upload ID:* ${poster.uploadId}`,
      },
    ],
  });

  if (poster.adminUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Review Poster',
            emoji: true,
          },
          url: poster.adminUrl,
          action_id: 'review_flagged_poster',
        },
      ],
    });
  }

  return postToSlack(blocks, 'poster flagged notification');
}

/**
 * One event the verify job changed, for the Slack report
 */
interface VerifiedEventNote {
  title: string;
  reason: string;
  url?: string;
}

/**
 * Verification result for Slack notification
 */
interface VerificationNotification {
  eventsChecked: number;
  eventsKept: number;
  hiddenEvents: VerifiedEventNote[];
  deadEvents: VerifiedEventNote[];
  updatedEvents: VerifiedEventNote[];
  durationSeconds: number;
}

/**
 * Send a Slack notification for event verification results.
 * Only sends if events were hidden, marked dead, or updated.
 */
export async function sendVerificationNotification(
  results: VerificationNotification
): Promise<boolean> {
  if (!isSlackEnabled()) {
    console.log('[Slack] Webhook not configured, skipping verification notification');
    return false;
  }

  const { hiddenEvents, deadEvents, updatedEvents } = results;

  // Only notify if there are actions taken
  if (hiddenEvents.length + deadEvents.length + updatedEvents.length === 0) {
    console.log('[Slack] No events hidden, dead or updated, skipping notification');
    return false;
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':mag: Event Verification Report',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Events Checked:*\n${results.eventsChecked}`,
        },
        {
          type: 'mrkdwn',
          text: `*Duration:*\n${results.durationSeconds.toFixed(1)}s`,
        },
      ],
    },
  ];

  const addSection = (heading: string, list: VerifiedEventNote[]) => {
    if (list.length === 0) return;
    const lines = list
      .slice(0, 10) // Limit to 10 for readability
      // Reasons are capped so ten of them stay under Slack's 3,000-char section limit
      .map(
        (e) =>
          `• ${e.title.slice(0, 40)}${e.title.length > 40 ? '...' : ''} - ${e.reason.slice(0, 200)}${e.reason.length > 200 ? '...' : ''}`
      )
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${heading} (${list.length}):*\n${lines}${list.length > 10 ? `\n_...and ${list.length - 10} more_` : ''}`,
      },
    });
  };
  addSection(':no_entry: Hidden Events (cancelled or not on this date)', hiddenEvents);
  addSection(':link: Dead Links (page gone, no longer listed)', deadEvents);
  addSection(':arrows_counterclockwise: Updated Events', updatedEvents);

  // Add summary context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Kept: ${results.eventsKept} | Hidden: ${hiddenEvents.length} | Dead: ${deadEvents.length} | Updated: ${updatedEvents.length}`,
      },
    ],
  });

  return postToSlack(blocks, 'verification notification');
}

async function postToSlack(blocks: SlackBlock[], label: string): Promise<boolean> {
  try {
    const response = await fetchWithRetry(
      env.SLACK_WEBHOOK!,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      },
      { maxRetries: 2 }
    );
    console.log(`[Slack] ${label} sent`, response.status);
    return true;
  } catch (error) {
    console.error(`[Slack] Error sending ${label}:`, error);
    return false;
  }
}

/** A failed weekly playlist run; the playlist itself is left as it was */
export async function sendPlaylistFailedNotification(error: unknown): Promise<boolean> {
  if (!isSlackEnabled()) return false;
  const message = error instanceof Error ? error.message : String(error);
  return postToSlack(
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *Weekly Spotify playlist didn't update*\n${message.slice(0, 500)}\nThe playlist keeps last week's songs. Re-run \`/api/cron/playlist\` once it's fixed.`,
        },
      },
    ],
    'playlist failure notification'
  );
}

/** A public signature on the /plan letter is waiting for the super admin's review */
export async function sendLetterSignatureNotification(signature: {
  name: string;
  neighborhood: string | null;
  role: string | null;
  pendingCount: number;
}): Promise<boolean> {
  if (!isSlackEnabled()) return false;
  // Signers type these, so escape Slack's control characters (no injected links or mentions)
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const signer = [signature.name, signature.neighborhood, signature.role]
    .filter((part): part is string => !!part)
    .map(escape)
    .join(' · ');
  return postToSlack(
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:writing_hand: *New public signature to review* (${signature.pendingCount} waiting)\n${signer}\n<${SITE_URL}/plan#review|Review signatures>`,
        },
      },
    ],
    'letter signature notification'
  );
}
