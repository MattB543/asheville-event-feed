/**
 * Google News - Asheville headlines from outlets we don't scrape ourselves.
 *
 * Kind 'community' because Google publishes nothing of its own here: this is a
 * meta-feed. It surfaces outlets without a module of their own (the
 * Citizen-Times, the Charlotte Observer, the UNCA student paper...),
 * including paywalled and bot-walled ones, whose headlines are all we want
 * from them anyway. We never touch those sites: Google hands over the headline
 * and the link. Items from outlets that do have a module (DIRECT_DOMAINS) are
 * dropped, since those arrive directly with a body and a real URL.
 *
 * Four feeds: Google's own "Asheville - Latest" local section (the cleanest,
 * ~45 items a day), a 24-hour "Asheville" search that reaches further afield,
 * and two searches for the Buncombe towns the word "Asheville" misses. Google
 * silently ignores `when:1d` on long OR queries, so the town list is split in
 * two. Items carry only a headline, the publisher and a date. There's no dek,
 * because <description> just repeats the headline.
 *
 * Geography is Asheville + Buncombe only. Outlets based in Buncombe are
 * trusted to have matched for a reason. Everyone else's headline must name a
 * Buncombe place, which drops the statewide "western NC two years after
 * Helene" pieces and the national travel lists.
 *
 * Links are news.google.com redirects whose id no longer embeds the target
 * URL (the "AU_yqL..." format). Getting the real URL takes two requests: the
 * article page, for a signature and timestamp, then the batchexecute RPC the
 * page itself calls. We do that for at most MAX_RESOLVE items a run, and keep
 * the Google URL for the rest. So a row's URL can change from Google's to the
 * publisher's between runs, while its sourceId stays the same.
 *
 * No fetchFullText. What's left in this feed once the outlets with a module
 * are gone is mostly paywalled or bot-walled (Citizen-Times, Charlotte
 * Observer) or a one-off from a national site. A generic article extractor
 * aimed at arbitrary publishers would be brittle, and it would read sites
 * nobody has vetted. When an outlet shows up here often, give it a module.
 *
 * Terms: the feed's <copyright> limits it to "a personal feed reader for
 * personal, non-commercial use", and robots.txt disallows /rss for every
 * agent. The owner has ruled those aren't blockers for a free community site
 * that links out.
 */

import * as cheerio from 'cheerio';
import { fetchEventData } from '../../scrapers/base';
import { stripHtml } from '../../utils/parsers';
import { NEWS_USER_AGENT, canonicalizeUrl, fetchNewsText } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'GOOGLE_NEWS';
const LOCALE = 'hl=en-US&gl=US&ceid=US:en';

const searchFeed = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${LOCALE}`;

/** In priority order: URL resolution budget goes to the earlier feeds first. */
const FEEDS = [
  `https://news.google.com/rss/headlines/section/geo/Asheville%2C%20North%20Carolina?${LOCALE}`,
  searchFeed('Asheville when:1d'),
  searchFeed(
    '"Buncombe County" OR "Black Mountain, NC" OR Swannanoa OR Montreat OR "Biltmore Forest" when:1d'
  ),
  searchFeed('Weaverville OR Woodfin OR Barnardsville OR "Enka-Candler" when:1d'),
];

/**
 * Outlets with a module of their own, so their items are dropped here. List
 * only modules that exist in lib/news/sources/. A story from an outlet listed
 * too early vanishes from both paths, while a duplicate is cheap to merge on
 * its URL.
 */
const DIRECT_DOMAINS = [
  '828newsnow.com',
  'avlwatchdog.org',
  'biltmorebeacon.com',
  'biltmoreforest.org',
  'blackmountainnews.com',
  'bpr.org',
  'buncombecounty.org',
  'buncombenc.gov',
  'buncombeschools.org',
  'carolinapublicpress.org',
  'ashevillenc.gov',
  'flyavl.com',
  'foxcarolina.com',
  'missionhealth.org',
  'mountainx.com',
  'thebluebanner.net',
  'theurbannews.com',
  'townofblackmountain.org',
  'townofmontreat.org',
  'unca.edu',
  'weavervillenc.org',
  'wlos.com',
  'wncbusiness.com',
];

