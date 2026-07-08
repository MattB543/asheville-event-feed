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

// ---------------------------------------------------------------------------
// Cohort round email (one match per person per round)
// ---------------------------------------------------------------------------

interface CohortMatchPartner {
  name: string;
  whyMatch: string;
  conversationStarter: string;
}

interface CohortMatchEmailOptions {
  recipientName?: string | null;
  roundNumber: number;
  totalRounds: number;
  partners: CohortMatchPartner[]; // 1 for a pair, 2 for a trio
}

function renderCohortPartnerCard(partner: CohortMatchPartner): string {
  return `
    <tr>
      <td style="padding: 10px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px;">
          <tr>
            <td style="padding: 16px 16px 12px 16px;">
              <p style="margin: 0 0 10px 0; color: #111827; font-size: 18px; font-weight: 700;">
                ${escapeHtml(partner.name)}
              </p>
              <p style="margin: 0 0 4px 0; color: #374151; font-size: 13px; font-weight: 700;">
                Why you were matched:
              </p>
              <p style="margin: 0 0 14px 0; color: #374151; font-size: 14px; line-height: 1.55;">
                ${escapeHtml(partner.whyMatch)}
              </p>
              <p style="margin: 0 0 4px 0; color: #374151; font-size: 13px; font-weight: 700;">
                Conversation starter:
              </p>
              <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.55; font-style: italic;">
                ${escapeHtml(partner.conversationStarter)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

export function generateCohortMatchEmailHtml(options: CohortMatchEmailOptions): string {
  const greetingName = firstName(options.recipientName);
  const partnerCards = options.partners.map((p) => renderCohortPartnerCard(p)).join('');
  const isTrio = options.partners.length > 1;
  const partnerNames = options.partners.map((p) => p.name);
  const partnerLabel = isTrio
    ? `${partnerNames.slice(0, -1).join(', ')} and ${partnerNames[partnerNames.length - 1]}`
    : (partnerNames[0] ?? 'your match');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Round ${options.roundNumber} Match</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="background: linear-gradient(135deg, #0f766e 0%, #0e7490 100%); padding: 32px 24px; text-align: center;">
              <p style="color: rgba(255, 255, 255, 0.85); font-size: 14px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin: 0 0 8px 0;">
                Round ${options.roundNumber} of ${options.totalRounds}
              </p>
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">
                Your Conversation Match
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 24px 8px 24px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0;">
                Hey ${escapeHtml(greetingName)},
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 12px 0 0 0;">
                For Round ${options.roundNumber}, you've been matched with <strong>${escapeHtml(partnerLabel)}</strong>. Here's why we think you'll have a great conversation:
              </p>
            </td>
          </tr>

          ${partnerCards}

          <tr>
            <td style="padding: 8px 24px 24px 24px;">
              <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
                This match was generated from your submitted profile. The conversation starter is just a suggestion &mdash; go wherever the conversation takes you!
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                &copy; ${new Date().getFullYear()} AVL GO &mdash; Asheville, NC
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

export function generateCohortMatchEmailText(options: CohortMatchEmailOptions): string {
  const greetingName = firstName(options.recipientName);
  const partnerNames = options.partners.map((p) => p.name);
  const partnerLabel =
    partnerNames.length > 1
      ? `${partnerNames.slice(0, -1).join(', ')} and ${partnerNames[partnerNames.length - 1]}`
      : (partnerNames[0] ?? 'your match');

  const partnerBlocks = options.partners.map((p) =>
    [
      p.name,
      `Why you were matched: ${p.whyMatch}`,
      `Conversation starter: ${p.conversationStarter}`,
    ].join('\n')
  );

  return [
    `Hey ${greetingName},`,
    '',
    `For Round ${options.roundNumber} of ${options.totalRounds}, you've been matched with ${partnerLabel}.`,
    '',
    ...partnerBlocks.join('\n\n').split('\n'),
    '',
    'This match was generated from your submitted profile. The conversation starter is just a suggestion -- go wherever the conversation takes you!',
  ].join('\n');
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
