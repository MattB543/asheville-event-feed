import { readFile } from 'fs/promises';
import path from 'path';

const EMAIL_SUBJECT = 'Tomorrow is TEDxAsheville';
const FIRST_NAME_TOKEN = '[First Name]';
const DRAFT_ONLY_LINE =
  "(I see you started your submission, but didn't finish it. Submit it now! https://www.avlgo.com/tedx)";
const TEMPLATE_PATH = path.join(process.cwd(), 'claude', 'email-copy-2.md');

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

function buildTextBody(template: string, recipientName: string, status: string): string {
  const firstName = getFirstName(recipientName);
  const lines = template
    .replace(FIRST_NAME_TOKEN, firstName)
    .split(/\r?\n/)
    .filter((line) => (status === 'draft' ? true : line.trim() !== DRAFT_ONLY_LINE))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return lines;
}

export async function buildTedxTomorrowEmail(options: {
  recipientName?: string | null;
  status: string;
}): Promise<{ subject: string; htmlBody: string; textBody: string }> {
  const rawTemplate = await loadTemplate();
  const textBody = buildTextBody(rawTemplate, options.recipientName || '', options.status);
  const paragraphs = textBody
    .split(/\r?\n\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(paragraphToHtml)
    .join('\n');

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
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">
                Tomorrow is TEDxAsheville
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
