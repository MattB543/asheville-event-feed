import { env, isPostmarkEnabled } from '@/lib/config/env';

interface EmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

interface PostmarkSendResponse {
  MessageID?: string;
}

interface PostmarkBatchResponseItem {
  ErrorCode?: number;
}

/**
 * Send an email via Postmark API.
 * Returns true if sent successfully, false if Postmark is not configured or failed.
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!isPostmarkEnabled()) {
    console.log('[Postmark] Not configured, skipping email');
    return false;
  }

  const apiKey = env.POSTMARK_API_KEY!;
  const fromEmail = env.POSTMARK_FROM_EMAIL!;

  try {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': apiKey,
      },
      body: JSON.stringify({
        From: fromEmail,
        To: options.to,
        Subject: options.subject,
        HtmlBody: options.htmlBody,
        TextBody: options.textBody || stripHtml(options.htmlBody),
        MessageStream: 'outbound',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Postmark] Failed to send email:', response.status, errorText);
      return false;
    }

    const result = (await response.json()) as PostmarkSendResponse;
    console.log('[Postmark] Email sent successfully:', result.MessageID ?? 'unknown');
    return true;
  } catch (error) {
    console.error('[Postmark] Error sending email:', error);
    return false;
  }
}

/**
 * Send a batch of emails via Postmark API.
 * More efficient for sending multiple emails at once.
 * Returns the number of successfully sent emails.
 */
export async function sendBatchEmails(emails: EmailOptions[]): Promise<number> {
  if (!isPostmarkEnabled()) {
    console.log('[Postmark] Not configured, skipping batch email');
    return 0;
  }

  if (emails.length === 0) {
    return 0;
  }

  const apiKey = env.POSTMARK_API_KEY!;
  const fromEmail = env.POSTMARK_FROM_EMAIL!;

  // Postmark allows max 500 emails per batch
  const batches = chunk(emails, 500);
  let successCount = 0;

  for (const batch of batches) {
    try {
      const response = await fetch('https://api.postmarkapp.com/email/batch', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': apiKey,
        },
        body: JSON.stringify(
          batch.map((email) => ({
            From: fromEmail,
            To: email.to,
            Subject: email.subject,
            HtmlBody: email.htmlBody,
            TextBody: email.textBody || stripHtml(email.htmlBody),
            MessageStream: 'outbound',
          }))
        ),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Postmark] Failed to send batch:', response.status, errorText);
        continue;
      }

      const results = (await response.json()) as PostmarkBatchResponseItem[];
      const batchSuccess = Array.isArray(results)
        ? results.filter((r) => r.ErrorCode === 0).length
        : 0;
      successCount += batchSuccess;
      console.log(`[Postmark] Batch sent: ${batchSuccess}/${batch.length} successful`);
    } catch (error) {
      console.error('[Postmark] Error sending batch:', error);
    }
  }

  return successCount;
}

/**
 * Simple HTML to plain text conversion for email text body.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Helper to chunk arrays for batch processing.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}
