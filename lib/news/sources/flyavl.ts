/**
 * Asheville Regional Airport (AVL) news - flyavl.com.
 *
 * Drupal with no feed; the news page is a server-rendered view of title +
 * <time datetime> rows, and each article page holds the body in the node's
 * `field--name-field-article-body`. Two or three posts a month: new routes,
 * parking and terminal-construction changes (the AVL Forward project), plus
 * seasonal travel-tip posts that the AI pass should drop.
 */

import * as cheerio from 'cheerio';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { canonicalizeUrl, fetchNewsText, htmlToText } from '../feeds';

const SITE = 'https://flyavl.com';
const NEWS_PAGE = `${SITE}/news-statistics-0/news`;
const LABEL = 'FlyAVL';
const SOURCE = 'ASHEVILLE_AIRPORT';

function parseNewsList(html: string): ScrapedArticle[] {
  const $ = cheerio.load(html);
  const articles: ScrapedArticle[] = [];
  for (const row of $('.view-blog .views-row').toArray()) {
    const $row = $(row);
    const link = $row.find('.views-field-field-article-teaser-title a').first();
    const href = link.attr('href');
    const published = new Date($row.find('time[datetime]').first().attr('datetime') ?? '');
    if (!href || isNaN(published.getTime())) continue;
    const url = canonicalizeUrl(new URL(href, SITE).toString());
    const teaser = $row
      .find('.views-field-field-article-teaser-body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    articles.push({
      source: SOURCE,
      sourceId: new URL(url).pathname,
      url,
      title: link.text().replace(/\s+/g, ' ').trim(),
      publishedAt: published,
      summary: teaser || undefined,
    });
  }
  return articles;
}

const flyAvl: NewsSourceModule = {
  key: SOURCE,
  name: 'Asheville Regional Airport',
  homepage: NEWS_PAGE,
  kind: 'institution',
  method: 'html',
  async scrape() {
    return parseNewsList(await fetchNewsText(NEWS_PAGE, LABEL));
  },
  /** The page has no og:image, so the body's first picture (a route map, a terminal render) stands in. */
  async fetchFullText(url) {
    const $ = cheerio.load(await fetchNewsText(url, LABEL));
    const body = $('.node--type-article .field--name-field-article-body').first();
    const text = htmlToText(body.html() ?? undefined);
    const src = body.find('img[src]').first().attr('src');
    return text ? { text, imageUrl: src ? new URL(src, SITE).toString() : undefined } : undefined;
  },
};

export default flyAvl;
