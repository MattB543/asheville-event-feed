/**
 * Shared fetch/parse helpers for news sources: RSS 2.0 / Atom feeds and the
 * WordPress REST API (most local outlets run WordPress).
 */

import * as cheerio from 'cheerio';
import { fetchEventData } from '../scrapers/base';
import { stripHtml } from '../utils/parsers';
import type { RetryOptions } from '../utils/retry';

export interface FeedItem {
  guid?: string;
  link: string;
  title: string;
  publishedAt?: Date;
  updatedAt?: Date;
  author?: string;
  descriptionHtml?: string;
  /** content:encoded (RSS) or <content> (Atom). */
  contentHtml?: string;
  categories: string[];
  /** media:content / media:thumbnail / image enclosure. */
  imageUrl?: string;
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8';

/**
 * Matt's own desktop Chrome (153; Chrome's reduced UA reports 153.0.0.0), so
 * news fetches look like an ordinary reader (decision S22). It also has to stay
 * current: Automattic's CDN (WordPress VIP / Newspack - Asheville Watchdog,
 * Carolina Public Press, ...) 403s the stale Chrome/120 UA in
 * DEFAULT_USER_AGENT regardless of TLS fingerprint. Kept separate from
 * lib/scrapers/base.ts so event scrapers are untouched.
 */
export const NEWS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

/** GET a page as text with the news UA; `headers` override the defaults. */
export async function fetchNewsText(
  url: string,
  context: string,
  headers: Record<string, string> = {},
  retry?: RetryOptions
): Promise<string> {
  const res = await fetchEventData(
    url,
    { headers: { 'User-Agent': NEWS_USER_AGENT, ...headers } },
    retry,
    context
  );
  return res.text();
}

export async function fetchFeed(
  url: string,
  context: string,
  headers: Record<string, string> = {}
): Promise<FeedItem[]> {
  return parseFeed(await fetchNewsText(url, context, { Accept: FEED_ACCEPT, ...headers }));
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value.trim());
  return isNaN(date.getTime()) ? undefined : date;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseFeed(xml: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });

  const rssItems = $('item');
  if (rssItems.length > 0) {
    return rssItems.toArray().map((el) => {
      const $el = $(el);
      const enclosure = $el
        .find('enclosure')
        .filter((_, e) => /^image\//.test($(e).attr('type') ?? ''));
      return {
        guid: text($el.children('guid').text()),
        link: $el.children('link').text().trim(),
        title: stripHtml($el.children('title').text()),
        publishedAt: parseDate($el.children('pubDate').text() || $el.children('dc\\:date').text()),
        author: text($el.children('dc\\:creator').text() || $el.children('author').text()),
        descriptionHtml: text($el.children('description').text()),
        contentHtml: text($el.children('content\\:encoded').text()),
        categories: $el
          .children('category')
          .toArray()
          .map((c) => $(c).text().trim())
          .filter(Boolean),
        imageUrl:
          $el
            .find('media\\:content[medium="image"], media\\:content[type^="image"]')
            .first()
            .attr('url') ||
          $el.find('media\\:thumbnail').first().attr('url') ||
          enclosure.first().attr('url') ||
          undefined,
      };
    });
  }

  return $('entry')
    .toArray()
    .map((el) => {
      const $el = $(el);
      const link =
        $el.children('link[rel="alternate"]').attr('href') ||
        $el.children('link').first().attr('href') ||
        '';
      return {
        guid: text($el.children('id').text()),
        link,
        title: stripHtml($el.children('title').text()),
        publishedAt: parseDate($el.children('published').text() || $el.children('updated').text()),
        updatedAt: parseDate($el.children('updated').text()),
        author: text($el.find('author > name').first().text()),
        descriptionHtml: text($el.children('summary').text()),
        contentHtml: text($el.children('content').text()),
        categories: $el
          .children('category')
          .toArray()
          .map((c) => $(c).attr('term') ?? '')
          .filter(Boolean),
        imageUrl: $el.find('media\\:thumbnail, media\\:content').first().attr('url') || undefined,
      };
    });
}

