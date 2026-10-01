/**
 * Reddit - r/asheville, r/BlackMountain and the Buncombe slice of r/wnc: what
 * locals are talking about.
 *
 * Community signal, not journalism: a link post usually points at a local
 * outlet's story, and a text post is a first-hand report or complaint that
 * sometimes runs ahead of the newsrooms (a fire, a road closure, a clinic that
 * suddenly shut, a new Flock camera).
 *
 * What works (tested 2026-09-25):
 *  - The unauthenticated `.json` listings answer 403 "blocked by network
 *    security" to every client, residential IP included. Only the Atom feeds
 *    are open, and they carry no score or comment count.
 *  - From a datacenter the feeds are blocked too. Fetched through Jina
 *    Reader's cloud, the feed got a 403 and the subreddit page said "You've
 *    been blocked by network security. To continue, log in to your Reddit
 *    account or use your developer token". Vercel's egress will almost
 *    certainly get the same, hence `localOnly`, like MountainX and Facebook.
 *  - The limit is one request per clock minute per IP, shared by every
 *    reddit.com endpoint (`x-ratelimit-remaining: 0` after a single call, and
 *    `x-ratelimit-reset` counts down to the next minute). So all three
 *    subreddits come from ONE multireddit request. Its 100 entries cover ~2.5
 *    days, which a 6-hour cron never outruns. A comments feed per post would
 *    cost a minute each, so there is no fetchFullText. The feed already
 *    carries each text post's full body.
 *
 * Terms: robots.txt is `Disallow: /`. Reddit's Responsible Builder Policy
 * (updated 2026-06-05) requires "explicit approval before accessing any Reddit
 * data through our API" and forbids unapproved commercialization, which
 * "extends to commercial and non-commercial mining, scraping". Its Public
 * Content Policy allows "non-commercial uses, such as learning and community"
 * and says to "talk to us" about commercial ones. Self-serve API keys ended
 * in late 2025, and new OAuth clients go through a manual approval ticket. So
 * this module is the working prototype. Shipping it is the owner's call, and
 * the compliant route runs through Reddit.
 */

import * as cheerio from 'cheerio';
import { fetchEventData } from '../../scrapers/base';
import { canonicalizeUrl, htmlToText, parseFeed, type FeedItem } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'REDDIT';

/**
 * r/asheville is ~35 posts a day. r/BlackMountain is about one a week, all
 * Buncombe. r/wnc is ~2.4 a day across the whole region; about one post in six
 * names a Buncombe place, and only those are kept.
 */
const SUBREDDITS = ['asheville', 'BlackMountain', 'wnc'];
const REGIONAL_SUBREDDITS = new Set(['wnc']);
const FEED_URL = `https://www.reddit.com/r/${SUBREDDITS.join('+')}/new/.rss?limit=100`;

/** Reddit asks automated clients to identify themselves instead of posing as a browser. */
const USER_AGENT = 'web:avlgo-news:v0.1 (+https://avlgo.com)';

/** Rate-limit windows are clock minutes, so one retry after 61s always lands in a fresh one. */
const RATE_LIMIT_RETRY = { maxRetries: 2, baseDelay: 61_000, maxDelay: 61_000 };

/** Self posts shorter than this are one-line questions. */
const MIN_SELF_TEXT = 150;
/** Photo posts need a real write-up to count (a flyer with details, an incident report). */
const MIN_MEDIA_TEXT = 200;

const MEDIA_HOSTS =
  /(^|\.)(i\.redd\.it|v\.redd\.it|preview\.redd\.it|imgur\.com|gfycat\.com|giphy\.com)$/i;

/** Asks, classifieds and lost-pet posts: most of the sub, none of it news. */
const NOISE_TITLE = [
  /\brecommend/i,
  /\blooking (for|to)\b/i,
  /\bISO\b/,
  /\bin search of\b/i,
  /\bfor sale\b/i,
  /\bfree tickets?\b/i,
  /\b(hiring|housekeepers?|laborer|paid cash)\b/i,
  /\b(lost|found|missing) (dog|cat|pet|puppy|kitten)\b/i,
  /\b(roommate|sublet|sublease)\b/i,
  /\bdating\b/i,
  /\bwhere (can|do|to|should) (i|we)\b/i,
  /\b(anyone|has anyone) (know|have|recommend|tried|used)\b/i,
  /^(any|is there|are there|need|best|cheap(er|est)?|affordable)\b/i,
];

