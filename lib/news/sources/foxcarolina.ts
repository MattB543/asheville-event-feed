/**
 * FOX Carolina (WHNS, Gray) - Greenville SC station with a western NC bureau.
 *
 * The site-wide feed is mostly Upstate SC plus national wire, but Arc's
 * per-section feed for /news/north-carolina is ~75% western NC and carries the
 * full article body. Only about a third of it is Asheville/Buncombe, so items
 * are kept when the title, dek or lede (which opens with the dateline) names
 * a Buncombe place. Gray's sister stations (WBTV, WECT, Atlanta News First)
 * also file into that section with their own dateline credit, e.g.
 * "BALD HEAD ISLAND, N.C. (WECT) - ...", and those statewide stories are
 * dropped even when they mention Asheville in passing. Arc's `size` param
 * returns ~30 items, about nine days.
 */

import * as cheerio from 'cheerio';
import { canonicalizeUrl, fetchFeed, htmlToText } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'FOX_CAROLINA';
const FEED_URL =
  'https://www.foxcarolina.com/arc/outboundfeeds/rss/category/news/north-carolina/?outputType=xml&size=30';

/** Social embeds and media players - their fallback text is not article copy. */
const EMBEDS =
  'script, style, iframe, video, figure, blockquote.instagram-media, blockquote.twitter-tweet, blockquote.tiktok-embed';

/** Station promos appended to every story. */
const BOILERPLATE = /^(MORE NEWS:?|Feel more informed, prepared, and connected with FOX Carolina)/i;

/** "ASHEVILLE, N.C. (FOX Carolina) - ..." -> "FOX Carolina". */
const DATELINE_CREDIT = /^[^()]{2,60}\(\s*([^)]+?)\s*\)\s*[-–—]/;

function cleanBody(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const $ = cheerio.load(html);
  $(EMBEDS).remove();
  $('p').each((_, p) => {
    if (BOILERPLATE.test($(p).text().trim())) $(p).remove();
  });
  return htmlToText($('body').html() ?? '');
}

async function scrape(): Promise<ScrapedArticle[]> {
  const items = await fetchFeed(FEED_URL, KEY);

  return items.flatMap((item): ScrapedArticle[] => {
    if (!item.link || !item.title || !item.publishedAt) return [];

    const title = item.title.trim();
    const summary = htmlToText(item.descriptionHtml);
    const contentText = cleanBody(item.contentHtml);
    const lede = contentText?.split('\n\n')[0] ?? '';
    const credit = lede.match(DATELINE_CREDIT)?.[1];
    if (credit && !/fox carolina/i.test(credit)) return [];
    if (!mentionsBuncombe(title, summary, lede)) return [];

    const url = canonicalizeUrl(item.link);
    return [
      {
        source: KEY,
        sourceId: item.guid || url,
        url,
        title,
        publishedAt: item.publishedAt,
        author: item.author,
        summary,
        contentText,
        imageUrl: item.imageUrl,
      },
    ];
  });
}

const foxCarolina: NewsSourceModule = {
  key: KEY,
  name: 'FOX Carolina',
  homepage: 'https://www.foxcarolina.com',
  kind: 'outlet',
  method: 'rss',
  scrape,
};

export default foxCarolina;
