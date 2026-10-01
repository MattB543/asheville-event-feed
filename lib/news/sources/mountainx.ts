/**
 * Mountain Xpress - Asheville's independent weekly: news, opinion and features.
 * The events calendar is scraped separately (lib/scrapers/mountainx.ts) and
 * lives in a different post type, so it never appears here.
 *
 * Two requests per run:
 *  - The RSS feed (/feed/, the newest ~20 posts) over plain fetch. Cloudflare
 *    lets Node through on this path, and it is the only place bylines are
 *    public: the REST API hides users and has no byline field.
 *  - The WP REST API for full bodies, images and clean categories. Cloudflare
 *    challenges Node here, so it goes through the Chrome-TLS dispatcher. If
 *    that path is blocked, we fall back to the feed alone: excerpt, byline,
 *    categories.
 *
 * Since 2026-09-15 Cloudflare challenges every request to mountainx.com from
 * Vercel's egress, while the same code works locally (CLAUDE.md), so this is
 * localOnly like the MountainX events scraper.
 *
 * We keep News (and its subsections), Opinion, Letters and the arts / food /
 * living features, and drop:
 *  - "Smart Bets": short previews of one upcoming event each - listings, not news.
 *  - The Humor category: editorial cartoons with no text, and satire that
 *    would read as fact in a news feed.
 *
 * Xpress has no paywall. Its robots.txt disallows AI crawlers by name
 * (ClaudeBot, GPTBot, CCBot...) but not generic clients or these paths.
 */

import { createChromeDispatcher, fetchAsChrome, JSON_ACCEPT } from '../../scrapers/fetchAsChrome';
import {
  canonicalizeUrl,
  fetchFeed,
  htmlToText,
  wpCategories,
  wpDate,
  wpExcerpt,
  wpImage,
  type FeedItem,
  type WpPost,
} from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';

const KEY = 'MOUNTAIN_XPRESS';
const LABEL = 'MountainXNews';
const SITE = 'https://mountainx.com';
const FEED_URL = `${SITE}/feed/`;

/**
 * About three posts a day, so 25 reaches back roughly eight days - the same
 * window as the ~20-item feed, which is where the bylines come from.
 */
const API_URL =
  `${SITE}/wp-json/wp/v2/posts?per_page=25&_embed=wp:term,wp:featuredmedia` +
  '&_fields=id,date_gmt,modified_gmt,link,title,excerpt,content,_links,_embedded';

const EXCLUDED_CATEGORIES = new Set(['Humor']);
const EVENT_PREVIEW = 'Smart Bets';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExcluded(title: string, categories: string[]): boolean {
  return (
    title.startsWith(`${EVENT_PREVIEW}:`) ||
    categories.includes(EVENT_PREVIEW) ||
    categories.some((c) => EXCLUDED_CATEGORIES.has(c))
  );
}

/** RSS guids are `https://mountainx.com/?p=1071011`; the number is the REST post id. */
function postIdFromGuid(guid: string | undefined): string | undefined {
  return guid?.match(/[?&]p=(\d+)/)?.[1];
}

/**
 * Which path runs is Cloudflare's call, and the two render the same title and
 * dek differently: the feed's excerpt skips WordPress's typography (straight
 * quotes, "--") while the REST one has it (curly quotes, en/em dashes, primes,
 * "…"), and the REST excerpt ends "… Read more". Any difference reads as an
 * edit to the pipeline and re-runs enrichment, so both paths reduce
 * typography to plain ASCII here.
 */
function samePerPath(text: string): string {
  return text
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]|-{2,}/g, '-')
    .replace(/…/g, '...')
    .replace(/\s*\.\.\.\s*Read more$/, '...');
}

function feedToArticle(item: FeedItem): ScrapedArticle | undefined {
  if (!item.publishedAt) return undefined;
  const url = canonicalizeUrl(item.link);
  const dek = htmlToText(item.descriptionHtml);
  return {
    source: KEY,
    sourceId: postIdFromGuid(item.guid) ?? url,
    url,
    title: samePerPath(item.title),
    publishedAt: item.publishedAt,
    author: item.author,
    summary: dek && samePerPath(dek),
    categories: item.categories,
  };
}

function postToArticle(post: WpPost, bylines: Map<string, string>): ScrapedArticle {
  const id = String(post.id);
  const dek = wpExcerpt(post);
  return {
    source: KEY,
    sourceId: id,
    url: canonicalizeUrl(post.link),
    // htmlToText, not stripHtml, which turns a `&#8230;` into ".".
    title: samePerPath(htmlToText(post.title.rendered) ?? ''),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    author: bylines.get(id),
    summary: dek && samePerPath(dek),
    contentText: htmlToText(post.content.rendered),
    imageUrl: wpImage(post),
    categories: [...new Set(wpCategories(post))],
  };
}

async function fetchApiPosts(): Promise<WpPost[]> {
  const dispatcher = await createChromeDispatcher();
  try {
    return JSON.parse(await fetchAsChrome(API_URL, JSON_ACCEPT, dispatcher, LABEL)) as WpPost[];
  } finally {
    await dispatcher.close();
  }
}

const mountainXpress: NewsSourceModule = {
  key: KEY,
  name: 'Mountain Xpress',
  homepage: SITE,
  kind: 'outlet',
  method: 'wp-json',
  localOnly: true,
  async scrape({ deadline }) {
    let feedArticles: ScrapedArticle[] = [];
    try {
      feedArticles = (await fetchFeed(FEED_URL, LABEL)).flatMap(
        (item) => feedToArticle(item) ?? []
      );
    } catch (error) {
      console.warn(`[${LABEL}] Feed failed: ${describeError(error)}`);
    }
    const bylines = new Map(
      feedArticles.flatMap((a) => (a.author ? [[a.sourceId, a.author] as const] : []))
    );

    let articles: ScrapedArticle[] = feedArticles;
    if (Date.now() <= deadline) {
      try {
        articles = (await fetchApiPosts()).map((post) => postToArticle(post, bylines));
      } catch (error) {
        if (!feedArticles.length) throw error;
        console.warn(`[${LABEL}] REST API failed, using the feed alone: ${describeError(error)}`);
      }
    }

    return articles.filter((a) => !isExcluded(a.title, a.categories ?? []));
  },

  /** Only needed for articles that came from the feed fallback, which has no images either. */
  async fetchFullText(url) {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!slug) return undefined;
    const dispatcher = await createChromeDispatcher();
    try {
      const body = await fetchAsChrome(
        `${SITE}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=wp:featuredmedia&_fields=content,_links,_embedded`,
        JSON_ACCEPT,
        dispatcher,
        LABEL
      );
      const [post] = JSON.parse(body) as WpPost[];
      const text = htmlToText(post?.content.rendered);
      return text ? { text, imageUrl: wpImage(post) } : undefined;
    } finally {
      await dispatcher.close();
    }
  },
};

export default mountainXpress;
