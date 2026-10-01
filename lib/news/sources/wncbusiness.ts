/**
 * WNC Business - regional business news site (Locable platform) covering
 * openings, expansions, appointments, awards and economic-development news
 * across Western NC.
 *
 * Nearly everything is a lightly edited press release ending in a
 * "Source: <organization>" line, which we keep as provenance. The site-wide
 * RSS feed carries the full body but only the newest 10 items (about four
 * days); there is no paging, so it relies on the cron running every few hours.
 * Items that name no Buncombe place anywhere (the High Country, statewide
 * tourism) are dropped - typically two in ten.
 */

import { canonicalizeUrl, fetchFeed, htmlToText, type FeedItem } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'WNC_BUSINESS';
const SITE = 'https://www.wncbusiness.com';
const FEED_URL = `${SITE}/?format=rss`;

/** Every item is filed under "Today", and every author is the site itself. */
const GENERIC_CATEGORIES = new Set(['Today']);
const HOUSE_BYLINE = 'WNC Business';

const FEED_FOOTER = /\s*Original article published at WNC Business\s*$/;

/** Links are /2026/09/24/584882/slug; the number is the post id. */
function postId(url: string): string {
  return url.match(/\/\d{4}\/\d{2}\/\d{2}\/(\d+)\//)?.[1] ?? url;
}

function toArticle(item: FeedItem): ScrapedArticle | undefined {
  if (!item.publishedAt) return undefined;
  // The feed links over http; the site 301s to https.
  const url = canonicalizeUrl(item.link.replace(/^http:/, 'https:'));
  const body = htmlToText(item.descriptionHtml)?.replace(FEED_FOOTER, '');
  return {
    source: KEY,
    sourceId: postId(url),
    url,
    title: item.title,
    publishedAt: item.publishedAt,
    author: item.author === HOUSE_BYLINE ? undefined : item.author,
    summary: body?.split('\n\n')[0],
    contentText: body || undefined,
    imageUrl: item.imageUrl,
    categories: item.categories.map((c) => c.trim()).filter((c) => c && !GENERIC_CATEGORIES.has(c)),
  };
}

const wncBusiness: NewsSourceModule = {
  key: KEY,
  name: 'WNC Business',
  homepage: SITE,
  kind: 'outlet',
  method: 'rss',
  async scrape() {
    const items = await fetchFeed(FEED_URL, 'WncBusiness');
    return items
      .flatMap((item) => toArticle(item) ?? [])
      .filter((a) => mentionsBuncombe(a.title, a.url, a.contentText));
  },
};

export default wncBusiness;
