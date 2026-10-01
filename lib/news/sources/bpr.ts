/**
 * Blue Ridge Public Radio - Asheville's NPR member station (Grove CMS).
 *
 * The homepage feed (/index.rss) is empty, and the "Regional & State News"
 * feed is the statewide public-radio pool (WFAE, WUNC...), so we read BPR's
 * own newsroom from its section feeds instead. Each holds the newest 10 items
 * and a story often sits in several sections, so they are merged by URL.
 * Only the "Local News" feed carries the body; fetchFullText reads the rest
 * from the article page, which is free and allowed by robots.txt.
 *
 * Not filtered to Buncombe: this is the Asheville newsroom, and what isn't
 * about Asheville itself is regional politics and Helene recovery that is.
 */

import * as cheerio from 'cheerio';
import { canonicalizeUrl, fetchFeed, fetchNewsText, htmlToText, type FeedItem } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';

const KEY = 'BPR';
const BASE_URL = 'https://www.bpr.org';

/** Section feed slug -> the section's own title. */
const SECTIONS: Record<string, string> = {
  'bpr-news': 'Local News',
  'politics-government': 'Politics & Government',
  'climate-environment': 'Climate & Environment',
  'growth-development': 'Growth & Development',
  'helene-recovery': 'Helene Recovery',
  health: 'Health',
  education: 'Education',
  'arts-performance': 'Arts & Culture',
};

/**
 * The quieter section feeds reach back months; BPR files ~5-8 local stories a
 * week, so two weeks is plenty for a first run and harmless after that.
 */
const MAX_AGE_DAYS = 14;
const REQUEST_DELAY_MS = 1000;

/** Photos with captions, and the related-story cards Grove drops mid-article. */
const NON_BODY = 'figure, script, style, iframe, .Enh';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cleanBody(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(html);
  $(NON_BODY).remove();
  return htmlToText($('body').html() ?? '');
}

async function scrape(): Promise<ScrapedArticle[]> {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const byUrl = new Map<string, { item: FeedItem; publishedAt: Date; categories: string[] }>();
  let feedsRead = 0;

  for (const [slug, label] of Object.entries(SECTIONS)) {
    let items: FeedItem[] = [];
    try {
      items = await fetchFeed(`${BASE_URL}/${slug}.rss`, KEY);
      feedsRead++;
    } catch {
      // One dead section feed shouldn't sink the rest; fetchEventData logged it.
    }
    for (const item of items) {
      const publishedAt = item.publishedAt;
      if (!item.link || !item.title || !publishedAt || publishedAt.getTime() < cutoff) continue;
      const url = canonicalizeUrl(item.link);
      const seen = byUrl.get(url);
      if (seen) {
        seen.categories.push(label);
        if (!seen.item.contentHtml && item.contentHtml) seen.item = item;
      } else {
        byUrl.set(url, { item, publishedAt, categories: [label] });
      }
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (feedsRead === 0) throw new Error('Every BPR section feed failed');

  return [...byUrl]
    .map(
      ([url, { item, publishedAt, categories }]): ScrapedArticle => ({
        source: KEY,
        sourceId: item.guid || url,
        url,
        title: item.title.trim(),
        publishedAt,
        author: item.author,
        summary: htmlToText(item.descriptionHtml),
        contentText: cleanBody(item.contentHtml),
        imageUrl: item.imageUrl,
        categories,
      })
    )
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

async function fetchFullText(url: string): Promise<string | undefined> {
  const $ = cheerio.load(await fetchNewsText(url, KEY));
  return cleanBody($('.ArtP-articleBody').first().html() ?? undefined);
}

const bpr: NewsSourceModule = {
  key: KEY,
  name: 'Blue Ridge Public Radio',
  homepage: BASE_URL,
  kind: 'outlet',
  method: 'rss',
  scrape,
  fetchFullText,
};

export default bpr;
