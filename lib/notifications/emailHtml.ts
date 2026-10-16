/**
 * Shared pieces for building email HTML.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A URL never ends in punctuation, so "(see https://x.com)." doesn't link the ")."
function linkifyHtml(text: string): string {
  return text.replace(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g, (url) => {
    return `<a href="${url}" style="color: #0f766e; text-decoration: underline;">${url}</a>`;
  });
}

/** A plain-text paragraph as an HTML <p>, with line breaks kept and URLs linked */
export function paragraphToHtml(paragraph: string): string {
  const escaped = escapeHtml(paragraph).replace(/\r?\n/g, '<br />');
  return `<p style="margin: 0 0 16px 0; color: #374151; font-size: 16px; line-height: 1.65;">${linkifyHtml(escaped)}</p>`;
}

/** e.g. "Friday, Oct 16" */
export function formatEasternDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** e.g. "7:00 PM" */
export function formatEasternTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '.';
}
