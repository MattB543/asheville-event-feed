/**
 * The daily "short version" (docs/news/05-v1-plan.md §6.4): one neutral
 * sentence per Top story, in rank order, written from our own headlines and
 * summaries only.
 */

import { createHash } from 'crypto';
import { parseJsonFromModel } from '@/lib/ai/provider-clients';
import type { NewsModelCaller, NewsModelUsage } from './call';

export const DAILY_MAX_WORDS = 28;

export interface DailyTopStory {
  shortId: string;
  headline: string;
  summary: string;
}

export interface DailySentence {
  /** The story's short_id. */
  storyId: string;
  text: string;
}

export type DailyOutcome =
  | { status: 'ok'; sentences: DailySentence[]; usage: NewsModelUsage }
  | { status: 'failed'; error: string; usage: NewsModelUsage };

/** news_days.input_hash: the ordered Top stories' short ids, headlines and summaries. */
export function dailyInputHash(stories: DailyTopStory[]): string {
  return createHash('sha256')
    .update(JSON.stringify(stories.map((s) => [s.shortId, s.headline, s.summary])), 'utf8')
    .digest('hex');
}

export const DAILY_SYSTEM = `You write "the short version" at the top of a day on AVL GO's Asheville news page: one sentence per
top story, so a reader gets the day in a few seconds.

Rules:
- Exactly one sentence per story, in the order given, each at most ${DAILY_MAX_WORDS} words.
- Use ONLY the headline and summary given for that story. Never add facts, names or numbers.
- Neutral and plain: no quotes or quotation marks, no opinion, no "In other news", no
  exclamation marks. Keep attribution for claims, allegations and estimates ("police say"), but
  drop "X reports" from plain facts.
- Each sentence must stand on its own; don't refer to the other stories.

Return JSON only: {"sentences": [{"storyId": "<id as given>", "text": "..."}]}`;

export function buildDailyPrompt(stories: DailyTopStory[]): string {
  return stories
    .map((s, i) => `${i + 1}. id: ${s.shortId}\nHeadline: ${s.headline}\nSummary: ${s.summary}`)
    .join('\n\n');
}

export async function summarizeDay(
  stories: DailyTopStory[],
  call: NewsModelCaller
): Promise<DailyOutcome> {
  const response = await call(DAILY_SYSTEM, buildDailyPrompt(stories));
  if (!response.ok) return { status: 'failed', error: response.error, usage: response.usage };

  const json = parseJsonFromModel<{ sentences?: unknown }>(response.content, 'object');
  const byId = new Map<string, string>();
  const list: unknown[] = json && Array.isArray(json.sentences) ? json.sentences : [];
  for (const item of list) {
    const { storyId, text } = (item ?? {}) as { storyId?: unknown; text?: unknown };
    if (typeof storyId === 'string' && typeof text === 'string') {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean) byId.set(storyId.trim(), clean);
    }
  }
  const sentences = stories.map((s) => ({ storyId: s.shortId, text: byId.get(s.shortId) ?? '' }));
  const missing = sentences.filter((s) => !s.text).map((s) => s.storyId);
  if (missing.length > 0) {
    return {
      status: 'failed',
      error: `No sentence for ${missing.join(', ')}`,
      usage: response.usage,
    };
  }
  return { status: 'ok', sentences, usage: response.usage };
}
