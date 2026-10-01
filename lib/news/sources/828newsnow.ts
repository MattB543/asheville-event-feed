/**
 * 828newsNOW - the Asheville newsroom of Saga Communications' radio group
 * (WWNC/WISE/WOXL/WTMT). Six or so local stories a day, free, full text.
 *
 * Stories are a custom post type, so they come from /wp-json/wp/v2/news rather
 * than /posts, and the sections are a custom taxonomy (`sections`). Embedding
 * the terms costs ~140 KB a post (SEO metadata on every term), so we read the
 * ~45 section names once and map the ids ourselves.
 *
 * Paid content sits in the same stream, and the labels need care:
 *  - "Native Advertising" also tags the newsroom's crime briefs, which carry a
 *    "Sponsored by ..." underwriting line but are written from police and court
 *    releases by the news staff. The ads are the ones with no
 *    `saga_news_source_category` (Massage Envy promos, the weekend
 *    things-to-do listing, fundraiser plugs), so that is what we drop.
 *  - Advertiser columns get their own section ("HVAC System & Maintenance
 *    Expert", "Ask The Expert", "Shop Simply"...), dropped by name.
 *
 * The newsroom also covers Hendersonville, Marion, Marshall and the national
 * forests, so stories must name a Buncombe place somewhere in the text; that
 * drops about one in ten.
 *
 * robots.txt asks for a 20-second crawl delay; with two requests a run we
 * simply wait that long between them.
 */

import {
  canonicalizeUrl,
  fetchNewsText,
  htmlToText,
  wpAuthor,
  wpDate,
  wpImage,
  type WpPost,
} from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { stripHtml } from '../../utils/parsers';
import { mentionsBuncombe } from './shared/buncombe';

const KEY = 'NEWS_828_NOW';
const LABEL = '828newsNOW';
const SITE = 'https://828newsnow.com';

const CRAWL_DELAY_MS = 20_000;
const LOOKBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const NATIVE_AD = 'Native Advertising';
const ADVERTISER_SECTION = /(^|\s)Expert$|^Shop Simply$/;
/** On ~95% of stories, so it says nothing. */
const GENERIC_SECTIONS = new Set(['Local']);
/** The station's house byline on unsigned briefs. */
const HOUSE_BYLINE = '828newsNOW';

interface SagaNewsPost extends WpPost {
  sections?: number[];
  saga_news_source_category?: number[];
}

async function getJson<T>(path: string): Promise<T> {
  const body = await fetchNewsText(`${SITE}/wp-json/wp/v2/${path}`, LABEL, {
    Accept: 'application/json',
  });
  return JSON.parse(body) as T;
}

async function fetchSectionNames(): Promise<Map<number, string>> {
  const sections = await getJson<Array<{ id: number; name: string }>>(
    'sections?per_page=100&_fields=id,name'
  );
  return new Map(sections.map((s) => [s.id, stripHtml(s.name)]));
}

async function fetchRecentNews(): Promise<SagaNewsPost[]> {
  const params = new URLSearchParams({
    per_page: '50',
    after: new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString(),
    _embed: 'author,wp:featuredmedia',
    _fields:
      'id,date_gmt,modified_gmt,link,title,excerpt,content,sections,saga_news_source_category,_links,_embedded',
  });
  return getJson<SagaNewsPost[]>(`news?${params}`);
}

function isPaidContent(post: SagaNewsPost, sections: string[]): boolean {
  if (sections.some((s) => ADVERTISER_SECTION.test(s))) return true;
  return sections.includes(NATIVE_AD) && !post.saga_news_source_category?.length;
}

function toArticle(post: SagaNewsPost, sections: string[]): ScrapedArticle {
  const author = wpAuthor(post);
  return {
    source: KEY,
    sourceId: String(post.id),
    url: canonicalizeUrl(post.link),
    title: stripHtml(post.title.rendered),
    publishedAt: wpDate(post.date_gmt),
    updatedAt: wpDate(post.modified_gmt),
    author: author === HOUSE_BYLINE ? undefined : author,
    summary: htmlToText(post.excerpt.rendered),
    contentText: htmlToText(post.content.rendered),
    imageUrl: wpImage(post),
    categories: sections.filter((s) => !GENERIC_SECTIONS.has(s)),
  };
}

const news828Now: NewsSourceModule = {
  key: KEY,
  name: '828newsNOW',
  homepage: SITE,
  kind: 'outlet',
  method: 'wp-json',
  async scrape() {
    const sectionNames = await fetchSectionNames();
    await new Promise((resolve) => setTimeout(resolve, CRAWL_DELAY_MS));
    const posts = await fetchRecentNews();

    return posts.flatMap((post) => {
      const sections = (post.sections ?? [])
        .map((id) => sectionNames.get(id))
        .filter((s): s is string => !!s);
      if (isPaidContent(post, sections)) return [];
      const article = toArticle(post, sections);
      return mentionsBuncombe(article.title, article.summary, article.url, article.contentText)
        ? [article]
        : [];
    });
  },
};

export default news828Now;
