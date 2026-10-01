/**
 * City of Asheville - news and press releases from ashevillenc.gov.
 *
 * The city site is WordPress with an open REST API. Posts carry two useful
 * taxonomies: `category` (Press Releases, City Council, Helene, Events...) and
 * `avl_department` (Police, Fire, Water, Transit...), so Asheville Police,
 * Fire and Water Resources news arrives here too - none of them publish a
 * separate feed. Full bodies are public record.
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

const SITE = 'https://www.ashevillenc.gov';
const LABEL = 'CityOfAsheville';
const PER_PAGE = '30';

/** Terms on nearly every post, so they carry no information. */
const GENERIC_TERMS = new Set(['News', 'Featured']);

function toArticle(post: WpPost): ScrapedArticle {
  return {
    source: 'CITY_OF_ASHEVILLE',
    sourceId: String(post.id),
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered).trim(),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    summary: wpExcerpt(post),
    contentText: htmlToText(post.content.rendered),
    imageUrl: wpImage(post),
    categories: [...new Set(wpCategories(post))].filter((c) => !GENERIC_TERMS.has(c)),
  };
}

const cityOfAsheville: NewsSourceModule = {
  key: 'CITY_OF_ASHEVILLE',
  name: 'City of Asheville',
  homepage: `${SITE}/news/`,
  kind: 'government',
  method: 'wp-json',
  async scrape() {
    const posts = await fetchWpPosts(SITE, LABEL, { per_page: PER_PAGE });
    return posts.map(toArticle);
  },
};

export default cityOfAsheville;
