/**
 * Buncombe County government news - the county's CivicPlus "News Flash".
 *
 * Covers the commissioners, Election Services (the Board of Elections has no
 * feed of its own), Public Health, Emergency Services, Helene recovery,
 * libraries and the rest of county government, ~7 posts a week.
 *
 * Access is the awkward part. buncombenc.gov sits behind a Cloudflare WAF rule
 * that answers Node's fetch - and the Chrome-cipher `fetchAsChrome` dispatcher
 * - with "Attention Required!" (403) on every path, while curl on Windows
 * (Schannel TLS) sending only a browser User-Agent (NEWS_USER_AGENT; the old
 * Chrome/120 one worked too) is served normally. So requests go through curl.
 * Whether Linux curl (OpenSSL) gets through from Vercel is untested, hence
 * localOnly.
 *
 * The RSS feed carries only a one-sentence summary; fetchFullText reads the
 * body from the lightweight mobile article page (/m/newsflash/home/detail/N),
 * which is what CivicAlerts.aspx?AID=N redirects to anyway.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
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
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithRetry } from '../../utils/retry';
import { stripHtml } from '../../utils/parsers';

const execFileAsync = promisify(execFile);

const SITE = 'https://www.buncombenc.gov';
const FEED_URL = `${SITE}/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml`;
const LABEL = 'BuncombeCounty';
const SOURCE = 'BUNCOMBE_COUNTY';

/** Procurement notices share the feed with real news. */
const PROCUREMENT =
  /^(RFQ|RFP|RFI|IFB)\b|request for (qualifications|proposals|bids|information)|invitation (for|to) bid|bid opportunit/i;

const CURL_RETRY_DELAY_MS = 3000;

const BLOCK_PAGE = /<title>\s*(Attention Required|Just a moment)/i;

/**
 * Deliberately sends only a browser User-Agent. With curl's default
 * `Accept: *\/*` the WAF lets it through; adding browser Accept /
 * Accept-Language headers gets the same 403 fetch does, as does curl's own UA.
 */
async function curlText(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-sS',
      '-L',
      '--fail',
      '--max-time',
      String(Math.ceil(DEFAULT_FETCH_TIMEOUT_MS / 1000)),
      '-A',
      NEWS_USER_AGENT,
      url,
    ],
    { maxBuffer: 10 * 1024 * 1024, timeout: DEFAULT_FETCH_TIMEOUT_MS + 2000, windowsHide: true }
  );
  return stdout;
}

function isMissingBinary(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * curl first: fetch is always refused, and a stream of refused requests seems
 * to make the WAF stricter with the curl that follows. Plain fetch is only the
 * fallback for a runtime without a curl binary. One spaced retry on a 403,
 * which is sometimes transient.
 */
async function fetchText(url: string): Promise<string> {
  let body: string;
  try {
    body = await curlText(url).catch(async (error) => {
      if (isMissingBinary(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, CURL_RETRY_DELAY_MS));
      return curlText(url);
    });
  } catch (error) {
    if (!isMissingBinary(error)) throw error;
    const res = await fetchWithRetry(
      url,
      { headers: { ...BROWSER_HEADERS, 'User-Agent': NEWS_USER_AGENT } },
      { maxRetries: 2 }
    );
    body = await res.text();
  }
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
      imageUrl: image.first().attr('url') || undefined,
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
  localOnly: true,
  async scrape() {
    return parseNewsFlash(await fetchText(FEED_URL));
  },
  async fetchFullText(url) {
    const id = civicPlusArticleId(url);
    return id ? civicPlusArticleBody(await fetchText(civicPlusDetailUrl(SITE, id))) : undefined;
  },
};

export default buncombeCounty;
