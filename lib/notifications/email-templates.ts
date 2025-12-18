import { env } from '@/lib/config/env';
import { format } from 'date-fns';

interface DigestEvent {
  id: string;
  title: string;
  startDate: Date;
  location?: string | null;
  organizer?: string | null;
  price?: string | null;
  imageUrl?: string | null;
  tags?: string[] | null;
  url: string;
}

interface DigestEmailOptions {
  recipientName?: string;
  frequency: 'daily' | 'weekly';
  events: DigestEvent[];
  unsubscribeUrl: string;
}

/**
 * Generate HTML email for event digest.
 */
export function generateDigestEmailHtml(options: DigestEmailOptions): string {
  const { recipientName, frequency, events, unsubscribeUrl } = options;
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const greeting = recipientName ? `Hey ${recipientName.split(' ')[0]}` : 'Hey there';
  const periodText = frequency === 'daily' ? 'today' : 'this week';
  const headerText = frequency === 'daily' ? 'Daily Event Digest' : 'Weekly Event Digest';

  // Group events by date
  const eventsByDate = events.reduce((acc, event) => {
    const dateKey = format(new Date(event.startDate), 'EEEE, MMM d');
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {} as Record<string, DigestEvent[]>);

  const eventSections = Object.entries(eventsByDate)
    .map(([dateKey, dateEvents]) => {
      const eventCards = dateEvents.map((event) => generateEventCard(event, appUrl)).join('');
      return `
        <tr>
          <td style="padding: 0 24px;">
            <h2 style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin: 24px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
              ${dateKey}
            </h2>
          </td>
        </tr>
        ${eventCards}
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerText} - AVL GO</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 32px 24px; text-align: center;">
              <a href="${appUrl}" style="text-decoration: none;">
                <img src="${appUrl}/avlgo_banner_logo_v2.svg" alt="AVL GO" width="120" style="max-width: 120px; height: auto;" />
              </a>
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 16px 0 0 0;">
                ${headerText}
              </h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 24px 24px 8px 24px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0;">
                ${greeting}! 👋
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 12px 0 0 0;">
                ${events.length === 0 
                  ? `No new events match your filters ${periodText}. Check back soon!`
                  : `Here are <strong>${events.length} new event${events.length === 1 ? '' : 's'}</strong> matching your preferences ${periodText}:`
                }
              </p>
            </td>
          </tr>

          <!-- Events -->
          ${events.length > 0 ? eventSections : ''}

          <!-- CTA Button -->
          <tr>
            <td style="padding: 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${appUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; padding: 14px 32px; border-radius: 8px;">
                      Browse All Events →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
                You're receiving this because you subscribed to ${frequency} event digests on AVL GO.
              </p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 12px 0 0 0;">
                <a href="${unsubscribeUrl}" style="color: #2563eb; text-decoration: underline;">Unsubscribe</a>
                &nbsp;•&nbsp;
                <a href="${appUrl}/profile" style="color: #2563eb; text-decoration: underline;">Manage Preferences</a>
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 16px 0 0 0;">
                © ${new Date().getFullYear()} AVL GO • Asheville, NC
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate a single event card for the digest email.
 */
function generateEventCard(event: DigestEvent, appUrl: string): string {
  const eventUrl = `${appUrl}/events/${slugify(event.title)}-${event.id.slice(0, 8)}`;
  const time = format(new Date(event.startDate), 'h:mm a');
  const imageUrl = event.imageUrl?.startsWith('http') 
    ? event.imageUrl 
    : event.imageUrl 
      ? `${appUrl}${event.imageUrl}` 
      : `${appUrl}/asheville-default.jpg`;

  // Limit tags to first 3
  const displayTags = (event.tags || []).slice(0, 3);

  return `
    <tr>
      <td style="padding: 8px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="padding: 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <!-- Event Image -->
                  <td width="80" valign="top" style="padding-right: 16px;">
                    <a href="${eventUrl}" style="text-decoration: none;">
                      <img src="${imageUrl}" alt="" width="80" height="80" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; display: block;" />
                    </a>
                  </td>
                  <!-- Event Details -->
                  <td valign="top">
                    <a href="${eventUrl}" style="text-decoration: none;">
                      <h3 style="color: #1a1a1a; font-size: 16px; font-weight: 600; margin: 0 0 4px 0; line-height: 1.3;">
                        ${escapeHtml(event.title)}
                      </h3>
                    </a>
                    <p style="color: #6b7280; font-size: 14px; margin: 0 0 4px 0;">
                      🕐 ${time}
                      ${event.location ? ` &nbsp;•&nbsp; 📍 ${escapeHtml(truncate(event.location, 30))}` : ''}
                    </p>
                    ${event.price ? `
                      <p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">
                        💵 ${escapeHtml(event.price)}
                      </p>
                    ` : ''}
                    ${displayTags.length > 0 ? `
                      <p style="margin: 0;">
                        ${displayTags.map(tag => `
                          <span style="display: inline-block; background-color: #e5e7eb; color: #374151; font-size: 12px; padding: 2px 8px; border-radius: 4px; margin-right: 4px;">
                            ${escapeHtml(tag)}
                          </span>
                        `).join('')}
                      </p>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

/**
 * Generate plain text version of the digest email.
 */
export function generateDigestEmailText(options: DigestEmailOptions): string {
  const { recipientName, frequency, events, unsubscribeUrl } = options;
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const greeting = recipientName ? `Hey ${recipientName.split(' ')[0]}` : 'Hey there';
  const periodText = frequency === 'daily' ? 'today' : 'this week';

  if (events.length === 0) {
    return `
${greeting}!

No new events match your filters ${periodText}. Check back soon!

Browse all events: ${appUrl}

---
Unsubscribe: ${unsubscribeUrl}
Manage preferences: ${appUrl}/profile
    `.trim();
  }

  const eventsByDate = events.reduce((acc, event) => {
    const dateKey = format(new Date(event.startDate), 'EEEE, MMM d');
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {} as Record<string, DigestEvent[]>);

  const eventSections = Object.entries(eventsByDate)
    .map(([dateKey, dateEvents]) => {
      const eventList = dateEvents
        .map((event) => {
          const time = format(new Date(event.startDate), 'h:mm a');
          const eventUrl = `${appUrl}/events/${slugify(event.title)}-${event.id.slice(0, 8)}`;
          return `  • ${event.title}
    ${time}${event.location ? ` at ${event.location}` : ''}${event.price ? ` - ${event.price}` : ''}
    ${eventUrl}`;
        })
        .join('\n\n');
      return `${dateKey}\n${'─'.repeat(dateKey.length)}\n${eventList}`;
    })
    .join('\n\n');

  return `
${greeting}!

Here are ${events.length} new event${events.length === 1 ? '' : 's'} matching your preferences ${periodText}:

${eventSections}

---

Browse all events: ${appUrl}

---
Unsubscribe: ${unsubscribeUrl}
Manage preferences: ${appUrl}/profile

© ${new Date().getFullYear()} AVL GO • Asheville, NC
  `.trim();
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Truncate text to a maximum length.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

/**
 * Create a URL-friendly slug from text.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

