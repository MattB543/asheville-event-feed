/**
 * Town of Weaverville - posts from weavervillenc.org (WordPress REST).
 *
 * About two posts a week: public hearing notices (zoning map and text
 * amendments), Helene recovery projects (Eller Cove watershed), public input
 * calls, town events, plus the town's severe-weather briefings and meeting
 * cancellations. Categories say which is which ("Public Hearing", "Helene
 * Recovery", "Town Council"); some category names bundle several labels with
 * "|", so they are split.
 */

import type { NewsSourceModule, ScrapedArticle } from '../types';
import {
  canonicalizeUrl,
  fetchWpPosts,
  htmlToText,
  wpCategories,
  wpDate,
  wpExcerpt,
  wpImage,
  type WpPost,
} from '../feeds';
import { stripHtml } from '../../utils/parsers';

const SITE = 'https://weavervillenc.org';
const LABEL = 'WeavervilleTown';
const SOURCE = 'TOWN_OF_WEAVERVILLE';
const PER_PAGE = '20';

/** On nearly every post, so they carry no information. */
const GENERIC_TERMS = new Set(['News', 'Town News', 'Uncategorized']);

function categories(post: WpPost): string[] {
  const names = wpCategories(post).flatMap((name) => name.split('|').map((n) => n.trim()));
  return [...new Set(names)].filter((n) => n && !GENERIC_TERMS.has(n));
}

function toArticle(post: WpPost): ScrapedArticle {
  return {
    source: SOURCE,
    sourceId: String(post.id),
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered).trim(),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    summary: wpExcerpt(post),
    contentText: htmlToText(post.content.rendered),
    imageUrl: wpImage(post),
    categories: categories(post),
  };
}

const weavervilleTown: NewsSourceModule = {
  key: SOURCE,
  name: 'Town of Weaverville',
  homepage: SITE,
  kind: 'government',
  method: 'wp-json',
  async scrape() {
    return (await fetchWpPosts(SITE, LABEL, { per_page: PER_PAGE })).map(toArticle);
  },
};

export default weavervilleTown;
