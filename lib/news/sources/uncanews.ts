/**
 * UNC Asheville press releases ("In the News" at unca.edu/in-the-news/).
 *
 * The releases live in a custom `article` post type, not regular posts, so we
 * hit /wp-json/wp/v2/article directly (fetchWpPosts only reads /posts).
 * Roughly 1-2 a week: grants, appointments, trustees and campus development,
 * plus some rankings and awards. unca.edu's regular /posts endpoint holds a
 * single "Hello world!", and stories.unca.edu is alumni features only.
 *
 * Each body opens with a hero block that repeats the title and breadcrumbs,
 * and closes with an "About UNC Asheville" boilerplate paragraph; both are cut.
 */

import * as cheerio from 'cheerio';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { canonicalizeUrl, fetchNewsText, htmlToText, wpDate, wpImage, type WpPost } from '../feeds';
import { stripHtml } from '../../utils/parsers';

const SITE = 'https://www.unca.edu';
const LABEL = 'UncaNews';
const SOURCE = 'UNCA_NEWS';
const PER_PAGE = '20';

function bodyText(html: string): string | undefined {
  const $ = cheerio.load(html, null, false);
  $('.Hero, .Breadcrumbs, style, script').remove();
  const text = htmlToText($.html());
  return text?.split(/\n\nAbout UNC Asheville\n\n/)[0].trim() || undefined;
}

function toArticle(post: WpPost): ScrapedArticle {
  return {
    source: SOURCE,
    sourceId: String(post.id),
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered).trim(),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    summary: htmlToText(post.excerpt.rendered),
    contentText: bodyText(post.content.rendered),
    imageUrl: wpImage(post),
  };
}

const uncaNews: NewsSourceModule = {
  key: SOURCE,
  name: 'UNC Asheville',
  homepage: `${SITE}/in-the-news/`,
  kind: 'institution',
  method: 'wp-json',
  async scrape() {
    const query = new URLSearchParams({ per_page: PER_PAGE, _embed: '1' });
    const body = await fetchNewsText(`${SITE}/wp-json/wp/v2/article?${query}`, LABEL, {
      Accept: 'application/json',
    });
    return (JSON.parse(body) as WpPost[]).map(toArticle);
  },
};

export default uncaNews;
