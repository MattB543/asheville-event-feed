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
