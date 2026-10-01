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
 *    that path is blocked (as it is from Vercel for the events API - see
 *    CLAUDE.md), we fall back to the feed alone: excerpt, byline, categories.
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
  wpImage,
  type FeedItem,
  type WpPost,
} from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { stripHtml } from '../../utils/parsers';

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

function feedToArticle(item: FeedItem): ScrapedArticle | undefined {
  if (!item.publishedAt) return undefined;
  const url = canonicalizeUrl(item.link);
  return {
    source: KEY,
    sourceId: postIdFromGuid(item.guid) ?? url,
    url,
    title: item.title,
    publishedAt: item.publishedAt,
    author: item.author,
    summary: htmlToText(item.descriptionHtml),
    categories: item.categories,
  };
}

function postToArticle(post: WpPost, bylines: Map<string, string>): ScrapedArticle {
  const id = String(post.id);
  return {
    source: KEY,
    sourceId: id,
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    author: bylines.get(id),
    summary: htmlToText(post.excerpt.rendered),
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
  async scrape() {
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

    let articles: ScrapedArticle[];
    try {
      articles = (await fetchApiPosts()).map((post) => postToArticle(post, bylines));
    } catch (error) {
      if (!feedArticles.length) throw error;
      console.warn(`[${LABEL}] REST API failed, using the feed alone: ${describeError(error)}`);
      articles = feedArticles;
    }

    return articles.filter((a) => !isExcluded(a.title, a.categories ?? []));
  },

  /** Only needed for articles that came from the feed fallback. */
  async fetchFullText(url) {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!slug) return undefined;
    const dispatcher = await createChromeDispatcher();
    try {
      const body = await fetchAsChrome(
        `${SITE}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=content`,
        JSON_ACCEPT,
        dispatcher,
        LABEL
      );
      const [post] = JSON.parse(body) as Array<Pick<WpPost, 'content'>>;
      return htmlToText(post?.content.rendered);
    } finally {
      await dispatcher.close();
    }
  },
};

export default mountainXpress;