/**
 * Outlets based in Buncombe and without a module, whose items are kept even
 * when the headline names no place ("Showing riverside resilience, High Five
 * Coffee makes another comeback" is a Woodfin story).
 */
const BUNCOMBE_OUTLETS = [
  'citizen-times.com',
  'ashevegashotsheet.substack.com',
  'avltoday.6amcity.com',
  'ashvegas.com',
];

/** Obituaries, athletics departments and box scores, press-release wires and video. */
const JUNK_DOMAINS = [
  'legacy.com',
  'tributearchive.com',
  'ashevilleareaalternative.com',
  'maxpreps.com',
  'nfhsnetwork.com',
  'uncabulldogs.com',
  'upstatespartans.com',
  'bigsouthsports.com',
  'gobluehose.com',
  'espn.com',
  'prlog.org',
  'einpresswire.com',
  'youtube.com',
  'youtu.be',
  'disneyplus.com',
  'vidio.com',
];

const PAYWALLED_DOMAINS = [
  'citizen-times.com',
  'blueridgenow.com',
  'charlotteobserver.com',
  'newsobserver.com',
  'nytimes.com',
  'ajc.com',
  'wsj.com',
];

/**
 * The searches are already `when:1d`; this trims the geo section to match, so
 * each story is seen by ~4 runs rather than a dozen. The pipeline has no
 * memory yet, and every sighting costs a URL resolution.
 */
const MAX_AGE_HOURS = 30;
/** Two requests each (~2.3s with the delays). A run keeps ~20-40 items. */
const MAX_RESOLVE = 40;
const REQUEST_DELAY_MS = 1000;
const NO_RETRY = { maxRetries: 1 };

const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

