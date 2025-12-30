import { env, isSlackEnabled } from '@/lib/config/env';

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

  const webhookUrl = env.SLACK_WEBHOOK!;

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
    elements: submitterInfo.map(text => ({
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

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send notification:', response.status, await response.text());
      return false;
    }

    console.log('[Slack] Notification sent successfully for submission:', submission.id);
    return true;
  } catch (error) {
    console.error('[Slack] Error sending notification:', error);
    return false;
  }
}

export type ReportType = 'incorrect_info' | 'duplicate' | 'spam';

interface EventReport {
  eventId: string;
  eventTitle: string;
  eventUrl: string;
  reportType: ReportType;
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

  const webhookUrl = env.SLACK_WEBHOOK!;
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
    },
  ];

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send report notification:', response.status, await response.text());
      return false;
    }

    console.log('[Slack] Report notification sent for event:', report.eventId);
    return true;
  } catch (error) {
    console.error('[Slack] Error sending report notification:', error);
    return false;
  }
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
    text?: string | {
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

  const webhookUrl = env.SLACK_WEBHOOK!;

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
      elements: submitterInfo.map(text => ({
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

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send URL submission notification:', response.status, await response.text());
      return false;
    }

    console.log('[Slack] URL submission notification sent for:', submission.id);
    return true;
  } catch (error) {
    console.error('[Slack] Error sending URL submission notification:', error);
    return false;
  }
}

/**
 * Verification result for Slack notification
 */
interface VerificationNotification {
  eventsChecked: number;
  eventsHidden: number;
  eventsUpdated: number;
  eventsKept: number;
  hiddenEvents: Array<{ title: string; reason: string; url?: string }>;
  updatedEvents: Array<{ title: string; reason: string; url?: string }>;
  durationSeconds: number;
}

/**
 * Send a Slack notification for event verification results.
 * Only sends if there are hidden or updated events.
 */
export async function sendVerificationNotification(results: VerificationNotification): Promise<boolean> {
  if (!isSlackEnabled()) {
    console.log('[Slack] Webhook not configured, skipping verification notification');
    return false;
  }

  // Only notify if there are actions taken
  if (results.eventsHidden === 0 && results.eventsUpdated === 0) {
    console.log('[Slack] No events hidden or updated, skipping notification');
    return false;
  }

  const webhookUrl = env.SLACK_WEBHOOK!;

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

  // Add hidden events section
  if (results.eventsHidden > 0) {
    const hiddenList = results.hiddenEvents
      .slice(0, 10) // Limit to 10 for readability
      .map(e => `• ${e.title.slice(0, 40)}${e.title.length > 40 ? '...' : ''} - ${e.reason}`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*:no_entry: Hidden Events (${results.eventsHidden}):*\n${hiddenList}${results.eventsHidden > 10 ? `\n_...and ${results.eventsHidden - 10} more_` : ''}`,
      },
    });
  }

  // Add updated events section
  if (results.eventsUpdated > 0) {
    const updatedList = results.updatedEvents
      .slice(0, 10) // Limit to 10 for readability
      .map(e => `• ${e.title.slice(0, 40)}${e.title.length > 40 ? '...' : ''} - ${e.reason}`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*:arrows_counterclockwise: Updated Events (${results.eventsUpdated}):*\n${updatedList}${results.eventsUpdated > 10 ? `\n_...and ${results.eventsUpdated - 10} more_` : ''}`,
      },
    });
  }

  // Add summary context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Kept: ${results.eventsKept} | Hidden: ${results.eventsHidden} | Updated: ${results.eventsUpdated}`,
      },
    ],
  });

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send verification notification:', response.status, await response.text());
      return false;
    }

    console.log('[Slack] Verification notification sent');
    return true;
  } catch (error) {
    console.error('[Slack] Error sending verification notification:', error);
    return false;
  }
}
