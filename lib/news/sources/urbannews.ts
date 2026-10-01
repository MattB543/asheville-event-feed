/**
 * The Urban News - Asheville's Black-owned community newspaper (WordPress).
 *
 * The monthly print edition goes online in one batch of ~50 posts around the
 * 18th, with a few web-only posts a week in between, so we take the newest 50
 * rather than a date window. The mix is original community reporting and
 * columns plus press releases and event announcements, all free with bodies.
 * We drop the "National News" wire items; a place-name filter would not work
 * here, since half the local community items name no place at all.
 */

import {
  canonicalizeUrl,
  fetchWpPosts,
  htmlToText,
  wpAuthor,
  wpCategories,
  wpDate,
  wpExcerpt,
  wpImage,
  type WpPost,
} from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { stripHtml } from '../../utils/parsers';

const KEY = 'URBAN_NEWS';
const SITE = 'https://theurbannews.com';

/** The unsigned byline on releases and staff briefs. */
const HOUSE_BYLINE = 'Staff Reports';
const WIRE_CATEGORY = 'National News';

function toArticle(post: WpPost): ScrapedArticle {
  const author = wpAuthor(post);
  return {
    source: KEY,
    sourceId: String(post.id),
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    author: author === HOUSE_BYLINE ? undefined : author,
    summary: wpExcerpt(post),
    contentText: htmlToText(post.content.rendered),
    imageUrl: wpImage(post),
    categories: [...new Set(wpCategories(post))],
  };
}

const urbanNews: NewsSourceModule = {
  key: KEY,
  name: 'The Urban News',
  homepage: SITE,
  kind: 'outlet',
  method: 'wp-json',
  async scrape() {
    const posts = await fetchWpPosts(SITE, 'UrbanNews', { per_page: '50' });
    return posts.map(toArticle).filter((a) => !a.categories?.includes(WIRE_CATEGORY));
  },
};

export default urbanNews;
