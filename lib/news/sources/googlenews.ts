/**
 * Google News - Asheville headlines from outlets we don't scrape ourselves.
 *
 * An aggregator: Google publishes nothing of its own here. It surfaces outlets
 * without a module of their own (the Citizen-Times, the Charlotte Observer...),
 * including paywalled and bot-walled ones, whose headlines are all we want
 * from them anyway. We never touch those sites: Google hands over the headline
 * and the link. Every item carries `publisher`, so it is attributed to (and
 * counted as reporting by) the outlet that wrote it, not to Google. Items from
 * outlets that do have a module (DIRECT_DOMAINS) are dropped, since those
 * arrive directly with a body; the article URL is the dedup backstop.
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
 * Video and clip pages (a /video/, /videos/ or /watch/ path) are dropped once
 * resolved: a headline over a player leaves a summary nothing to say.
 *
 * Links are news.google.com redirects whose id no longer embeds the target
 * URL (the "AU_yqL..." format). Getting the real URL takes two requests: the
 * article page, for a signature and timestamp, then the batchexecute RPC the
 * page itself calls. We do that for at most MAX_RESOLVE items a run, newest
 * first, and emit only the items that resolved: the publisher's URL is the
 * article's identity, so an item still behind a Google link is left for a
 * later run (it stays in the feeds for a day or so).
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
import type { NewsSourceModule, ScrapeContext, ScrapedArticle } from '../types';
import { BUNCOMBE_OUTLETS, mentionsBuncombe } from './shared/buncombe';

const KEY = 'GOOGLE_NEWS';
const LOCALE = 'hl=en-US&gl=US&ceid=US:en';

const searchFeed = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${LOCALE}`;

/** When two feeds list the same story, the earlier feed's copy is kept. */
const FEEDS = [
  `https://news.google.com/rss/headlines/section/geo/Asheville%2C%20North%20Carolina?${LOCALE}`,
  searchFeed('Asheville when:1d'),
  searchFeed(
    '"Buncombe County" OR "Black Mountain, NC" OR Swannanoa OR Montreat OR "Biltmore Forest" when:1d'
  ),
  searchFeed('Weaverville OR Woodfin OR Barnardsville OR "Enka-Candler" when:1d'),
];

/**
 * Outlets with a module in NEWS_SOURCES, so their items are dropped here.
 * List only registered modules: a story from an outlet listed too early
 * vanishes from both paths, while a duplicate is cheap to merge on its URL.
 */
const DIRECT_DOMAINS = [
  '828newsnow.com',
  'avlwatchdog.org',
  'biltmorebeacon.com',
  'biltmoreforest.org',
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

/** Obituaries, athletics departments and box scores, press-release wires, video and listings. */
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
  'bvmsports.com',
  'espn.com',
  'prlog.org',
  'einpresswire.com',
  'youtube.com',
  'youtu.be',
  'disneyplus.com',
  'vidio.com',
  'realtor.com',
];

/** Video and clip pages, on any publisher. */
const VIDEO_PATH = /\/(videos?|watch)\//i;

const PAYWALLED_DOMAINS = [
  'citizen-times.com',
  'blackmountainnews.com',
  'blueridgenow.com',
  'charlotteobserver.com',
  'newsobserver.com',
  'nytimes.com',
  'ajc.com',
  'wsj.com',
];

/**
 * The searches are already `when:1d`; this trims the geo section to match, so
 * each story is seen by ~10 three-hourly runs rather than a few dozen. This
 * module has no memory between runs, and every sighting costs a URL resolution.
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

async function scrape({ deadline }: ScrapeContext): Promise<ScrapedArticle[]> {
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
  const seen = new Set<string>();
  const items: GoogleItem[] = [];
  let feedsRead = 0;
  let direct = 0;
  let junk = 0;
  let outOfArea = 0;

  for (const feedUrl of FEEDS) {
    if (Date.now() > deadline) break;
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

  // Newest first, so a story gets the resolution budget on its first sightings.
  items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  const byUrl = new Map<string, ScrapedArticle>();
  let attempted = 0;
  let unresolved = 0;
  let resolvedDirect = 0;
  let video = 0;
  for (const item of items) {
    if (attempted >= MAX_RESOLVE || Date.now() > deadline) break;
    attempted++;
    let url: string | undefined;
    try {
      url = await resolveGoogleNewsUrl(`https://news.google.com/rss/articles/${item.id}`);
    } catch (error) {
      // Most likely a 429: stop asking for this run rather than dig deeper.
      console.warn(
        `[${KEY}] URL resolution stopped:`,
        error instanceof Error ? error.message : error
      );
      break;
    }
    await sleep(REQUEST_DELAY_MS);

    let host = '';
    try {
      host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
    } catch {
      // A malformed URL counts as unresolved.
    }
    if (!url || !host || host === 'news.google.com') {
      unresolved++;
      continue;
    }
    // Syndicated copies: the feed named another outlet, but the link lands on one with a module.
    if (matchesDomain(host, DIRECT_DOMAINS)) {
      resolvedDirect++;
      continue;
    }
    if (VIDEO_PATH.test(new URL(url).pathname)) {
      video++;
      continue;
    }

    const article: ScrapedArticle = {
      source: KEY,
      sourceId: item.storyKey,
      url: canonicalizeUrl(url),
      title: item.title,
      publishedAt: item.publishedAt,
      paywalled: matchesDomain(item.domain, PAYWALLED_DOMAINS) || undefined,
      publisher: { name: item.publisher, domain: item.domain },
    };
    // One article can sit in the feeds under two headlines. Keep one by a fixed
    // rule, so its title doesn't flip with whichever copy resolved first.
    const kept = byUrl.get(article.url);
    if (!kept || article.title < kept.title) byUrl.set(article.url, article);
  }

  const articles = [...byUrl.values()];

  console.log(
    `[${KEY}] ${articles.length} of ${items.length} items emitted (${attempted} resolutions tried, ${unresolved} unresolved, ${resolvedDirect} landed on an outlet with a module, ${video} video pages, ${items.length - attempted} left for a later run); dropped ${direct} from outlets with a module, ${junk} junk, ${outOfArea} outside Buncombe`
  );
  return articles;
}

const googleNews: NewsSourceModule = {
  key: KEY,
  name: 'Google News (Asheville)',
  homepage: 'https://news.google.com/',
  kind: 'outlet',
  method: 'rss',
  scrape,
};

export default googleNews;
