import { readFile } from 'fs/promises';
import path from 'path';
import { env } from '@/lib/config/env';

const EMAIL_SUBJECT = 'TEDxAsheville Attendee Match: one quick step left';
const FIRST_NAME_TOKEN = '{first_name - matching_profiles split on space, first item}';
const TEMPLATE_PATH = path.join(process.cwd(), 'claude', 'email-copy.md');

let templatePromise: Promise<string> | null = null;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkifyHtml(text: string): string {
  return text.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    return `<a href="${url}" style="color: #0f766e; text-decoration: underline;">${url}</a>`;
  });
}

function paragraphToHtml(paragraph: string): string {
  const escaped = escapeHtml(paragraph).replace(/\r?\n/g, '<br />');
  return `<p style="margin: 0 0 16px 0; color: #374151; font-size: 16px; line-height: 1.65;">${linkifyHtml(escaped)}</p>`;
}

async function loadTemplate(): Promise<string> {
  if (!templatePromise) {
    templatePromise = readFile(TEMPLATE_PATH, 'utf-8').then((content) => content.trim());
  }

  const template = await templatePromise;
  if (!template.includes(FIRST_NAME_TOKEN)) {
    throw new Error(`Template is missing first-name token: ${TEMPLATE_PATH}`);
  }

  return template;
}

export function getFirstName(name?: string | null): string {
  const value = (name || '').trim();
  if (!value) return 'there';
  return value.split(/\s+/)[0] || 'there';
}

export async function buildTedxDraftInviteEmail(options: {
  recipientName?: string | null;
}): Promise<{ subject: string; htmlBody: string; textBody: string }> {
  const rawTemplate = await loadTemplate();
  const firstName = getFirstName(options.recipientName);
  const textBody = rawTemplate.replace(FIRST_NAME_TOKEN, firstName).trim();
  const paragraphs = textBody
    .split(/\r?\n\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(paragraphToHtml)
    .join('\n');
  const appUrl = env.NEXT_PUBLIC_APP_URL;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${EMAIL_SUBJECT}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="background: linear-gradient(135deg, #0f766e 0%, #0e7490 100%); padding: 32px 24px; text-align: center;">
              <a href="${appUrl}" style="text-decoration: none;">
                <img src="${appUrl}/avlgo_banner_logo_v2.svg" alt="AVL GO" width="120" style="max-width: 120px; height: auto;" />
              </a>
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 16px 0 0 0;">
                TEDxAsheville Attendee Match
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 24px 12px 24px;">
              ${paragraphs}
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

  return {
    subject: EMAIL_SUBJECT,
    htmlBody,
    textBody,
  };
}
