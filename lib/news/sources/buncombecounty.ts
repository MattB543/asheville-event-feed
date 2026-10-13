/**
 * Buncombe County government news - the county's CivicPlus "News Flash".
 *
 * Covers the commissioners, Election Services (the Board of Elections has no
 * feed of its own), Public Health, Emergency Services, Helene recovery,
 * libraries and the rest of county government, ~7 posts a week.
 *
 * Access: www.buncombenc.gov sits behind Cloudflare, which since ~2026-10-05
 * refuses everything but a real, headed Chrome (the earlier workaround, curl on
 * Windows with only a browser User-Agent, stopped working then too). The same
 * CivicPlus site answers unblocked on its default host, so requests go to
 * FETCH_HOST while article URLs stay on www.
 *
 * The RSS feed carries only a one-sentence summary; fetchFullText reads the
 * body from the lightweight mobile article page (/m/newsflash/home/detail/N),
 * which is what CivicAlerts.aspx?AID=N redirects to anyway.
 */

import * as cheerio from 'cheerio';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import {
  civicPlusArticleBody,
  civicPlusArticleId,
  civicPlusDetailUrl,
  civicPlusRssDate,
  decodeNumericEntities,
} from './shared/civicplus';
import { BROWSER_HEADERS } from '../../scrapers/base';
import { NEWS_USER_AGENT } from '../feeds';
import { fetchWithRetry } from '../../utils/retry';
import { stripHtml } from '../../utils/parsers';

const SITE = 'https://www.buncombenc.gov';
const FETCH_HOST = 'https://nc-buncombecounty.civicplus.com';
const FEED_URL = `${FETCH_HOST}/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml`;
const LABEL = 'BuncombeCounty';
const SOURCE = 'BUNCOMBE_COUNTY';

/** Procurement notices share the feed with real news. */
const PROCUREMENT =
  /^(RFQ|RFP|RFI|IFB)\b|request for (qualifications|proposals|bids|information)|invitation (for|to) bid|bid opportunit/i;

const BLOCK_PAGE = /<title>\s*(Attention Required|Just a moment)/i;

async function fetchText(url: string): Promise<string> {
  const res = await fetchWithRetry(
    url,
    { headers: { ...BROWSER_HEADERS, 'User-Agent': NEWS_USER_AGENT } },
    { maxRetries: 2 }
  );
  const body = await res.text();
  if (BLOCK_PAGE.test(body)) throw new Error(`[${LABEL}] Blocked by Cloudflare: ${url}`);
  return body;
}

/** Feed descriptions often open with a stray "?" where a zero-width character was. */
function cleanSummary(text: string): string | undefined {
  const cleaned = stripHtml(decodeNumericEntities(text))
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^\?+/, '')
    .trim();
  return cleaned || undefined;
}

function articleUrl(id: string): string {
  return `${SITE}/CivicAlerts.aspx?AID=${id}`;
}

function parseNewsFlash(xml: string): ScrapedArticle[] {
  const $ = cheerio.load(xml, { xml: true });
  const articles: ScrapedArticle[] = [];
  for (const el of $('item').toArray()) {
    const $el = $(el);
    const title = stripHtml($el.children('title').text()).trim();
    const id = civicPlusArticleId($el.children('link').text());
    const publishedAt = civicPlusRssDate($el.children('pubDate').text());
    if (!title || !id || !publishedAt || PROCUREMENT.test(title)) continue;
    const image = $el
      .children('enclosure')
      .filter((_, e) => /^image\//.test($(e).attr('type') ?? ''));
    articles.push({
      source: SOURCE,
      sourceId: id,
      url: articleUrl(id),
      title,
      publishedAt,
      summary: cleanSummary($el.children('description').text()),
      // A www image is a 403 challenge page to a reader's browser too
      imageUrl: image.first().attr('url')?.replace(SITE, FETCH_HOST) || undefined,
    });
  }
  return articles;
}

const buncombeCounty: NewsSourceModule = {
  key: SOURCE,
  name: 'Buncombe County',
  homepage: `${SITE}/CivicAlerts.aspx`,
  kind: 'government',
  method: 'rss',
  async scrape() {
    return parseNewsFlash(await fetchText(FEED_URL));
  },
  async fetchFullText(url) {
    const id = civicPlusArticleId(url);
    return id
      ? civicPlusArticleBody(await fetchText(civicPlusDetailUrl(FETCH_HOST, id)))
      : undefined;
  },
};

export default buncombeCounty;
