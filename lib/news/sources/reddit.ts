/**
 * Reddit - r/asheville, r/BlackMountain and the Buncombe slice of r/wnc: what
 * locals are talking about.
 *
 * Community signal, not journalism: a link post usually points at a local
 * outlet's story, and a text post is a first-hand report or complaint that
 * sometimes runs ahead of the newsrooms (a fire, a road closure, a clinic that
 * suddenly shut, a new Flock camera).
 *
 * Read through Reddit's OAuth API with Matt's "personal use script" app
 * (since 2026-10-01): a password-grant token, then ONE multireddit listing of
 * the newest 100 posts, which covers ~3 days, so a 3-hour cron never outruns
 * it. Unlike the public Atom feed this module used before, the API works from
 * a datacenter, so it runs on Vercel, and it carries live score and comment
 * counts, which every scrape refreshes. Credentials: REDDIT_CLIENT_ID,
 * REDDIT_CLIENT_SECRET, REDDIT_USERNAME and REDDIT_PASSWORD (quote the password
 * in .env if it contains `#`).
 *
 * Scry (a Reddit data reseller) was evaluated on 2026-10-01 and rejected:
 * r/asheville ran ~10h behind with 30-45h gaps, its counts were never
 * refreshed, and personal keys are licensed for non-commercial research only.
 *
 * Terms: Reddit's Responsible Builder Policy expects approval for apps built
 * on its data, and a "personal use script" app is meant for personal use.
 * One request every 3 hours is far inside the API's limits; moving to an
 * approved app is the owner's call.
 */

import { fetchEventData } from '../../scrapers/base';
import { canonicalizeUrl } from '../feeds';
import type { NewsSourceModule, ScrapeContext, ScrapedArticle } from '../types';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'REDDIT';

/**
 * r/asheville is ~35 posts a day. r/BlackMountain is about one a week, all
 * Buncombe. r/wnc is ~2.4 a day across the whole region; about one post in six
 * names a Buncombe place, and only those are kept.
 */
const SUBREDDITS = ['asheville', 'BlackMountain', 'wnc'];
const REGIONAL_SUBREDDITS = new Set(['wnc']);
const LISTING_URL = `https://oauth.reddit.com/r/${SUBREDDITS.join('+')}/new?limit=100&raw_json=1`;
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

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

/** The fields of a listing's `data` this module reads. */
interface RedditPost {
  name: string; // "t3_<id>", the same id the Atom feed's <id> carried
  subreddit: string;
  title: string;
  selftext: string;
  is_self: boolean;
  url: string;
  permalink: string;
  created_utc: number;
  author: string;
  score: number;
  num_comments: number;
  over_18: boolean;
  stickied: boolean;
  removed_by_category: string | null;
  link_flair_text: string | null;
  preview?: { images?: Array<{ source?: { url?: string } }> };
}

type PostKind = 'self' | 'link' | 'media';

/** Reddit asks API clients to identify the app and its owner. */
function userAgent(username: string): string {
  return `web:avlgo-news:v1.0 (by /u/${username})`;
}

function credentials() {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    throw new Error(
      'Reddit API credentials missing (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD)'
    );
  }
  return {
    clientId: REDDIT_CLIENT_ID,
    clientSecret: REDDIT_CLIENT_SECRET,
    username: REDDIT_USERNAME,
    password: REDDIT_PASSWORD,
  };
}

/** A fresh password-grant token. It lasts a day; one run needs it once. */
async function accessToken(creds: ReturnType<typeof credentials>): Promise<string> {
  const res = await fetchEventData(
    TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
        'User-Agent': userAgent(creds.username),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: creds.username,
        password: creds.password,
      }),
    },
    { maxRetries: 1 },
    KEY
  );
  // A bad password comes back 200 with {"error": "invalid_grant"}
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token)
    throw new Error(`Reddit token request failed: ${json.error ?? 'no token'}`);
  return json.access_token;
}

function postKind(post: RedditPost): PostKind {
  if (post.is_self) return 'self';
  let host: string;
  try {
    host = new URL(post.url, 'https://www.reddit.com').hostname;
  } catch {
    return 'self';
  }
  // Galleries live on reddit.com; crossposts point back at another reddit post.
  if (/(^|\.)reddit\.com$/i.test(host)) {
    return post.url.includes('/gallery/') ? 'media' : 'self';
  }
  return MEDIA_HOSTS.test(host) ? 'media' : 'link';
}

function keep(post: RedditPost, kind: PostKind, body: string | undefined): boolean {
  if (post.stickied || post.over_18 || post.removed_by_category) return false;
  if (NOISE_TITLE.some((re) => re.test(post.title))) return false;
  const linkUrl = kind === 'link' ? post.url : undefined;
  if (
    REGIONAL_SUBREDDITS.has(post.subreddit.toLowerCase()) &&
    !mentionsBuncombe(post.title, body, linkUrl) &&
    !/\bAVL\b/.test(`${post.title} ${body ?? ''}`)
  ) {
    return false;
  }
  const textLength = body?.length ?? 0;
  if (kind === 'link') return true;
  if (kind === 'media') return textLength >= MIN_MEDIA_TEXT;
  return textLength >= MIN_SELF_TEXT;
}

async function scrape({ deadline }: ScrapeContext): Promise<ScrapedArticle[]> {
  const creds = credentials();
  const token = await accessToken(creds);
  if (Date.now() > deadline) return [];

  const res = await fetchEventData(
    LISTING_URL,
    { headers: { Authorization: `bearer ${token}`, 'User-Agent': userAgent(creds.username) } },
    { maxRetries: 1 },
    KEY
  );
  const json = (await res.json()) as { data?: { children?: Array<{ data: RedditPost }> } };
  const posts = (json.data?.children ?? []).map((child) => child.data);

  const articles: ScrapedArticle[] = [];
  for (const post of posts) {
    const kind = postKind(post);
    const selftext = post.selftext.trim();
    const body = selftext && !/^\[(removed|deleted)\]$/.test(selftext) ? selftext : undefined;
    if (!keep(post, kind, body)) continue;

    const linkedUrl = kind === 'link' ? canonicalizeUrl(post.url) : undefined;
    const preview = post.preview?.images?.[0]?.source?.url;
    articles.push({
      source: KEY,
      sourceId: post.name,
      url: canonicalizeUrl(`https://www.reddit.com${post.permalink}`),
      title: post.title.trim(),
      publishedAt: new Date(post.created_utc * 1000),
      author: post.author,
      summary: linkedUrl
        ? `Shared link: ${new URL(linkedUrl).hostname.replace(/^www\./, '')}`
        : undefined,
      contentText: body,
      imageUrl: preview?.startsWith('https://') ? preview : undefined,
      categories: [`r/${post.subreddit}`, ...(post.link_flair_text ? [post.link_flair_text] : [])],
      engagement: { score: post.score, comments: post.num_comments },
      linkedUrl,
    });
  }

  console.log(
    `[${KEY}] Kept ${articles.length} of ${posts.length} posts (the rest: asks, classifieds, photos, removed, non-Buncombe r/wnc)`
  );
  return articles;
}

const reddit: NewsSourceModule = {
  key: KEY,
  name: 'Reddit (r/asheville, r/BlackMountain, r/wnc)',
  homepage: 'https://www.reddit.com/r/asheville/',
  kind: 'community',
  method: 'api',
  scrape,
};

export default reddit;
