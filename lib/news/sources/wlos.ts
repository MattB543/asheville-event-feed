/**
 * WLOS News 13 - Asheville's ABC affiliate (Sinclair).
 *
 * The station's "Local" RSS feed holds ~40 items, about two days' worth, so a
 * 6-hour cron never misses one. It covers all of western NC and only about
 * half is Asheville/Buncombe, so items are kept only when the title, dek or
 * URL slug names a Buncombe place - the slugs are keyword-stuffed with
 * locations ("...-swannanoa-valley-black-mountain-..."), which makes this
 * catch most of them. Stories that only say "western NC" are dropped.
 *
 * The feed has no body or byline. fetchFullText reads the article page's
 * StoryText block, which is cleaner than the JSON-LD articleBody (that one
 * flattens paragraphs and keeps HTML entities and the inline related-story
 * headlines).
 */

import * as cheerio from 'cheerio';
import { canonicalizeUrl, fetchFeed, fetchNewsText, htmlToText } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'WLOS';
const FEED_URL = 'https://wlos.com/news/local.rss';

/** Mid-article ad slots, and photo/video embeds with their captions. */
const NON_BODY = 'script, style, iframe, figure, [class*="AdUnit"], [class*="Embed_"]';

async function scrape(): Promise<ScrapedArticle[]> {
  const items = await fetchFeed(FEED_URL, KEY);

  return items.flatMap((item): ScrapedArticle[] => {
    if (!item.link || !item.title || !item.publishedAt) return [];
    const url = canonicalizeUrl(item.link);
    const title = item.title.trim();
    const summary = htmlToText(item.descriptionHtml);
    const slug = new URL(url).pathname.replace(/[-/]+/g, ' ');
    if (!mentionsBuncombe(title, summary, slug)) return [];
    return [
      {
        source: KEY,
        sourceId: item.guid || url,
        url,
        title,
        publishedAt: item.publishedAt,
        summary,
        imageUrl: item.imageUrl,
      },
    ];
  });
}

async function fetchFullText(url: string): Promise<string | undefined> {
  const $ = cheerio.load(await fetchNewsText(url, KEY));
  const body = $('[class*="StoryText_storyText"]').first();
  body.find(NON_BODY).remove();
  // Paragraphs that are nothing but an all-caps link are "related story" plugs.
  body.find('p').each((_, p) => {
    const text = $(p).text().trim();
    if (text && text === $(p).find('a').text().trim() && text === text.toUpperCase()) $(p).remove();
  });
  return htmlToText(body.html() ?? undefined);
}

const wlos: NewsSourceModule = {
  key: KEY,
  name: 'WLOS News 13',
  homepage: 'https://wlos.com',
  kind: 'outlet',
  method: 'rss',
  scrape,
  fetchFullText,
};

export default wlos;
