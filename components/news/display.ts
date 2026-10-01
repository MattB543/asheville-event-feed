/**
 * Formatting for /news, shared by the server-rendered cards and the client bits.
 * Dates are ET throughout, like the events pages.
 */

import { newsTopic } from '@/lib/news/topics';

const TIME_ZONE = 'America/New_York';

const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
});
// Filing days are bare dates, so they're formatted as UTC noon to stay on the right day.
const DAY_HEADER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** 'YYYY-MM-DD' in ET. */
export function etDay(date: Date): string {
  return DAY_KEY.format(date);
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** A filing day's sticky header: "Today", "Yesterday", or "Mon, Sep 28". */
export function dayLabel(day: string, now: Date): string {
  const today = etDay(now);
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  return DAY_HEADER.format(new Date(`${day}T12:00:00Z`));
}

/** "Just now", "12m ago", "3h ago", "Yesterday", then "Sep 28". */
export function relativeTime(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60 && etDay(date) === etDay(now)) return `${Math.floor(minutes / 60)}h ago`;
  if (etDay(date) === shiftDay(etDay(now), -1)) return 'Yesterday';
  return SHORT_DATE.format(date);
}

/** An outbound article link, tagged so outlets can see the traffic came from us. */
export function outboundUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('utm_source', 'avlgo');
    return parsed.toString();
  } catch {
    return url;
  }
}

const IMAGE_DENYLIST = /logo|placeholder|default|favicon|avatar|icon|blank|spacer|screenshot/i;

/**
 * §7.4's "real photo" check. The pipeline applies it when it picks a story's
 * image; it's repeated here so a bad URL can never reach a card.
 */
export function isUsableStoryImage(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !IMAGE_DENYLIST.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * A story's first topic, named as the topic filter names it, so the tag on a
 * card links to exactly the filter it reads as.
 */
export function primaryTopic(topics: string[]): { slug: string; label: string } | null {
  for (const slug of topics) {
    const topic = newsTopic(slug);
    if (topic) return { slug: topic.slug, label: topic.label };
  }
  return null;
}

/** "r/asheville discussion" from a Reddit thread URL. */
export function discussionLabel(url: string): string {
  const subreddit = url.match(/reddit\.com\/r\/([^/?#]+)/i)?.[1];
  return subreddit ? `r/${subreddit} discussion` : 'Reddit discussion';
}

/** A summary for link previews: whole, or clipped at a word boundary with "…". */
export function clipText(text: string, max = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/**
 * Stretches a small inline control's hit area to 36px+ tall without changing
 * how it looks: an invisible ::after 6px past the top and bottom edges.
 */
export const TAP_AREA = 'relative after:absolute after:inset-x-0 after:-inset-y-1.5';

/** The anchor every story card and row carries, for the short version and `?s=`. */
export function storyAnchorId(shortId: string): string {
  return `story-${shortId}`;
}
