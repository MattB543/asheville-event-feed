/**
 * WordPress REST for newsrooms hosted by Automattic (Newspack / WordPress VIP):
 * Asheville Watchdog and Carolina Public Press.
 *
 * Automattic's CDN refuses stale Chrome user agents; fetchWpPosts already sends
 * NEWS_USER_AGENT, which it accepts. Two things still differ from the generic
 * wp* helpers in ../../feeds.ts:
 *  - Bylines come from Co-Authors Plus, so `_embedded.author` is a 401 and the
 *    names live in the Parse.ly / Yoast metadata instead.
 *  - Co-Authors Plus also puts each byline in an `author` taxonomy, which
 *    wpCategories() would report as a category.
 *
 * This lives in a subdirectory so the test runner's `--all` does not load it as
 * a source.
 */

import { canonicalizeUrl, fetchWpPosts, htmlToText, wpDate, type WpPost } from '../../feeds';
import type { ScrapedArticle } from '../../types';
import { stripHtml } from '../../../utils/parsers';

export interface NewspackPost extends WpPost {
  jetpack_featured_media_url?: string;
  yoast_head_json?: { author?: string };
  parsely?: { meta?: { author?: Array<{ name?: string }> } };
}

/** Everything newspackToArticle() reads. Nested `_fields` keeps a 20-post page near 1 MB. */
const FIELDS = [
  'id',
  'date_gmt',
  'modified_gmt',
  'link',
  'title',
  'excerpt',
  'content',
  'jetpack_featured_media_url',
  'yoast_head_json.author',
  'parsely.meta.author',
  '_links',
  '_embedded',
].join(',');

export async function fetchNewspackPosts(
  siteUrl: string,
  context: string,
  params: Record<string, string> = {}
): Promise<NewspackPost[]> {
  return fetchWpPosts(siteUrl, context, {
    per_page: '20',
    _embed: 'wp:term',
    _fields: FIELDS,
    ...params,
  });
}

export function newspackAuthor(post: NewspackPost): string | undefined {
  const names = (post.parsely?.meta?.author ?? []).map((a) => a.name?.trim()).filter(Boolean);
  if (names.length) return names.join(' and ');
  return post.yoast_head_json?.author?.trim() || undefined;
}

/** Categories and tags, verbatim, without the Co-Authors Plus byline terms. */
export function newspackTerms(post: NewspackPost): string[] {
  const names = (post._embedded?.['wp:term'] ?? [])
    .flat()
    .filter((t) => t.taxonomy === 'category' || t.taxonomy === 'post_tag')
    .map((t) => stripHtml(t.name ?? ''))
    .filter(Boolean);
  return [...new Set(names)];
}

/**
 * WordPress ends an auto-generated excerpt with `[&hellip;]`, which
 * decodeHtmlEntities turns into "[.]".
 */
export function cleanExcerpt(text: string | undefined): string | undefined {
  return text?.replace(/\s*\[\.\]$/, '…');
}

export function newspackToArticle(
  source: string,
  post: NewspackPost,
  cleanBody: (text: string | undefined) => string | undefined = (t) => t
): ScrapedArticle {
  return {
    source,
    sourceId: String(post.id),
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    author: newspackAuthor(post),
    summary: cleanExcerpt(htmlToText(post.excerpt.rendered)),
    contentText: cleanBody(htmlToText(post.content.rendered)),
    imageUrl: post.jetpack_featured_media_url || undefined,
    categories: newspackTerms(post),
  };
}
