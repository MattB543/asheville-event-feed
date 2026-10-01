/**
 * The Blue Banner - UNC Asheville's student newspaper (WordPress).
 *
 * Student journalism: campus news (student government, budget and department
 * cuts, construction), UNCA sports and community features, published about
 * twice a day Monday-Thursday during the semester (30-60 posts a month) and
 * nearly silent from May through mid-August and over winter break.
 *
 * The RSS feed carries the full body. We drop the Lifestyle section (album
 * breakdowns, game reviews, reading lists) and Narrative (personal essays),
 * which are not news, and anything that names no Buncombe place. The feed has
 * no images; the REST API does, but robots.txt disallows query-string URLs and
 * the feed already has everything else.
 */

import { canonicalizeUrl, fetchFeed, htmlToText, type FeedItem } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'BLUE_BANNER';
const SITE = 'https://thebluebanner.net';

const NOT_NEWS = new Set(['Lifestyle', 'Narrative']);

/** dc:creator is "Colin Rivenbark, Staff Writer, crivenba@unca.edu". */
function byline(creator: string | undefined): string | undefined {
  return creator?.split(',')[0]?.trim() || undefined;
}

/** guid is https://thebluebanner.net/?p=21236. */
function postId(item: FeedItem, url: string): string {
  return item.guid?.match(/[?&]p=(\d+)/)?.[1] ?? url;
}

function toArticle(item: FeedItem): ScrapedArticle | undefined {
  if (!item.publishedAt) return undefined;
  const url = canonicalizeUrl(item.link);
  return {
    source: KEY,
    sourceId: postId(item, url),
    url,
    title: item.title,
    publishedAt: item.publishedAt,
    author: byline(item.author),
    summary: htmlToText(item.descriptionHtml)?.replace(/\s*\.\.\.$/, '…'),
    contentText: htmlToText(item.contentHtml),
    categories: item.categories,
  };
}

const blueBanner: NewsSourceModule = {
  key: KEY,
  name: 'The Blue Banner (UNC Asheville)',
  homepage: SITE,
  kind: 'outlet',
  method: 'rss',
  async scrape() {
    const items = await fetchFeed(`${SITE}/feed/`, 'BlueBanner');
    return items
      .flatMap((item) => toArticle(item) ?? [])
      .filter((a) => !a.categories?.some((c) => NOT_NEWS.has(c)))
      .filter((a) => mentionsBuncombe(a.title, a.summary, a.url, a.contentText));
  },
};

export default blueBanner;