type PostKind = 'self' | 'link' | 'media';

interface ParsedPost {
  kind: PostKind;
  body?: string;
  /** Link target for link posts. */
  linkUrl?: string;
}

function parseContent(html: string | undefined): ParsedPost {
  if (!html) return { kind: 'self' };
  const $ = cheerio.load(html);
  const text = htmlToText($('.md').first().html() ?? undefined);
  const body = text && !/^\[(removed|deleted)\]$/.test(text) ? text : undefined;
  const href = $('a')
    .filter((_, a) => $(a).text().trim() === '[link]')
    .first()
    .attr('href');

  // Crossposts link to the original post with a relative /r/... path.
  if (!href || href.startsWith('/')) return { kind: 'self', body };

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'self', body };
  }
  if (/(^|\.)reddit\.com$/i.test(url.hostname)) {
    return { kind: url.pathname.startsWith('/gallery/') ? 'media' : 'self', body };
  }
  if (MEDIA_HOSTS.test(url.hostname)) return { kind: 'media', body };
  return { kind: 'link', body, linkUrl: canonicalizeUrl(href) };
}

function keep(item: FeedItem, subreddit: string, post: ParsedPost): boolean {
  if (NOISE_TITLE.some((re) => re.test(item.title))) return false;
  if (
    REGIONAL_SUBREDDITS.has(subreddit) &&
    !mentionsBuncombe(item.title, post.body, post.linkUrl) &&
    !/\bAVL\b/.test(`${item.title} ${post.body ?? ''}`)
  ) {
    return false;
  }
  const textLength = post.body?.length ?? 0;
  if (post.kind === 'link') return true;
  if (post.kind === 'media') return textLength >= MIN_MEDIA_TEXT;
  return textLength >= MIN_SELF_TEXT;
}

async function scrape(): Promise<ScrapedArticle[]> {
  const res = await fetchEventData(
    FEED_URL,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml' } },
    RATE_LIMIT_RETRY,
    KEY
  );
  const items = parseFeed(await res.text());

  const articles: ScrapedArticle[] = [];
  for (const item of items) {
    if (!item.link || !item.title || !item.publishedAt) continue;
    // The entry's <category term> is the subreddit it was posted to.
    const subreddit = item.categories[0] ?? '';
    const post = parseContent(item.contentHtml);
    if (!keep(item, subreddit.toLowerCase(), post)) continue;

    // ScrapedArticle has no field for a link post's target, so it rides at the
    // end of the body where the AI enrichment step will read it.
    const contentText = post.linkUrl
      ? [post.body, `Link: ${post.linkUrl}`].filter(Boolean).join('\n\n')
      : post.body;

    articles.push({
      source: KEY,
      sourceId: item.guid || item.link,
      url: canonicalizeUrl(item.link),
      title: item.title.trim(),
      publishedAt: item.publishedAt,
      updatedAt: item.updatedAt,
      author: item.author?.replace(/^\//, ''),
      summary: post.linkUrl
        ? `Shared link: ${new URL(post.linkUrl).hostname.replace(/^www\./, '')}`
        : undefined,
      contentText,
      imageUrl: item.imageUrl,
      categories: subreddit ? [`r/${subreddit}`] : undefined,
    });
  }

  console.log(
    `[${KEY}] Kept ${articles.length} of ${items.length} posts (the rest: asks, classifieds, photos, non-Buncombe r/wnc)`
  );
  return articles;
}

const reddit: NewsSourceModule = {
  key: KEY,
  name: 'Reddit (r/asheville, r/BlackMountain, r/wnc)',
  homepage: 'https://www.reddit.com/r/asheville/',
  kind: 'community',
  method: 'rss',
  localOnly: true,
  scrape,
};

export default reddit;
