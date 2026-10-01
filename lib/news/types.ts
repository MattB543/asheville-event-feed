/**
 * Local news ingestion - DRAFT contract shared by every module in
 * lib/news/sources/. There is no DB table yet: a source only fetches and
 * normalizes articles. Storage, dedup, clustering and AI enrichment come later.
 */

export type NewsSourceKind = 'outlet' | 'government' | 'institution' | 'community';

export type NewsFetchMethod = 'rss' | 'wp-json' | 'html' | 'api';

export interface ScrapedArticle {
  /** Module key, e.g. 'BPR'. Matches NewsSourceModule.key. */
  source: string;
  /** Stable id from the source (RSS guid, WP post id). Falls back to the URL. */
  sourceId: string;
  /** Canonical article URL, tracking params stripped. */
  url: string;
  title: string;
  publishedAt: Date;
  updatedAt?: Date;
  author?: string;
  /** Plain-text dek / RSS description. */
  summary?: string;
  /** Plain-text full body - only when the source publishes it freely. Never paywall-bypassed. */
  contentText?: string;
  imageUrl?: string;
  /** The source's own sections/tags, verbatim. */
  categories?: string[];
  /** True if the full article sits behind a paywall or metered wall. */
  paywalled?: boolean;
  /** Community sources only (Reddit etc.): a buzz signal, never a trust signal. */
  engagement?: { score?: number; comments?: number };
}

export interface NewsSourceModule {
  /** UPPER_SNAKE key, e.g. 'BPR'. */
  key: string;
  /** Display name, e.g. 'Blue Ridge Public Radio'. */
  name: string;
  homepage: string;
  kind: NewsSourceKind;
  method: NewsFetchMethod;
  /** True if the source blocks Vercel's egress or needs a browser (see MountainX in CLAUDE.md). */
  localOnly?: boolean;
  /** Cheap listing pass (feed / API). Runs every cron. */
  scrape(): Promise<ScrapedArticle[]>;
  /**
   * Full body for one article whose scrape() result had no contentText. The
   * pipeline calls this only for newly inserted articles, so scrape() stays one
   * request per source. Stored internally for AI; the UI shows summaries only.
   * Omit when the feed already carries the body or the article is paywalled.
   */
  fetchFullText?(url: string): Promise<string | undefined>;
}
