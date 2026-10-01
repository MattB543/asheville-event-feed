/**
 * Shared DB glue for news. Every feed read filters stories through
 * `liveStories()`: a story that isn't `live` (pending, or hidden by a takedown
 * or recompute) must never reach a page.
 */

import { createHash, randomInt } from 'crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { newsSources, newsStories, type newsArticles, type newsDays } from '@/lib/db/schema';

export type NewsSourceRow = typeof newsSources.$inferSelect;
export type NewsArticleRow = typeof newsArticles.$inferSelect;
export type NewsStoryRow = typeof newsStories.$inferSelect;
export type NewsDayRow = typeof newsDays.$inferSelect;

export type ArticleState = 'pending' | 'live' | 'skipped' | 'hidden';
export type StoryState = 'pending' | 'live' | 'hidden';
export type FulltextStatus = 'none_needed' | 'pending' | 'fetched' | 'unavailable' | 'failed';

/** WHERE clause for any story read that can reach a page: `state = 'live'` plus `conditions`. */
export function liveStories(...conditions: (SQL | undefined)[]): SQL {
  return and(eq(newsStories.state, 'live'), ...conditions)!;
}

/**
 * news_articles.input_hash: sha256 hex of what enrichment reads. Must stay in
 * step with `articleInputHashSql`, which recomputes it inside UPDATEs.
 */
export function articleInputHash(
  title: string,
  dek: string | null | undefined,
  contentText: string | null | undefined
): string {
  return createHash('sha256')
    .update(`${title}\n${dek ?? ''}\n${contentText ?? ''}`, 'utf8')
    .digest('hex');
}

/**
 * The same hash as `articleInputHash`, over SQL expressions or bound values
 * (the database is UTF-8).
 */
export function articleInputHashSql(title: unknown, dek: unknown, contentText: unknown): SQL {
  return sql`encode(sha256(convert_to((${title})::text || E'\n' || coalesce((${dek})::text, '') || E'\n' || coalesce((${contentText})::text, ''), 'UTF8')), 'hex')`;
}

const SHORT_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh news_stories.short_id: 8 random [a-z0-9]. The unique constraint catches the rare clash. */
export function newShortId(): string {
  let id = '';
  for (let i = 0; i < 8; i++) id += SHORT_ID_ALPHABET[randomInt(SHORT_ID_ALPHABET.length)];
  return id;
}

/** Lowercased domain without a leading `www.`, as news_sources.domain stores it. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

/** Domains whose takedown switch is off. */
export async function disabledDomains(): Promise<Set<string>> {
  const rows = await db
    .select({ domain: newsSources.domain })
    .from(newsSources)
    .where(eq(newsSources.enabled, false));
  return new Set(rows.map((r) => r.domain));
}
