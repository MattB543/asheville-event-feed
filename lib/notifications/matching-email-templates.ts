interface MatchEmailEntry {
  name: string;
  whyMatch: string;
  conversationStarter: string;
}

interface MatchingEmailOptions {
  recipientName?: string | null;
  matches: MatchEmailEntry[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstName(fullName?: string | null): string {
  const value = (fullName || '').trim();
  if (!value) return 'there';
  return value.split(/\s+/)[0] || 'there';
}

function renderMatchCard(match: MatchEmailEntry, rank: number): string {
  return `
    <tr>
      <td style="padding: 10px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px;">
          <tr>
            <td style="padding: 16px 16px 12px 16px;">
              <p style="margin: 0 0 6px 0; color: #111827; font-size: 16px; font-weight: 700;">
                #${rank}: ${escapeHtml(match.name)}
              </p>
              <p style="margin: 0 0 4px 0; color: #374151; font-size: 13px; font-weight: 700;">
                Why were you matched:
              </p>
              <p style="margin: 0 0 10px 0; color: #374151; font-size: 14px; line-height: 1.55;">
                ${escapeHtml(match.whyMatch)}
              </p>
              <p style="margin: 0 0 4px 0; color: #374151; font-size: 13px; font-weight: 700;">
                Conversation starter:
              </p>
              <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.55;">
                ${escapeHtml(match.conversationStarter)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

export function generateTedxMatchesEmailHtml(options: MatchingEmailOptions): string {
  const greetingName = firstName(options.recipientName);
  const cards = options.matches.map((match, idx) => renderMatchCard(match, idx + 1)).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your TEDxAsheville Top 5 Matches</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="background: linear-gradient(135deg, #0f766e 0%, #0e7490 100%); padding: 32px 24px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 16px 0 0 0;">
                Your TEDxAsheville Top 5 Matches
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 24px 8px 24px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0;">
                Hey ${escapeHtml(greetingName)},
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 12px 0 0 0;">
                Based on your TEDx Asheville matching profile, here are five people you are likely to have a strong conversation with.
              </p>
            </td>
          </tr>

          ${cards}

          <tr>
            <td style="padding: 8px 24px 24px 24px;">
              <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
                These are conversation suggestions generated from submitted matching profiles.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                (c) ${new Date().getFullYear()} AVL GO - Asheville, NC
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

export function generateTedxMatchesEmailText(options: MatchingEmailOptions): string {
  const greetingName = firstName(options.recipientName);
  const lines = options.matches.map((match, idx) => {
    return [
      `#${idx + 1}: ${match.name}`,
      `Why were you matched: ${match.whyMatch}`,
      `Conversation starter: ${match.conversationStarter}`,
    ].join('\n');
  });

  return [
    `Hey ${greetingName},`,
    '',
    'Here are your TEDx Asheville Top 5 matches:',
    '',
    ...lines.join('\n\n').split('\n'),
  ].join('\n');
}