/** Client context the news.google.com article page sends with its own 'Fbv4je' call, verbatim. */
// prettier-ignore
const GARTURL_CONTEXT = [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function matchesDomain(domain: string, list: string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

interface GoogleItem {
  id: string;
  /**
   * Publisher domain + normalized headline. Google lists one story under
   * several ids, and which one a feed shows first varies, so this (not the
   * guid) is the stable identity.
   */
  storyKey: string;
  title: string;
  publisher: string;
  domain: string;
  publishedAt: Date;
}

function parseItems(xml: string): GoogleItem[] {
  const $ = cheerio.load(xml, { xml: true });
  return $('item')
    .toArray()
    .flatMap((el): GoogleItem[] => {
      const $el = $(el);
      const id = $el.children('guid').text().trim();
      const $source = $el.children('source');
      const publisher = $source.text().trim();
      const publishedAt = new Date($el.children('pubDate').text().trim());
      let domain = '';
      try {
        domain = new URL($source.attr('url') ?? '').hostname.replace(/^www\./, '');
      } catch {
        // No usable publisher URL; filtered out below.
      }
      if (!id || !domain || isNaN(publishedAt.getTime())) return [];

      // Titles come as "Headline - Publisher".
      let title = stripHtml($el.children('title').text());
      if (publisher && title.endsWith(` - ${publisher}`))
        title = title.slice(0, -(publisher.length + 3));
      title = title.trim();
      const storyKey = `${domain}|${title.toLowerCase().replace(/\s+/g, ' ')}`;
      return [{ id, storyKey, title, publisher: publisher || domain, domain, publishedAt }];
    });
}

/**
 * Recover the publisher's URL behind a news.google.com article link, or
 * undefined if Google didn't hand it over. Throws on HTTP errors, including the
 * 429 Google sends when we ask too often.
 */
export async function resolveGoogleNewsUrl(googleUrl: string): Promise<string | undefined> {
  const id = googleUrl.match(/\/articles\/([^?/#]+)/)?.[1];
  if (!id) return undefined;

  const page = await fetchEventData(
    `https://news.google.com/rss/articles/${id}?${LOCALE}`,
    { headers: { 'User-Agent': NEWS_USER_AGENT } },
    NO_RETRY,
    KEY
  );
  const html = await page.text();
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) return undefined;

  await sleep(REQUEST_DELAY_MS);
  const request = ['garturlreq', GARTURL_CONTEXT, id, Number(timestamp), signature];
  const res = await fetchEventData(
    BATCH_URL,
    {
      method: 'POST',
      headers: {
        'User-Agent': NEWS_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({
        'f.req': JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]),
      }),
    },
    NO_RETRY,
    KEY
  );

  // Body is `)]}'` then a JSON array of RPC results; ours is ["garturlres", url, 1].
  const line = (await res.text()).split('\n').find((l) => l.startsWith('[['));
  if (!line) return undefined;
  const rows = JSON.parse(line) as unknown[][];
  const row = rows.find((r) => r[0] === 'wrb.fr' && r[1] === 'Fbv4je');
  if (typeof row?.[2] !== 'string') return undefined;
  const [tag, url] = JSON.parse(row[2]) as [string, unknown];
  return tag === 'garturlres' && typeof url === 'string' && /^https?:\/\//.test(url)
    ? url
    : undefined;
}

async function scrape(): Promise<ScrapedArticle[]> {
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
  const seen = new Set<string>();
  const items: GoogleItem[] = [];
  let feedsRead = 0;
  let direct = 0;
  let junk = 0;
  let outOfArea = 0;

  for (const feedUrl of FEEDS) {
    let xml: string;
    try {
      xml = await fetchNewsText(feedUrl, KEY, { Accept: 'application/rss+xml' });
      feedsRead++;
    } catch {
      continue; // fetchEventData logged it; the other feeds may still work.
    }
    for (const item of parseItems(xml)) {
      if (seen.has(item.storyKey)) continue;
      seen.add(item.storyKey);
      if (item.publishedAt.getTime() < cutoff) continue;
      if (matchesDomain(item.domain, DIRECT_DOMAINS)) direct++;
      else if (matchesDomain(item.domain, JUNK_DOMAINS)) junk++;
      else if (!matchesDomain(item.domain, BUNCOMBE_OUTLETS) && !mentionsBuncombe(item.title))
        outOfArea++;
      else items.push(item);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (feedsRead === 0) throw new Error('Every Google News feed failed');

  const articles: ScrapedArticle[] = [];
  let resolveBudget = MAX_RESOLVE;
  let resolved = 0;
  for (const item of items) {
    const googleUrl = `https://news.google.com/rss/articles/${item.id}`;
    let url: string | undefined;
    if (resolveBudget > 0) {
      resolveBudget--;
      try {
        url = await resolveGoogleNewsUrl(googleUrl);
        if (url) resolved++;
      } catch (error) {
        // Most likely a 429: stop asking for this run rather than dig deeper.
        console.warn(
          `[${KEY}] URL resolution stopped:`,
          error instanceof Error ? error.message : error
        );
        resolveBudget = 0;
      }
      await sleep(REQUEST_DELAY_MS);
    }

    articles.push({
      source: KEY,
      sourceId: item.storyKey,
      url: url ? canonicalizeUrl(url) : googleUrl,
      title: item.title,
      publishedAt: item.publishedAt,
      // No byline in the feed; for an aggregator the publisher is the useful credit.
      author: item.publisher,
      paywalled: matchesDomain(item.domain, PAYWALLED_DOMAINS) || undefined,
    });
  }

  console.log(
    `[${KEY}] ${articles.length} items kept; dropped ${direct} from outlets with a module, ${junk} junk, ${outOfArea} outside Buncombe; ${resolved} URLs resolved`
  );
  return articles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

const googleNews: NewsSourceModule = {
  key: KEY,
  name: 'Google News (Asheville)',
  homepage: 'https://news.google.com/',
  kind: 'community',
  method: 'rss',
  scrape,
};

export default googleNews;
