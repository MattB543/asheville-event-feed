/**
 * Town of Montreat - posts from townofmontreat.org (WordPress REST).
 *
 * About three posts a week in three kinds, told apart by category:
 *  - "Montreat Minute": the town's weekly newsletter (council meeting
 *    previews, ordinance changes, road and water work) - a digest, long.
 *  - "Mayor's Summary": the mayor's recap after each council meeting.
 *  - "Notice": board meeting notices, hydrant flushing, road closures.
 *
 * The site sits on Automattic's CDN, which 403s the stale Chrome/120 UA;
 * fetchWpPosts sends NEWS_USER_AGENT, which passes. Bylines are staff first
 * names, so author is left empty.
 */

import type { NewsSourceModule, ScrapedArticle } from '../types';
import {
  canonicalizeUrl,
  fetchWpPosts,
  htmlToText,
  wpCategories,
  wpDate,
  wpImage,
  type WpPost,
} from '../feeds';
import { stripHtml } from '../../utils/parsers';

const SITE = 'https://www.townofmontreat.org';
const LABEL = 'MontreatTown';
const SOURCE = 'TOWN_OF_MONTREAT';
const PER_PAGE = '20';

function toArticle(post: WpPost): ScrapedArticle {
  return {
    source: SOURCE,
    sourceId: String(post.id),
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered).replace(/\s+/g, ' ').trim(),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    summary: htmlToText(post.excerpt.rendered),
    contentText: htmlToText(post.content.rendered),
    imageUrl: wpImage(post),
    categories: wpCategories(post).filter((c) => c !== 'Uncategorized'),
  };
}

const montreatTown: NewsSourceModule = {
  key: SOURCE,
  name: 'Town of Montreat',
  homepage: SITE,
  kind: 'government',
  method: 'wp-json',
  async scrape() {
    return (await fetchWpPosts(SITE, LABEL, { per_page: PER_PAGE })).map(toArticle);
  },
};

export default montreatTown;
