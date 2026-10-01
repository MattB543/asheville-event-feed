/**
 * The Beacon Tribune - weekly community paper for Buncombe County (formerly the
 * Tribune Papers of Weaverville/North Buncombe; tribpapers.com now redirects to
 * biltmorebeacon.com). TownNews BLOX.
 *
 * About a dozen news items a week, all dated the Wednesday the issue comes out.
 * Roughly half are its own reporting (Weaverville, Woodfin, North Buncombe,
 * sheriff and court briefs); the rest are reprints from Asheville Watchdog,
 * Carolina Public Press, BPR and NC Newsline, credited in the byline.
 *
 * Listing: BLOX's search RSS for the news section (~4 weeks, with bylines).
 * TownNews throttles every `?f=rss` request per client IP - after a handful of
 * them it answers 429 for a long while, even hours apart - while the HTML
 * section front /news/ keeps answering. So when the feed fails we read the
 * section front instead: the same stories (the latest two issues), minus the
 * bylines. Both carry only a one-line dek, so fetchFullText reads the article
 * page. The Beacon has no active access rules (`subscription.required=false`,
 * `isAccessibleForFree=true`), so the body is what any visitor sees; we still
 * return nothing if a page is ever marked not free.
 */

import * as cheerio from 'cheerio';
import {
  canonicalizeUrl,
  fetchFeed,
  fetchNewsText,
  htmlToText,
  ogImage,
  type FeedItem,
} from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';

const KEY = 'BEACON_TRIBUNE';
const LABEL = 'BeaconTribune';
const SITE = 'https://www.biltmorebeacon.com';
const FEED_URL = `${SITE}/search/?f=rss&t=article&l=50&s=start_time&sd=desc&c=news*`;

/** Outlets whose stories the Beacon reprints; BLOX runs them into the byline. */
const PARTNERS = ['Asheville Watchdog', 'Carolina Public Press', 'NC Newsline', 'BPR'];

/** "By Ted Clifford Asheville Watchdog" -> "Ted Clifford, Asheville Watchdog". */
function byline(creator: string | undefined): string | undefined {
  const name = creator?.replace(/^By\s+/i, '').trim();
  if (!name) return undefined;
  const partner = PARTNERS.find((p) => name.endsWith(` ${p}`));
  return partner ? `${name.slice(0, -partner.length).trim()}, ${partner}` : name;
}

/** Article URLs end in article_<uuid>.html, and the feed guid ends in the same uuid. */
function assetId(url: string): string {
  return url.match(/article_([0-9a-f-]{36})\.html/)?.[1] ?? url;
}

/** Without its `crop`/`resize` query BLOX serves the original instead of a thumbnail. */
function fullSizeImage(url: string | undefined): string | undefined {
  return url?.split('?')[0] || undefined;
}

/**
 * The feed cuts each dek to its first 40 words plus "…"; the section front
 * shows it whole. Cutting the front's the same way keeps the dek identical
 * whichever path ran, so a feed 429 doesn't look like an edit to the pipeline.
 */
const FEED_DEK_WORDS = 40;

function feedStyleDek(text: string): string | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  return words.length > FEED_DEK_WORDS
    ? `${words.slice(0, FEED_DEK_WORDS).join(' ')}…`
    : words.join(' ');
}

/**
 * TownNews answers bursts with 429, article pages included, and ingest asks
 * for bodies soon after the feed. So this module's requests go out at least
 * REQUEST_GAP_MS apart, and an article page's 429 gets one spaced retry
 * (both well inside ingest's 15s per body).
 */
const REQUEST_GAP_MS = 3000;
const ARTICLE_RETRY = { maxRetries: 2, baseDelay: 5000 };
let lastRequestAt = 0;

async function paceRequests(): Promise<void> {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function feedToArticle(item: FeedItem): ScrapedArticle | undefined {
  if (!item.publishedAt) return undefined;
  const url = canonicalizeUrl(item.link);
  return {
    source: KEY,
    sourceId: assetId(url),
    url,
    title: item.title.replace(/\s+/g, ' ').trim(),
    publishedAt: item.publishedAt,
    author: byline(item.author),
    summary: feedStyleDek(htmlToText(item.descriptionHtml) ?? ''),
    imageUrl: fullSizeImage(item.imageUrl),
  };
}

async function scrapeSectionFront(): Promise<ScrapedArticle[]> {
  await paceRequests();
  const $ = cheerio.load(await fetchNewsText(`${SITE}/news/`, LABEL));
  return $('article.tnt-asset-type-article')
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const link = card.find('.tnt-headline a').first();
      const href = link.attr('href');
      const publishedAt = new Date(card.find('time[datetime]').first().attr('datetime') ?? '');
      if (!href || isNaN(publishedAt.getTime())) return [];
      const url = canonicalizeUrl(new URL(href, SITE).toString());
      return [
        {
          source: KEY,
          sourceId: assetId(url),
          url,
          title: link.text().replace(/\s+/g, ' ').trim(),
          publishedAt,
          summary: feedStyleDek(card.find('.tnt-summary').first().text()),
          imageUrl: fullSizeImage(card.find('img').first().attr('data-srcset')?.split(/\s/)[0]),
        },
      ];
    });
}

/** Ad slots and empty TownNews regions sit between the body paragraphs. */
const NON_BODY = '.tnt-ads-container, .tncms-region, script, style, meta';

/** Reprints end with a "###" line followed by the partner outlet's tagline. */
function cutAtEndMark(text: string | undefined): string | undefined {
  const paras = text?.split('\n\n') ?? [];
  const end = paras.indexOf('###');
  return (end >= 0 ? paras.slice(0, end) : paras).join('\n\n') || undefined;
}

const beaconTribune: NewsSourceModule = {
  key: KEY,
  name: 'The Beacon Tribune',
  homepage: SITE,
  kind: 'outlet',
  method: 'rss',
  async scrape({ deadline }) {
    try {
      await paceRequests();
      return (await fetchFeed(FEED_URL, LABEL)).flatMap((item) => feedToArticle(item) ?? []);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      console.warn(
        `[${LABEL}] Feed failed, reading the section front: ${error instanceof Error ? error.message : String(error)}`
      );
      return scrapeSectionFront();
    }
  },

  async fetchFullText(url) {
    await paceRequests();
    const $ = cheerio.load(await fetchNewsText(url, LABEL, {}, ARTICLE_RETRY));
    const body = $('#article-body');
    if (body.find('meta[itemprop="isAccessibleForFree"]').attr('content') === 'false')
      return undefined;
    body.find(NON_BODY).remove();
    const text = cutAtEndMark(htmlToText(body.html() ?? undefined));
    return text ? { text, imageUrl: fullSizeImage(ogImage($, url)) } : undefined;
  },
};

export default beaconTribune;
