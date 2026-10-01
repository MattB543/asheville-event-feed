/**
 * Town of Biltmore Forest - news from biltmoreforest.org (Drupal, no feed).
 *
 * The /latest-news view is server-rendered: each row links to /news/<slug>
 * with a <time datetime> and a teaser that is often the whole notice. Roughly
 * one post a week - election and polling info, tax bill timing, town hall
 * hours and closures, Reforest speaker series - so most of it is notices.
 */

import * as cheerio from 'cheerio';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { canonicalizeUrl, fetchNewsText, htmlToText } from '../feeds';

const SITE = 'https://www.biltmoreforest.org';
const NEWS_PAGE = `${SITE}/latest-news`;
const LABEL = 'BiltmoreForestTown';
const SOURCE = 'TOWN_OF_BILTMORE_FOREST';

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseNewsList(html: string): ScrapedArticle[] {
  const $ = cheerio.load(html);
  const articles: ScrapedArticle[] = [];
  for (const el of $('a.news-item[href^="/news/"]').toArray()) {
    const $el = $(el);
    const href = $el.attr('href');
    const publishedAt = new Date($el.find('time[datetime]').first().attr('datetime') ?? '');
    const title = clean($el.find('.news-item__title').text());
    if (!href || !title || isNaN(publishedAt.getTime())) continue;
    const url = canonicalizeUrl(new URL(href, SITE).toString());
    const teaser = clean($el.find('.news-item__body').text());
    articles.push({
      source: SOURCE,
      sourceId: new URL(url).pathname,
      url,
      title,
      publishedAt,
      summary: teaser || undefined,
    });
  }
  return articles;
}

const biltmoreForestTown: NewsSourceModule = {
  key: SOURCE,
  name: 'Town of Biltmore Forest',
  homepage: NEWS_PAGE,
  kind: 'government',
  method: 'html',
  async scrape() {
    return parseNewsList(await fetchNewsText(NEWS_PAGE, LABEL));
  },
  async fetchFullText(url) {
    const $ = cheerio.load(await fetchNewsText(url, LABEL));
    return htmlToText($('article.node--type-news .field--name-body').first().html() ?? undefined);
  },
};

export default biltmoreForestTown;
