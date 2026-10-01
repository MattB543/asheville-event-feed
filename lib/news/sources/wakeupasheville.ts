/**
 * Wake Up, Asheville! - Matt Peiken's four-minute weekday newscast (podcast).
 *
 * Every weekday episode's show notes list the ~5 stories that morning's
 * newscast covers, each linked to its source: the Citizen-Times, 828 News Now,
 * WLOS, Asheville Watchdog, Mountain Xpress, BPR, Carolina Public Press...
 * That makes it a daily editor's pick of the most important local stories. The
 * pipeline can match those links against the outlets' own articles as an
 * importance signal. Bonus episodes (candidate interviews) have a written
 * description instead of links.
 *
 * Kind 'community' like the other meta-feeds. The audio is original, but the
 * text we get is a list of other outlets' stories.
 *
 * Transistor-hosted RSS, no terms beyond normal podcast syndication. The feed
 * holds the whole back catalogue (~1 MB), so only recent episodes are returned.
 */

import * as cheerio from 'cheerio';
import { canonicalizeUrl, fetchFeed, htmlToText } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';

const KEY = 'WAKE_UP_ASHEVILLE';
const FEED_URL = 'https://feeds.transistor.fm/wake-up-asheville';
const MAX_AGE_DAYS = 14;

interface StoryLink {
  title: string;
  url: string;
}

function storyLinks(html: string | undefined): StoryLink[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  return $('li a[href^="http"]')
    .toArray()
    .map((a) => ({ title: $(a).text().trim(), url: canonicalizeUrl($(a).attr('href') ?? '') }))
    .filter((s) => s.title && s.url);
}

async function scrape(): Promise<ScrapedArticle[]> {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const items = await fetchFeed(FEED_URL, KEY);

  return items.flatMap((item): ScrapedArticle[] => {
    if (!item.link || !item.title || !item.publishedAt || item.publishedAt.getTime() < cutoff)
      return [];
    const notes = item.contentHtml ?? item.descriptionHtml;
    const stories = storyLinks(notes);

    // ScrapedArticle has no field for outbound links, so the newscast's story
    // list goes in the body as "headline - url" lines.
    const contentText = stories.length
      ? [
          "Today's Asheville newscast references these stories:",
          ...stories.map((s) => `${s.title} - ${s.url}`),
        ].join('\n\n')
      : htmlToText(notes);

    return [
      {
        source: KEY,
        sourceId: item.guid || item.link,
        url: canonicalizeUrl(item.link),
        title: item.title.trim(),
        publishedAt: item.publishedAt,
        author: item.author,
        summary: stories.length ? stories.map((s) => s.title).join('; ') : undefined,
        contentText,
      },
    ];
  });
}

const wakeUpAsheville: NewsSourceModule = {
  key: KEY,
  name: 'Wake Up, Asheville!',
  homepage: 'https://wakeupavl.transistor.fm',
  kind: 'community',
  method: 'rss',
  scrape,
};

export default wakeUpAsheville;