export interface WpPost {
  id: number;
  date_gmt: string;
  modified_gmt: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string; protected?: boolean };
  _embedded?: {
    author?: Array<{ name?: string }>;
    'wp:featuredmedia'?: Array<{ source_url?: string }>;
    'wp:term'?: Array<Array<{ name?: string; taxonomy?: string }>>;
  };
}

/**
 * Fetch recent posts from a WordPress site's REST API with authors, featured
 * images and terms embedded. `siteUrl` is the site root (no trailing /wp-json).
 */
export async function fetchWpPosts(
  siteUrl: string,
  context: string,
  params: Record<string, string> = {},
  headers: Record<string, string> = {}
): Promise<WpPost[]> {
  const query = new URLSearchParams({ per_page: '50', _embed: '1', ...params });
  const url = `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts?${query}`;
  return JSON.parse(
    await fetchNewsText(url, context, { Accept: 'application/json', ...headers })
  ) as WpPost[];
}

/** WP `date_gmt` has no zone suffix; it is UTC. */
export function wpDate(value: string): Date {
  return new Date(value.endsWith('Z') ? value : `${value}Z`);
}

export function wpAuthor(post: WpPost): string | undefined {
  return text(post._embedded?.author?.[0]?.name);
}

export function wpImage(post: WpPost): string | undefined {
  return post._embedded?.['wp:featuredmedia']?.[0]?.source_url || undefined;
}

export function wpCategories(post: WpPost): string[] {
  return (post._embedded?.['wp:term'] ?? [])
    .flat()
    .map((t) => stripHtml(t.name ?? ''))
    .filter(Boolean);
}

/**
 * WordPress ends an auto-generated excerpt with `[&hellip;]`, which
 * decodeHtmlEntities turns into "[.]".
 */
export function wpExcerpt(post: WpPost): string | undefined {
  return htmlToText(post.excerpt.rendered)?.replace(/\s*\[\.\]$/, '…');
}

/**
 * Inline markup. stripHtml turns every tag into a space, which leaves
 * "<a>snapshots</a>." as "snapshots ." and "Oct. 1<sup>st</sup>" as "1 st",
 * so these are dropped outright first.
 */
const INLINE_TAGS =
  /<\/?(?:a|abbr|b|cite|code|em|font|i|mark|q|s|small|span|strong|sub|sup|u)\b[^>]*>/gi;

/**
 * Numeric entities (`&#8230;`, `&#x2019;`, `&#8243;`) as their characters:
 * decodeHtmlEntities knows only a few and turns an ellipsis into ".". The
 * markup characters & < > are left for stripHtml.
 */
function decodeNumericEntities(html: string): string {
  return html.replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
    const point = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
    const markup = point === 38 || point === 60 || point === 62;
    return point >= 32 && point <= 0x10ffff && !markup ? String.fromCodePoint(point) : entity;
  });
}

/** HTML fragment -> plain text with paragraph breaks kept. */
export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const withBreaks = decodeNumericEntities(html.replace(INLINE_TAGS, '')).replace(
    /<\/(p|div|h[1-6]|li|blockquote)>|<br\s*\/?>/gi,
    '\n\n'
  );
  const out = withBreaks
    .split(/\n{2,}/)
    .map((para) => stripHtml(para))
    .filter(Boolean)
    .join('\n\n');
  return out || undefined;
}

/** An article page's og:image (or twitter:image), resolved against the page URL. */
export function ogImage($: cheerio.CheerioAPI, pageUrl: string): string | undefined {
  const src =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content');
  if (!src?.trim()) return undefined;
  try {
    return new URL(src.trim(), pageUrl).toString();
  } catch {
    return undefined;
  }
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|cmpid$)/i;

/** Drop tracking params and the fragment so the same story always has one URL. */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
