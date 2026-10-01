/**
 * Local news ingestion - the contract shared by every module in
 * lib/news/sources/. A source only fetches and normalizes articles; storage,
 * clustering and AI enrichment live in lib/news/ (see docs/news/05-v1-plan.md).
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
  /**
   * Aggregator items only (Google News): the outlet that actually published
   * the article. Its domain is what takedown and outlet counts key on.
   */
  publisher?: { name: string; domain: string };
  /** Community link posts: the URL the post points at. */
  linkedUrl?: string;
}

export interface ScrapeContext {
  /**
   * Epoch ms. Modules that make several requests stop starting new ones once
   * Date.now() passes this and return what they have so far.
   */
  deadline: number;
}

/** A body, or a body plus the page's og:image when the feed had no image. */
export type FullText = string | { text: string; imageUrl?: string };

export interface NewsSourceModule {
  /** UPPER_SNAKE key, e.g. 'BPR'. */
  key: string;
  /** Display name, e.g. 'Blue Ridge Public Radio'. */
  name: string;
  homepage: string;
  /**
   * The outlet domain this module's items are attributed to (takedown and
   * outlet counts key on it). Defaults to the homepage's host without `www.`;
   * set it when that's wrong (a government portal on a vendor's domain).
   */
  domain?: string;
  kind: NewsSourceKind;
  method: NewsFetchMethod;
  /** True if the source blocks Vercel's egress or needs a browser (see MountainX in CLAUDE.md). */
  localOnly?: boolean;
  /** Cheap listing pass (feed / API). Runs every cron. */
  scrape(ctx: ScrapeContext): Promise<ScrapedArticle[]>;
  /**
   * Full body for one article whose scrape() result had no contentText. The
   * pipeline calls this only for newly inserted articles, so scrape() stays one
   * request per source. Stored internally for AI; the UI shows summaries only.
   * Omit when the feed already carries the body or the article is paywalled.
   * Resolve undefined when the page has no body (terminal); throw on a
   * transient failure so the pipeline retries it.
   */
  fetchFullText?(url: string): Promise<FullText | undefined>;
}
