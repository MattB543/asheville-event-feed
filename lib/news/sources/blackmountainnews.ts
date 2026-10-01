/**
 * Black Mountain News - Gannett's Swannanoa Valley paper (Black Mountain,
 * Swannanoa, Montreat), staffed out of the Citizen-Times newsroom.
 *
 * citizen-times.com answers every non-browser client with a 402 "Access
 * Restricted" wall, but this Gannett property serves plain fetches. Gannett
 * sites have no RSS, so the listing is the paper's monthly web sitemap on
 * gannett-cdn.com (its own stories only, none of the USA TODAY network filler
 * the homepage mixes in), and each story page's JSON-LD supplies the headline,
 * dek, byline and tags. That is one page fetch per story, but the paper runs
 * about four stories a week.
 *
 * Stories are metered, but Gannett's JSON-LD marks them isAccessibleForFree
 * and the page carries the whole body, so it is read from that same fetch -
 * there is no separate fetchFullText. A story marked not free is kept as
 * headline + dek only.
 */

import * as cheerio from 'cheerio';
import { canonicalizeUrl, fetchNewsText, htmlToText } from '../feeds';
import type { NewsSourceModule, ScrapedArticle } from '../types';

const KEY = 'BLACK_MOUNTAIN_NEWS';
const SITEMAP_URL = (month: string) =>
  `https://www.gannett-cdn.com/sitemaps/PBMN/web/web-sitemap-${month}.xml`;
const MAX_AGE_DAYS = 7;
const REQUEST_DELAY_MS = 1000;

interface GannettNewsArticle {
  '@type'?: string;
  headline?: string;
  description?: string;
  datePublished?: string;
  dateModified?: string;
  author?: { name?: string } | Array<{ name?: string }>;
  /** Gannett packs metadata in here: "access:metered", "tag:Swannanoa", ... */
  keywords?: string[];
  image?: { url?: string };
  isAccessibleForFree?: boolean;
}

/** Inside the article body: ads, related-story cards, photos, the "highlights" bullet box. */
const NON_BODY = 'aside, figure, script, style, iframe, ul.gnt_sh';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "YYYY-MM" for every month the look-back window touches. */
function sitemapMonths(now: Date): string[] {
  const start = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  return [...new Set([start, now].map((d) => d.toISOString().slice(0, 7)))];
}

/** Story URLs last modified inside the window, with the sitemap's image. */
async function listRecent(cutoff: number): Promise<Map<string, string | undefined>> {
  const stories = new Map<string, string | undefined>();
  let sitemapsRead = 0;
  for (const month of sitemapMonths(new Date())) {
    let xml: string;
    try {
      xml = await fetchNewsText(SITEMAP_URL(month), KEY, { Accept: 'application/xml' });
      sitemapsRead++;
    } catch {
      continue; // a month with no stories yet has no sitemap
    }
    const $ = cheerio.load(xml, { xml: true });
    $('url').each((_, el) => {
      const loc = $(el).children('loc').text().trim();
      const lastmod = Date.parse($(el).children('lastmod').text().trim());
      if (loc && lastmod >= cutoff)
        stories.set(loc, $(el).find('image\\:loc').first().text().trim() || undefined);
    });
  }
  if (sitemapsRead === 0) throw new Error('No Black Mountain News sitemap could be read');
  return stories;
}

function readNewsArticle($: cheerio.CheerioAPI): GannettNewsArticle | undefined {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(script).text()) as GannettNewsArticle | GannettNewsArticle[];
      const article = [data].flat().find((d) => d['@type'] === 'NewsArticle');
      if (article) return article;
    } catch {
      // not every ld+json block is valid JSON; keep looking
    }
  }
  return undefined;
}

/** Paragraphs, subheads and lists of the story body. */
function readBody($: cheerio.CheerioAPI): string | undefined {
  const body = $('.gnt_ar_b').first();
  body.find(NON_BODY).remove();
  return htmlToText(body.html() ?? undefined);
}

async function readStory(
  url: string,
  sitemapImage: string | undefined,
  cutoff: number
): Promise<ScrapedArticle | undefined> {
  const $ = cheerio.load(await fetchNewsText(url, KEY));
  const ld = readNewsArticle($);
  const publishedAt = ld?.datePublished ? new Date(ld.datePublished) : undefined;
  // lastmod also moves when an old story is edited, so re-check the real date.
  if (
    !ld?.headline ||
    !publishedAt ||
    isNaN(publishedAt.getTime()) ||
    publishedAt.getTime() < cutoff
  )
    return undefined;

  const keywords = ld.keywords ?? [];
  const paywalled = ld.isAccessibleForFree === false;
  const authors = [ld.author ?? []]
    .flat()
    .map((a) => a.name?.trim())
    .filter(Boolean);

  return {
    source: KEY,
    sourceId: url.match(/\/(\d{8,})\/?$/)?.[1] ?? url,
    url: canonicalizeUrl(url),
    title: htmlToText(ld.headline) ?? ld.headline,
    publishedAt,
    updatedAt: ld.dateModified ? new Date(ld.dateModified) : undefined,
    author: authors.length ? authors.join(', ') : undefined,
    summary: htmlToText(ld.description),
    contentText: paywalled ? undefined : readBody($),
    imageUrl: ld.image?.url || sitemapImage,
    // Tags minus Gannett's machine sentiment labels ("Overall Negative").
    categories: keywords
      .filter((k) => k.startsWith('tag:') && !k.startsWith('tag:Overall '))
      .map((k) => k.slice('tag:'.length)),
    paywalled,
  };
}

async function scrape(): Promise<ScrapedArticle[]> {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const articles: ScrapedArticle[] = [];

  for (const [url, image] of await listRecent(cutoff)) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const article = await readStory(url, image, cutoff);
      if (article) articles.push(article);
    } catch (error) {
      // Skipped this run; the story stays in the sitemap and is retried next time.
      console.warn(
        `[${KEY}] Could not read ${url}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return articles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

const blackMountainNews: NewsSourceModule = {
  key: KEY,
  name: 'Black Mountain News',
  homepage: 'https://www.blackmountainnews.com',
  kind: 'outlet',
  method: 'html',
  scrape,
};

export default blackMountainNews;
